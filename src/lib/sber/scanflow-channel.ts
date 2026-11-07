/**
 * Доступ к СберБизнесу ООО «БФС» через подключение ScanFlow — тот же канал,
 * что у DocsFlow (`DocsFlow/src/lib/sber-scanflow.ts`).
 *
 * ScanFlow (приложение Сбера client_id 40285) подключён к СберБизнесу БФС и
 * сам держит токен живым (таблица `sber_connections` его базы). Своего
 * приложения Сбера у WeSetup нет, поэтому выписку счёта, на который клиенты
 * платят по нашим счетам, читаем токеном ScanFlow.
 *
 * Правила канала (те же, что в DocsFlow):
 * - Владелец токена — ScanFlow, отсюда только SELECT. Обновить токен здесь —
 *   значит получить новый refresh_token и убить подключение ScanFlow.
 * - Токен привязан к сертификату приложения: запросы идут с .p12 ScanFlow,
 *   с чужим сертификатом Сбер отвечает 403 CERTIFICATE_ACCESS_EXCEPTION.
 * - Истекающий или отвергнутый (401) токен просим обновить сам ScanFlow
 *   (`POST /api/sber/refresh-now` его админ-ключом) и перечитываем.
 * - Конфиг — только серверный `.env` (деплой его сохраняет):
 *   SCANFLOW_DATABASE_URL, SBER_SCANFLOW_PFX (путь к .p12 вне каталога
 *   деплоя), SBER_SCANFLOW_PFX_PASSWORD_B64, SCANFLOW_API_URL, SCANFLOW_API_KEY.
 *   Без первых двух канал выключен и сверка оплат ничего не делает.
 */
import fs from "node:fs";

import { digitsOnly, isExpiringSoon, scanflowUtcToIso } from "./scanflow-shared";

export type SberClientCert = { pfx: Buffer; passphrase?: string };

export interface ScanflowSberAccess {
  accessToken: string;
  cert: SberClientCert;
  accountNumber: string;
}

type TokenRow = {
  access_token: string | null;
  account_number: string | null;
  org_name: string | null;
  expires_at: string | null;
  refresh_obtained_at: string | null;
  last_refresh_at: string | null;
  last_refresh_error: string | null;
};

let pfxCache: { path: string; pfx: Buffer } | null = null;

function channelConfig() {
  const url = process.env.SCANFLOW_DATABASE_URL?.trim();
  const pfxPath = process.env.SBER_SCANFLOW_PFX?.trim();
  if (!url || !pfxPath) return null;
  const pass = process.env.SBER_SCANFLOW_PFX_PASSWORD_B64?.trim();
  return { url, pfxPath, passphrase: pass ? Buffer.from(pass, "base64").toString("utf8") : undefined };
}

export function scanflowChannelConfigured(): boolean {
  return channelConfig() !== null;
}

/** Строка подключения ScanFlow к счёту `account` (20 цифр). */
async function readRow(url: string, account: string): Promise<TokenRow | undefined> {
  const mysql = await import("mysql2/promise");
  // dateStrings: сроки ScanFlow хранит в UTC без пояса — читаем строкой.
  const conn = await mysql.createConnection({ uri: url, connectTimeout: 5000, dateStrings: true });
  try {
    const [rows] = await conn.query(
      "SELECT access_token, account_number, org_name, expires_at, refresh_obtained_at, last_refresh_at, last_refresh_error FROM sber_connections WHERE access_token IS NOT NULL ORDER BY updated_at DESC"
    );
    return (rows as TokenRow[]).find((row) => digitsOnly(row.account_number) === account);
  } finally {
    await conn.end().catch(() => {});
  }
}

