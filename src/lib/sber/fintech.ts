/**
 * Выписка СберБизнес (fintech API) по mTLS — как в DocsFlow (`lib/sber.ts`).
 * Только чтение: `GET /v2/statement/transactions`.
 */
import https from "node:https";
import tls from "node:tls";

import type { SberClientCert } from "./scanflow-channel";
import { parseStatementPage, type StatementPage } from "./statement-parse";

const SBER_API_BASE = process.env.SBER_FINTECH_BASE?.trim() || "https://fintech.sberbank.ru:9443/fintech/api";

export class SberApiError extends Error {
  constructor(
    public status: number,
    public body: string
  ) {
    super(`Сбер ответил ${status}: ${body.slice(0, 300)}`);
  }
}

function getOnce(url: string, accessToken: string, cert: SberClientCert): Promise<{ status: number; body: string }> {
  const target = new URL(url);
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: target.hostname,
        port: target.port || 9443,
        path: target.pathname + target.search,
        method: "GET",
        headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
        pfx: cert.pfx,
        passphrase: cert.passphrase,
        // У Сбера свой УЦ, которого нет в хранилище Node — проверку сервера
        // выключаем, как в DocsFlow и ScanFlow; клиентский сертификат (mTLS) работает.
        rejectUnauthorized: false,
        timeout: 30_000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
      }
    );
    req.on("timeout", () => req.destroy(new Error("Сбер не ответил за 30 секунд")));
    req.on("error", reject);
    req.end();
  });
}

const TRANSIENT = /ECONNRESET|ETIMEDOUT|EAI_AGAIN|ECONNREFUSED|socket hang up|не ответил/i;

/** Одна страница выписки за день. Сетевые сбои — до трёх попыток (GET идемпотентен). */
export async function fetchStatementPage(args: {
  accessToken: string;
  cert: SberClientCert;
  accountNumber: string;
  statementDate: string;
  page: number;
}): Promise<StatementPage> {
  const params = new URLSearchParams({
    accountNumber: args.accountNumber,
    statementDate: args.statementDate,
    page: String(args.page),
  });
  const url = `${SBER_API_BASE}/v2/statement/transactions?${params}`;
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const res = await getOnce(url, args.accessToken, args.cert);
      if (res.status < 200 || res.status >= 300) throw new SberApiError(res.status, res.body);
      return parseStatementPage(JSON.parse(res.body) as unknown, args.statementDate);
    } catch (error) {
      lastError = error;
      if (error instanceof SberApiError || !TRANSIENT.test(String((error as Error)?.message ?? error))) throw error;
      await new Promise((r) => setTimeout(r, 700 * attempt));
    }
  }
  throw lastError;
}

/**
 * Срок клиентского сертификата (.p12), которым идут запросы в Сбер. Node не
 * читает PKCS#12 напрямую, поэтому поднимаем на миг локальный TLS-сервер с
 * этим сертификатом и смотрим его со стороны клиента.
 */
export async function readClientCertInfo(cert: SberClientCert): Promise<{ validFrom: string; validTo: string; subject: string }> {
  const server = tls.createServer({ pfx: cert.pfx, passphrase: cert.passphrase });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  try {
    const port = (server.address() as { port: number }).port;
    return await new Promise((resolve, reject) => {
      const socket = tls.connect({ host: "127.0.0.1", port, rejectUnauthorized: false }, () => {
        const peer = socket.getPeerCertificate();
        socket.end();
        const subject = peer.subject ? String((peer.subject as unknown as Record<string, unknown>).CN ?? "") : "";
        resolve({
          validFrom: new Date(peer.valid_from).toISOString(),
          validTo: new Date(peer.valid_to).toISOString(),
          subject,
        });
      });
      socket.once("error", reject);
      socket.setTimeout(5000, () => socket.destroy(new Error("timeout")));
    });
  } finally {
    server.close();
  }
}
