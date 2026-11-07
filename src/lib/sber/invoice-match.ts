/**
 * Сопоставление входящего платежа со счетом WeSetup — чистая функция.
 *
 * Номер счёта WeSetup — id заказа; назначение в счёте и платёжном QR:
 * «Оплата по счёту № 1287 от 30.10.2026 за …». Бухгалтерия клиента его
 * иногда переписывает, поэтому порядок такой:
 * 1. Номер нашего открытого счёта в назначении и та же сумма — оплачен.
 * 2. Номера нет, но ИНН плательщика = ИНН покупателя, сумма та же и такой
 *    счёт у него один — оплачен.
 * 3. Похоже на наш счёт, но сумма не та (или подходят несколько) — на разбор
 *    администратору, сами ничего не отмечаем.
 * 4. Иначе это чужое поступление на общий р/с БФС — пропускаем.
 */

export interface IncomingPayment {
  operationId: string;
  amountRub: number;
  purpose: string;
  payerInn: string | null;
}

export interface OpenInvoice {
  id: number;
  amountRub: number;
  /** ИНН покупателя: организации или гостя из `buyerJson`. */
  buyerInn: string | null;
}

export type InvoiceMatch =
  | { kind: "paid"; orderId: number; by: "number" | "inn" }
  | { kind: "review"; orderId: number; reason: string }
  | { kind: "none" };

const sameAmount = (a: number, b: number) => Math.abs(a - b) < 0.005;
const rub = (n: number) => `${n.toLocaleString("ru-RU", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ₽`;

/**
 * Номера счетов из назначения: «счёту № 1287», «сч. 1287», «счет N1287»,
 * «по счету 1287». Дата («от 30.10.2026»), ИНН и суммы сюда не попадают —
 * нужно слово «счёт» или знак номера перед числом.
 */
export function invoiceNumbersInPurpose(purpose: string): number[] {
  const found = new Set<number>();
  const re = /(?:сч[её]т[а-яё]*|сч\.|№|\bN)\s*(?:№|N|#)?\s*(\d{1,8})(?![\d.,/])/giu;
  for (const m of purpose.matchAll(re)) {
    const n = Number(m[1]);
    if (Number.isSafeInteger(n) && n > 0) found.add(n);
  }
  return [...found];
}

export function matchIncomingPayment(payment: IncomingPayment, invoices: readonly OpenInvoice[]): InvoiceMatch {
  const byId = new Map(invoices.map((inv) => [inv.id, inv]));
  const numbered = invoiceNumbersInPurpose(payment.purpose)
    .map((n) => byId.get(n))
    .filter((inv): inv is OpenInvoice => Boolean(inv));

  const exact = numbered.filter((inv) => sameAmount(inv.amountRub, payment.amountRub));
  if (exact.length === 1) return { kind: "paid", orderId: exact[0].id, by: "number" };
  if (exact.length > 1) {
    return { kind: "review", orderId: exact[0].id, reason: `в назначении несколько наших счетов на ${rub(payment.amountRub)}` };
  }
  if (numbered.length > 0) {
    const inv = numbered[0];
    return {
      kind: "review",
      orderId: inv.id,
      reason: `в назначении счёт №${inv.id} на ${rub(inv.amountRub)}, а пришло ${rub(payment.amountRub)}`,
    };
  }

  if (!payment.payerInn) return { kind: "none" };
  const ofPayer = invoices.filter((inv) => inv.buyerInn && inv.buyerInn === payment.payerInn);
  const sameSum = ofPayer.filter((inv) => sameAmount(inv.amountRub, payment.amountRub));
  if (sameSum.length === 1) return { kind: "paid", orderId: sameSum[0].id, by: "inn" };
  if (sameSum.length > 1) {
    return { kind: "review", orderId: sameSum[0].id, reason: `у плательщика ${sameSum.length} открытых счёта на ${rub(payment.amountRub)}, номера в назначении нет` };
  }
  if (ofPayer.length > 0) {
    return {
      kind: "review",
      orderId: ofPayer[0].id,
      reason: `плательщик — покупатель по счёту №${ofPayer[0].id} на ${rub(ofPayer[0].amountRub)}, а пришло ${rub(payment.amountRub)}`,
    };
  }
  return { kind: "none" };
}
