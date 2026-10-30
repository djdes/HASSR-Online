// Источники документов ЭДО: откуда сервис отправки берёт файл по `kind` + `sourceId`.
// Новый источник — одна запись в `EDO_SOURCES` (функция `sourceId → документ`) — и всё: форма,
// кнопка EdoSendButton, защита от дублей и история работают сами.
//
// Договоры клиентов — `ClientContract`: PDF перерисовывается из снимка на момент выпуска.

import { db } from "@/lib/db";
import { ensureClosingDocument, renderPdf } from "@/lib/closing-documents/service";
import { renderInvoice } from "@/lib/invoices/service";
import { renderClientContractPdf } from "@/lib/contracts/render.server";

import { moscowYmd, type EdoKind } from "./registry";
import { EdoInputError } from "./saby/orgs";

/** Документ источника: чей он, номер, дата и файл(ы) для вложения. */
export interface EdoSourceDocument {
  organizationId: string;
  number: string;
  /** `ГГГГ-ММ-ДД`. */
  date: string;
  files: Array<{ name: string; bytes: Uint8Array }>;
}

export type EdoSourceResolver = (sourceId: string) => Promise<EdoSourceDocument>;

/** Ошибка источника (документа нет, он не того вида) — человек может исправить выбор. */
export class EdoSourceError extends EdoInputError {
  constructor(message: string) {
    super(message);
    this.name = "EdoSourceError";
  }
}

function orderIdOf(sourceId: string): number {
  const id = Number(sourceId.trim());
  if (!Number.isInteger(id) || id <= 0 || id > 2_147_483_647) throw new EdoSourceError("Неверный номер заказа");
  return id;
}

const ruDate = (ymd: string) => ymd.split("-").reverse().join(".");

/** Счёт на оплату (заказ «по безналу»): PDF по текущим реквизитам сторон. */
async function invoiceSource(sourceId: string): Promise<EdoSourceDocument> {
  const rendered = await renderInvoice(orderIdOf(sourceId));
  if (!rendered || !rendered.order.organizationId) throw new EdoSourceError("Счёт не найден — возможно, это заказ не по безналу");
  if (rendered.order.status === "cancelled") throw new EdoSourceError(`Счёт № ${rendered.order.id} отменён`);
  const date = moscowYmd(rendered.order.createdAt);
  return {
    organizationId: rendered.order.organizationId,
    number: String(rendered.order.id),
    date,
    files: [{ name: `Счёт № ${rendered.order.id} от ${ruDate(date)}.pdf`, bytes: rendered.pdf }],
  };
}

const CLOSING_REASON_TEXT: Record<string, string> = {
  "not-paid": "заказ не оплачен",
  test: "это тестовая оплата",
  zero: "сумма заказа — ноль",
  refunded: "платёж возвращён",
  requisites: "не заполнены реквизиты ООО «БФС» (ROOT → Реквизиты)",
  advance: "это аванс",
  held: "оплата на ручном разборе",
};

/** УПД (статус 2, без НДС) по оплаченному заказу: снимок создаётся, если его ещё нет. */
async function updSource(sourceId: string): Promise<EdoSourceDocument> {
  const orderId = orderIdOf(sourceId);
  const { document, eligibility } = await ensureClosingDocument(orderId);
  if (!document) {
    const reason = eligibility.ok ? "" : CLOSING_REASON_TEXT[eligibility.reason] ?? eligibility.reason;
    throw new EdoSourceError(`УПД по заказу № ${orderId} не выпускается${reason ? `: ${reason}` : ""}`);
  }
  if (document.status === "voided") throw new EdoSourceError(`УПД № ${document.number} аннулирован (возврат платежа)`);
  if (!document.organizationId) throw new EdoSourceError("У УПД нет организации-покупателя");
  const date = moscowYmd(document.issuedAt);
  return {
    organizationId: document.organizationId,
    number: document.number,
    date,
    files: [{ name: `УПД № ${document.number} от ${ruDate(date)}.pdf`, bytes: await renderPdf(document) }],
  };
}