/** Попросить ScanFlow обновить токен. false — запрос не настроен или ScanFlow не смог. */
export async function askScanflowRefresh(): Promise<boolean> {
  const url = process.env.SCANFLOW_API_URL?.trim().replace(/\/+$/, "");
  const key = process.env.SCANFLOW_API_KEY?.trim();
  if (!url || !key) return false;
  try {
    const res = await fetch(`${url}/api/sber/refresh-now`, {
      method: "POST",
      headers: { "x-api-key": key },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) console.error("[sber-scanflow] refresh-now:", res.status, (await res.text()).slice(0, 200));
    return res.ok;
  } catch (error) {
    console.error("[sber-scanflow] refresh-now не ответил:", (error as Error).message);
    return false;
  }
}

/** Доступ ScanFlow к счёту: null — канал не настроен или к этому счёту ScanFlow не подключён. */
export async function scanflowSberAccessForAccount(
  accountNumber: string,
  opts: { forceRefresh?: boolean } = {}
): Promise<ScanflowSberAccess | null> {
  const cfg = channelConfig();
  const account = digitsOnly(accountNumber);
  if (!cfg || account.length !== 20) return null;

  let row = await readRow(cfg.url, account);
  if (row && (opts.forceRefresh || isExpiringSoon(row.expires_at, Date.now())) && (await askScanflowRefresh())) {
    row = await readRow(cfg.url, account);
  }
  if (!row?.access_token) return null;

  if (pfxCache?.path !== cfg.pfxPath) pfxCache = { path: cfg.pfxPath, pfx: fs.readFileSync(cfg.pfxPath) };
  return {
    accessToken: row.access_token,
    cert: { pfx: pfxCache.pfx, passphrase: cfg.passphrase },
    accountNumber: digitsOnly(row.account_number),
  };
}

/** Состояние подключения из базы ScanFlow — для админки, без токенов. */
export interface ScanflowDbStatus {
  orgName: string;
  accountNumber: string;
  accessUntil: string | null;
  lastRefreshAt: string | null;
  refreshUntil: string | null;
  lastRefreshError: string | null;
}

export async function scanflowDbStatusForAccount(accountNumber: string): Promise<ScanflowDbStatus | { error: string } | null> {
  const cfg = channelConfig();
  const account = digitsOnly(accountNumber);
  if (!cfg || account.length !== 20) return null;
  let row: TokenRow | undefined;
  try {
    row = await readRow(cfg.url, account);
  } catch (error) {
    return { error: (error as Error).message };
  }
  if (!row) return null;
  const obtained = scanflowUtcToIso(row.refresh_obtained_at);
  return {
    orgName: row.org_name ?? "",
    accountNumber: digitsOnly(row.account_number),
    accessUntil: scanflowUtcToIso(row.expires_at),
    lastRefreshAt: scanflowUtcToIso(row.last_refresh_at),
    // refresh_token Сбера живёт 180 дней с выдачи и продлевается каждым обновлением.
    refreshUntil: obtained ? new Date(Date.parse(obtained) + 180 * 86_400_000).toISOString() : null,
    lastRefreshError: row.last_refresh_error || null,
  };
}

/**
 * Статус из API ScanFlow (`GET /api/sber/status` админ-ключом): секрет
 * приложения и TLS-сертификат Sber API — их в базе подключения нет.
 */
export interface ScanflowApiStatus {
  connected: boolean;
  orgName: string | null;
  accountNumber: string | null;
  tokenExpired: boolean;
  secret: { perpetual: boolean; expiresAt: string | null; daysLeft: number | null; lastError: string | null } | null;
  tls: { source: string; validTo: string | null; daysLeft: number | null; subject: string | null } | null;
}

export async function fetchScanflowApiStatus(): Promise<ScanflowApiStatus | { error: string } | null> {
  const url = process.env.SCANFLOW_API_URL?.trim().replace(/\/+$/, "");
  const key = process.env.SCANFLOW_API_KEY?.trim();
  if (!url || !key) return null;
  try {
    const res = await fetch(`${url}/api/sber/status`, {
      headers: { "x-api-key": key },
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
    if (!res.ok) return { error: `ScanFlow ответил ${res.status}` };
    const data = (await res.json()) as Record<string, unknown>;
    const auth = (data.auth ?? {}) as Record<string, unknown>;
    const secret = auth.secret as Record<string, unknown> | null | undefined;
    const tls = auth.tls as Record<string, unknown> | null | undefined;
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
    const strOrNull = (v: unknown) => (typeof v === "string" && v ? v : null);
    return {
      connected: data.connected === true,
      orgName: strOrNull(data.org_name),
      accountNumber: strOrNull(data.account_number),
      tokenExpired: data.token_expired === true,
      secret: secret
        ? {
            perpetual: secret.perpetual === true,
            expiresAt: strOrNull(secret.expires_at),
            daysLeft: num(secret.days_left),
            lastError: strOrNull(secret.last_error),
          }
        : null,
      tls:
        tls && typeof tls === "object"
          ? {
              source: String(tls.source ?? "none"),
              validTo: strOrNull(tls.valid_to),
              daysLeft: num(tls.days_left),
              subject: strOrNull(tls.subject),
            }
          : null,
    };
  } catch (error) {
    return { error: (error as Error).message };
  }
}
