/**
 * Сверка выписки СберБизнес со счетами WeSetup.
 *
 * Клиент платит по счёту из кабинета (или гостевому счёту с /order) на р/с
 * БФС. Раз в 10 минут крон читает выписку этого счёта за последние дни
 * доступом ScanFlow (`scanflow-channel.ts`), ищет входящие платежи по нашим
 * открытым счетам (`invoice-match.ts`) и отмечает счёт оплаченным тем же
 * путём, что кнопка ROOT «Оплата поступила» (`markInvoicePaid`): подписка
 * подключается, гостю создаётся аккаунт, приходит письмо с УПД.
 * Спорные платежи не отмечаем — уходят администраторам на разбор.
 */
import type { Prisma } from "@prisma/client";

import { readPlatformRequisites } from "@/lib/closing-documents/requisites";
import { db } from "@/lib/db";
import { markInvoicePaid } from "@/lib/invoices/service";
import { notifyPlatformAdmin } from "@/lib/platform-admin";
import { escapeTelegramHtml } from "@/lib/telegram";

import { fetchStatementPage, readClientCertInfo, SberApiError } from "./fintech";
import { matchIncomingPayment, type OpenInvoice } from "./invoice-match";
import {
  fetchScanflowApiStatus,
  scanflowChannelConfigured,
  scanflowDbStatusForAccount,
  scanflowSberAccessForAccount,
  type ScanflowApiStatus,
  type ScanflowDbStatus,
  type ScanflowSberAccess,
} from "./scanflow-channel";
import { digitsOnly } from "./scanflow-shared";
import type { StatementTx } from "./statement-parse";

const LAST_SYNC_KEY = "sber.invoiceSync.last";
const MAX_PAGES_PER_DAY = 20;
const APP_URL = process.env.NEXTAUTH_URL || "https://wesetup.ru";

export type SberSyncResult = {
  at: string;
  ok: boolean;
  /** Почему не сверяли или что сломалось. */
  error: string | null;
  days: string[];
  incoming: number;
  matched: number;
  review: number;
  trigger: "cron" | "manual";
};