/** Договор оказания услуг, выпущенный в карточке клиента (ClientContract). */
async function contractSource(sourceId: string): Promise<EdoSourceDocument> {
  const id = sourceId.trim();
  if (!id || id.length > 64) throw new EdoSourceError("Неверный договор");
  const contract = await db.clientContract.findUnique({ where: { id }, select: { id: true, organizationId: true, number: true, issuedAt: true, status: true } });
  if (!contract) throw new EdoSourceError("Договор не найден");
  if (contract.status === "voided") throw new EdoSourceError(`Договор № ${contract.number} аннулирован`);
  const file = await renderClientContractPdf(contract.id);
  return {
    organizationId: contract.organizationId,
    number: contract.number,
    date: moscowYmd(contract.issuedAt),
    files: [{ name: file.fileName, bytes: file.bytes }],
  };
}

/** Реестр источников: `kind` → документ WeSetup. */
export const EDO_SOURCES: Partial<Record<EdoKind, EdoSourceResolver>> = {
  invoice: invoiceSource,
  upd: updSource,
  contract: contractSource,
};

/** Документ источника, проверенный на принадлежность организации. */
export async function resolveEdoSource(kind: EdoKind, sourceId: string, organizationId: string): Promise<EdoSourceDocument> {
  const resolver = EDO_SOURCES[kind];
  if (!resolver) throw new EdoSourceError("Для этого вида документа источника в WeSetup нет — загрузите файл");
  const doc = await resolver(sourceId);
  if (doc.organizationId !== organizationId) throw new EdoSourceError("Этот документ принадлежит другой организации");
  return doc;
}

/** Что можно отправить организации из WeSetup: счета по безналу и оплаченные заказы (УПД). */
export interface EdoSourceOptions {
  invoices: Array<{ sourceId: string; number: string; date: string; amountRub: number; status: string }>;
  upds: Array<{ sourceId: string; number: string; date: string; amountRub: number; issued: boolean; voided: boolean }>;
}

export async function listEdoSourceOptions(organizationId: string): Promise<EdoSourceOptions> {
  const [invoices, paid, closing] = await Promise.all([
    db.paymentOrder.findMany({
      where: { organizationId, paymentMethod: "invoice", status: { not: "cancelled" } },
      orderBy: { createdAt: "desc" },
      take: 30,
      select: { id: true, createdAt: true, amountRub: true, status: true },
    }),
    db.paymentOrder.findMany({
      where: { organizationId, status: "paid", isTest: false, refundedAt: null, amountRub: { gt: 0 } },
      orderBy: { createdAt: "desc" },
      take: 30,
      select: { id: true, paidAt: true, createdAt: true, amountRub: true },
    }),
    db.closingDocument.findMany({
      where: { organizationId },
      orderBy: { issuedAt: "desc" },
      take: 30,
      select: { orderId: true, number: true, issuedAt: true, totalRub: true, status: true },
    }),
  ]);
  const byOrder = new Map(closing.map((c) => [c.orderId, c]));
  const upds: EdoSourceOptions["upds"] = paid.map((o) => {
    const c = byOrder.get(o.id);
    return {
      sourceId: String(o.id),
      number: c?.number ?? String(o.id),
      date: moscowYmd(c?.issuedAt ?? o.paidAt ?? o.createdAt),
      amountRub: Number(c?.totalRub ?? o.amountRub),
      issued: !!c,
      voided: c?.status === "voided",
    };
  });
  // УПД, чьи заказы уже не «paid» (возврат) — тоже показываем, но аннулированными.
  for (const c of closing) {
    if (!upds.some((u) => u.sourceId === String(c.orderId))) {
      upds.push({ sourceId: String(c.orderId), number: c.number, date: moscowYmd(c.issuedAt), amountRub: Number(c.totalRub), issued: true, voided: c.status === "voided" });
    }
  }
  return {
    invoices: invoices.map((o) => ({ sourceId: String(o.id), number: String(o.id), date: moscowYmd(o.createdAt), amountRub: Number(o.amountRub), status: o.status })),
    upds,
  };
}
