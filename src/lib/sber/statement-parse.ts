/** Разбор страницы выписки Sber API v2 — чистая функция, проверяется тестом. */

export interface StatementTx {
  operationId: string;
  /** Дата операции (ISO или YYYY-MM-DD, как прислал Сбер). */
  date: string;
  amountRub: number;
  direction: "CREDIT" | "DEBIT";
  purpose: string;
  payerInn: string | null;
  payerName: string | null;
}

export interface StatementPage {
  transactions: StatementTx[];
  hasMore: boolean;
}

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");

function amountOf(tx: Record<string, unknown>): number {
  const raw = tx.amountRub ?? tx.amount ?? tx.sum;
  const value = raw && typeof raw === "object" ? rec(raw).amount : raw;
  const n = Math.abs(Number(value));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

export function parseStatementPage(data: unknown, statementDate: string): StatementPage {
  const body = rec(data);
  const items = (Array.isArray(body.transactions) ? body.transactions : Array.isArray(body.operations) ? body.operations : []) as unknown[];
  const transactions: StatementTx[] = [];
  for (const item of items) {
    const tx = rec(item);
    const direction = str(tx.direction).toUpperCase() === "CREDIT" ? "CREDIT" : "DEBIT";
    const transfer = rec(tx.rurTransfer);
    const date = str(tx.operationDate) || str(tx.documentDate) || str(tx.date) || statementDate;
    const operationId =
      str(tx.operationId) || str(tx.transactionId) || str(tx.uuid) || `${date}:${str(tx.number) || str(tx.documentNumber)}:${amountOf(tx)}`;
    transactions.push({
      operationId,
      date,
      amountRub: amountOf(tx),
      direction,
      purpose: str(tx.paymentPurpose) || str(tx.description),
      payerInn: str(transfer.payerInn).replace(/\D+/g, "") || null,
      payerName: str(transfer.payerName) || str(tx.payerName) || null,
    });
  }
  const links = Array.isArray(body.links) ? (body.links as unknown[]).map(rec) : null;
  const hasMore = links ? links.some((link) => str(link.rel) === "next") : transactions.length >= 100;
  return { transactions, hasMore };
}