/** Дата по Москве, YYYY-MM-DD: выписку Сбер отдаёт по банковскому дню. */
function moscowDate(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Moscow", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

function statementDays(now: Date, days: number): string[] {
  const out: string[] = [];
  for (let i = days - 1; i >= 0; i -= 1) out.push(moscowDate(new Date(now.getTime() - i * 86_400_000)));
  return out;
}

async function loadOpenInvoices(): Promise<OpenInvoice[]> {
  const rows = await db.paymentOrder.findMany({
    where: { paymentMethod: "invoice", status: "pending" },
    select: { id: true, amountRub: true, buyerJson: true, organizationId: true },
  });
  const orgIds = [...new Set(rows.map((r) => r.organizationId).filter((id): id is string => Boolean(id)))];
  const orgs = orgIds.length
    ? await db.organization.findMany({ where: { id: { in: orgIds } }, select: { id: true, inn: true } })
    : [];
  const innByOrg = new Map(orgs.map((o) => [o.id, digitsOnly(o.inn)]));
  return rows.map((row) => {
    const guestInn = row.buyerJson && typeof row.buyerJson === "object" ? digitsOnly((row.buyerJson as Record<string, unknown>).inn) : "";
    const inn = (row.organizationId ? innByOrg.get(row.organizationId) : guestInn) || "";
    return { id: row.id, amountRub: Number(row.amountRub), buyerInn: inn || null };
  });
}

async function readDay(access: ScanflowSberAccess, accountNumber: string, date: string): Promise<StatementTx[]> {
  const out: StatementTx[] = [];
  for (let page = 1; page <= MAX_PAGES_PER_DAY; page += 1) {
    const res = await fetchStatementPage({ accessToken: access.accessToken, cert: access.cert, accountNumber, statementDate: date, page });
    out.push(...res.transactions);
    if (!res.hasMore) break;
  }
  return out;
}

async function saveLastSync(result: SberSyncResult) {
  await db.platformSetting.upsert({
    where: { key: LAST_SYNC_KEY },
    create: { key: LAST_SYNC_KEY, value: JSON.stringify(result) },
    update: { value: JSON.stringify(result) },
  });
}

export async function readLastSberSync(): Promise<SberSyncResult | null> {
  const row = await db.platformSetting.findUnique({ where: { key: LAST_SYNC_KEY } });
  if (!row) return null;
  try {
    return JSON.parse(row.value) as SberSyncResult;
  } catch {
    return null;
  }
}

function describeError(error: unknown): string {
  if (error instanceof SberApiError) return `Сбер ответил ${error.status}`;
  return (error as Error)?.message?.slice(0, 200) || String(error);
}

/**
 * Одна сверка. Дни — сегодня и предыдущие (`days`, по умолчанию 3): платёж
 * мог попасть в выписку задним числом. Повторная сверка тех же дней
 * безопасна: распознанные операции пропускаются по operationId, а
 * `markInvoicePaid` переводит счёт в «оплачен» одним условным апдейтом.
 */
export async function syncSberInvoicePayments(opts: { days?: number; now?: Date; trigger?: "cron" | "manual" } = {}): Promise<SberSyncResult> {
  const now = opts.now ?? new Date();
  const days = statementDays(now, Math.min(Math.max(opts.days ?? 3, 1), 14));
  const result: SberSyncResult = { at: now.toISOString(), ok: false, error: null, days, incoming: 0, matched: 0, review: 0, trigger: opts.trigger ?? "cron" };

  const finish = async () => {
    await saveLastSync(result).catch((error) => console.error("[sber-sync] не сохранил итог:", error));
    return result;
  };

  if (!scanflowChannelConfigured()) {
    result.error = "Канал ScanFlow не настроен: нет SCANFLOW_DATABASE_URL или SBER_SCANFLOW_PFX в .env сервера";
    return finish();
  }
  const requisites = await readPlatformRequisites();
  const accountNumber = digitsOnly(requisites.bank.account);
  if (accountNumber.length !== 20) {
    result.error = "В реквизитах платформы (ROOT → Реквизиты) нет расчётного счёта";
    return finish();
  }

  let access: ScanflowSberAccess | null;
  try {
    access = await scanflowSberAccessForAccount(accountNumber);
  } catch (error) {
    result.error = `База ScanFlow не ответила: ${describeError(error)}`;
    return finish();
  }
  if (!access) {
    result.error = `ScanFlow не подключён к счёту …${accountNumber.slice(-4)} из реквизитов`;
    return finish();
  }

  const incoming: StatementTx[] = [];
  try {
    for (const date of days) {
      let txs: StatementTx[];
      try {
        txs = await readDay(access, accountNumber, date);
      } catch (error) {
        // Токен могли отозвать или он истёк между чтением и запросом — просим
        // ScanFlow обновить и пробуем один раз.
        if (!(error instanceof SberApiError && error.status === 401)) throw error;
        const fresh = await scanflowSberAccessForAccount(accountNumber, { forceRefresh: true });
        if (!fresh) throw error;
        access = fresh;
        txs = await readDay(access, accountNumber, date);
      }
      incoming.push(...txs.filter((tx) => tx.direction === "CREDIT" && tx.amountRub > 0));
    }
  } catch (error) {
    result.error = `Выписка не получена: ${describeError(error)}`;
    return finish();
  }
  result.incoming = incoming.length;

  const known = new Set(
    (
      await db.sberIncomingPayment.findMany({
        where: { operationId: { in: incoming.map((tx) => tx.operationId) } },
        select: { operationId: true },
      })
    ).map((row) => row.operationId)
  );
  const fresh = incoming.filter((tx) => !known.has(tx.operationId));
  if (fresh.length > 0) {
    const invoices = await loadOpenInvoices();
    for (const tx of fresh) {
      const match = matchIncomingPayment(tx, invoices);
      if (match.kind === "none") continue;
      await handleMatch(tx, match, result).catch((error) => console.error("[sber-sync] платёж не обработан:", tx.operationId, error));
      if (match.kind === "paid") {
        // Оплаченный счёт больше не открыт: второй платёж на ту же сумму не должен его «найти».
        const idx = invoices.findIndex((inv) => inv.id === match.orderId);
        if (idx >= 0) invoices.splice(idx, 1);
      }
    }
  }

  result.ok = true;
  return finish();
}

async function handleMatch(
  tx: StatementTx,
  match: Exclude<ReturnType<typeof matchIncomingPayment>, { kind: "none" }>,
  result: SberSyncResult
) {
  const base = {
    operationId: tx.operationId,
    operationDate: tx.date,
    amountRub: tx.amountRub,
    payerInn: tx.payerInn,
    payerName: tx.payerName,
    purpose: tx.purpose.slice(0, 500),
    orderId: match.orderId,
  };
  const payer = [tx.payerName, tx.payerInn ? `ИНН ${tx.payerInn}` : null].filter(Boolean).join(", ") || "плательщик не указан";
  const amount = `${tx.amountRub.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} ₽`;

  if (match.kind === "review") {
    // Сначала запись: повторная сверка не пришлёт тот же разбор второй раз.
    await db.sberIncomingPayment.create({ data: { ...base, status: "review", note: match.reason } });
    result.review += 1;
    await notifyPlatformAdmin(
      [
        `🔎 <b>Сбер: платёж похож на оплату счёта №${match.orderId}, но не отмечен</b>`,
        `${escapeTelegramHtml(match.reason)}.`,
        `${escapeTelegramHtml(payer)} · ${amount} · ${escapeTelegramHtml(tx.date.slice(0, 10))}`,
        `Назначение: ${escapeTelegramHtml(tx.purpose.slice(0, 200))}`,
        `Проверьте и, если всё верно, отметьте «Оплата поступила»: ${APP_URL}/root/invoices`,
      ].join("\n"),
      { kind: "payment", dedupeKey: `sber-review:${tx.operationId}` }
    ).catch((error) => console.error("[sber-sync] уведомление о разборе не ушло:", error));
    return;
  }

  await db.sberIncomingPayment.create({ data: { ...base, status: "matched", note: match.by === "number" ? "по номеру счёта" : "по ИНН и сумме" } });
  const raw: Prisma.InputJsonValue = {
    source: "sber-statement",
    operationId: tx.operationId,
    operationDate: tx.date,
    amountRub: tx.amountRub,
    payerInn: tx.payerInn,
    payerName: tx.payerName,
    purpose: tx.purpose.slice(0, 500),
    matchedBy: match.by,
    at: new Date().toISOString(),
  };
  const paidAt = Number.isFinite(Date.parse(tx.date)) ? new Date(tx.date) : undefined;
  const marked = await markInvoicePaid(match.orderId, null, { rawResult: raw, paidAt });
  if (!marked.ok) {
    await db.sberIncomingPayment.update({ where: { operationId: tx.operationId }, data: { status: "failed", note: marked.error } });
    await notifyPlatformAdmin(
      `⚠️ Сбер: оплата по счёту №${match.orderId} пришла (${amount}, ${escapeTelegramHtml(payer)}), но отметить счёт не вышло: ${escapeTelegramHtml(marked.error)}. Разберите вручную: ${APP_URL}/root/invoices`,
      { kind: "payment", dedupeKey: `sber-failed:${tx.operationId}` }
    ).catch(() => {});
    return;
  }
  result.matched += 1;
  await notifyPlatformAdmin(
    `💳 <b>Сбер: оплата по счёту №${match.orderId} распознана автоматически</b>\n${escapeTelegramHtml(payer)} · ${amount} · ${match.by === "number" ? "по номеру счёта" : "по ИНН и сумме"}. Счёт отмечен оплаченным, тариф подключён.`,
    { kind: "payment", dedupeKey: `sber-matched:${tx.operationId}` }
  ).catch(() => {});
}

/** Всё о подключении для админки: ScanFlow (база и API), сертификат, последняя сверка. */
export interface SberAdminStatus {
  channelConfigured: boolean;
  accountNumber: string | null;
  db: ScanflowDbStatus | { error: string } | null;
  api: ScanflowApiStatus | { error: string } | null;
  cert: { validFrom: string; validTo: string; subject: string } | { error: string } | null;
  lastSync: SberSyncResult | null;
  recent: Array<{
    operationId: string;
    operationDate: string;
    amountRub: number;
    payerName: string | null;
    payerInn: string | null;
    orderId: number | null;
    status: string;
    note: string | null;
    createdAt: string;
  }>;
}

export async function loadSberAdminStatus(): Promise<SberAdminStatus> {
  const requisites = await readPlatformRequisites().catch(() => null);
  const account = requisites ? digitsOnly(requisites.bank.account) : "";
  const accountNumber = account.length === 20 ? account : null;
  const channelConfigured = scanflowChannelConfigured();

  const [dbStatus, api, lastSync, recent, cert] = await Promise.all([
    accountNumber ? scanflowDbStatusForAccount(accountNumber) : Promise.resolve(null),
    fetchScanflowApiStatus(),
    readLastSberSync(),
    db.sberIncomingPayment.findMany({ orderBy: { createdAt: "desc" }, take: 10 }),
    readCertInfo(),
  ]);
  return {
    channelConfigured,
    accountNumber,
    db: dbStatus,
    api,
    cert,
    lastSync,
    recent: recent.map((row) => ({
      operationId: row.operationId,
      operationDate: row.operationDate,
      amountRub: Number(row.amountRub),
      payerName: row.payerName,
      payerInn: row.payerInn,
      orderId: row.orderId,
      status: row.status,
      note: row.note,
      createdAt: row.createdAt.toISOString(),
    })),
  };
}

async function readCertInfo(): Promise<SberAdminStatus["cert"]> {
  const path = process.env.SBER_SCANFLOW_PFX?.trim();
  if (!path) return null;
  try {
    const fs = await import("node:fs");
    const pass = process.env.SBER_SCANFLOW_PFX_PASSWORD_B64?.trim();
    return await readClientCertInfo({ pfx: fs.readFileSync(path), passphrase: pass ? Buffer.from(pass, "base64").toString("utf8") : undefined });
  } catch (error) {
    return { error: (error as Error).message };
  }
}
