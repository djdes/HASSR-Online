/**
 * Зачисление поступлений из выписки СберБизнес на баланс — чистая логика.
 *
 * Владелец, 2026-11-10: все поступления клиентов зачисляются на баланс
 * автоматически, как бы клиент ни платил. Счёт, который распознан
 * (`invoice-match.ts`, kind "paid"), уже проходит через баланс
 * («+N пополнение», «−N оплата тарифа» — payment-ledger.ts). Здесь —
 * остальные входящие: платёж без нашего счёта или с «чужой» суммой.
 * Организацию ищем по ИНН плательщика:
 *
 * 1. ИНН — наш собственный или банка (эквайринг: деньги с карт уже
 *    зачислены кассой по своему заказу) — пропускаем.
 * 2. Такую же сумму от этого ИНН недавно отметили оплатой счёта вручную
 *    («Оплата поступила» на /root/invoices) — это та же оплата, второй
 *    раз не зачисляем.
 * 3. Ровно одна организация с этим ИНН — зачисляем ей. Несколько — берём
 *    ту, у которой уже были оплаты, если она одна; иначе — админу.
 * 4. Организации с этим ИНН нет — не наше поступление (на р/с БФС
 *    приходят и другие деньги).
 */

import { digitsOnly } from "./scanflow-shared";

/**
 * С какого банковского дня (по Москве) поступления зачисляются на баланс.
 * Раньше пришедшие деньги админы разбирали вручную — второй раз их не трогаем.
 */
export const STATEMENT_CREDIT_FROM = "2026-11-10";

/** ИНН ПАО Сбербанк: так приходят зачисления эквайринга. */
export const BANK_INNS: readonly string[] = ["7707083893"];

export interface PayerOrganization {
  id: string;
  name: string;
  /** ИНН организации как записан (бывает с пробелами). */
  inn: string | null;
  /** Были ли у организации оплаченные заказы — для выбора среди дублей ИНН. */
  hasPaidOrders: boolean;
}

export interface RecentPaidInvoice {
  id: number;
  amountRub: number;
  /** ИНН покупателя по счёту. */
  buyerInn: string | null;
}

export interface StatementCreditInput {
  /** Дата операции из выписки (ISO или YYYY-MM-DD). */
  date: string;
  amountRub: number;
  payerInn: string | null;
  /** Счёт, на который похож платёж (разбор в invoice-match), и его организация. */
  reviewInvoice: { id: number; organizationId: string | null } | null;
}

export type StatementCreditDecision =
  | { kind: "credit"; organizationId: string; amount: number; orderId: number | null }
  | { kind: "already-paid"; orderId: number }
  | { kind: "ambiguous"; organizationIds: string[] }
  | { kind: "skip"; reason: "before-launch" | "no-inn" | "own" | "bank" | "no-organization" | "too-small" };

const sameAmount = (a: number, b: number) => Math.abs(a - b) < 0.005;

/** Баланс — целые рубли: копейки платежа на баланс не попадают. */
export function creditAmountRub(amountRub: number): number {
  return Math.floor(amountRub + 1e-6);
}

export function decideStatementCredit(
  payment: StatementCreditInput,
  ctx: {
    ownInn: string | null;
    organizations: readonly PayerOrganization[];
    recentPaidInvoices: readonly RecentPaidInvoice[];
  },
): StatementCreditDecision {
  if (payment.date.slice(0, 10) < STATEMENT_CREDIT_FROM) return { kind: "skip", reason: "before-launch" };
  const inn = digitsOnly(payment.payerInn);
  if (inn.length !== 10 && inn.length !== 12) return { kind: "skip", reason: "no-inn" };
  if (ctx.ownInn && inn === digitsOnly(ctx.ownInn)) return { kind: "skip", reason: "own" };
  if (BANK_INNS.includes(inn)) return { kind: "skip", reason: "bank" };

  const alreadyPaid = ctx.recentPaidInvoices.find(
    (inv) => digitsOnly(inv.buyerInn) === inn && sameAmount(inv.amountRub, payment.amountRub),
  );
  if (alreadyPaid) return { kind: "already-paid", orderId: alreadyPaid.id };

  const candidates = ctx.organizations.filter((org) => digitsOnly(org.inn) === inn);
  if (candidates.length === 0) return { kind: "skip", reason: "no-organization" };

  let target: PayerOrganization | null = candidates.length === 1 ? candidates[0] : null;
  if (!target) {
    // Дубли ИНН: счёт, на который похож платёж, сам называет организацию.
    const byInvoice = candidates.find((org) => org.id === payment.reviewInvoice?.organizationId);
    const paying = candidates.filter((org) => org.hasPaidOrders);
    target = byInvoice ?? (paying.length === 1 ? paying[0] : null);
  }
  if (!target) return { kind: "ambiguous", organizationIds: candidates.map((org) => org.id) };

  const amount = creditAmountRub(payment.amountRub);
  if (amount <= 0) return { kind: "skip", reason: "too-small" };
  const orderId =
    payment.reviewInvoice && payment.reviewInvoice.organizationId === target.id ? payment.reviewInvoice.id : null;
  return { kind: "credit", organizationId: target.id, amount, orderId };
}
