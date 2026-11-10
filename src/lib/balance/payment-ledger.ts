import { TOPUP_TARIFF_KEY } from "./topup-core";

/**
 * Оплата тарифа проходит через баланс, как у мобильного оператора
 * (владелец, 2026-11-09): деньги с карты или по счёту сначала поступают
 * на баланс, а потом списываются за тариф. В детализации — две строки:
 * «+N пополнение» (кредит) и «−N оплата тарифа» (дебет).
 *
 * Обе строки пишутся одной транзакцией после того, как оплата применена к
 * подписке, — баланс в итоге не меняется, и списание не может упереться в
 * нехватку. Заказ на ручном разборе (`heldAt`) строк не получает: тариф по
 * нему ещё не применён; ROOT «Применено» записывает их тогда.
 *
 * Ядро без БД — ниже обёртка `recordPaymentThroughBalance` с Prisma.
 */

export type PassThroughOrder = {
  id: number;
  tariffKey: string;
  status: string;
  /** Decimal из БД, число или строка — приводим через toString(). */
  amountRub: number | string | { toString(): string };
  organizationId: string | null;
  paymentMethod: string | null;
  description: string;
  isTest: boolean;
  heldAt: Date | null;
  refundedAt: Date | null;
};

export type PassThroughEntry = {
  organizationId: string;
  amount: number;
  kind: "topup" | "subscription_charge";
  description: string;
  dedupeKey: string;
  paymentOrderId: number;
};

export function paymentInDedupeKey(orderId: number): string {
  return `payment_in:${orderId}`;
}

export function paymentOutDedupeKey(orderId: number): string {
  return `payment_out:${orderId}`;
}

export type PassThroughSkip = "topup-order" | "not-paid" | "held" | "refunded" | "no-organization" | "no-money";

/**
 * Две строки леджера для оплаченного заказа тарифа или причина, почему их
 * нет. Сумма — деньги заказа (`amountRub`, без баллов: баллы уже списаны
 * своей строкой `order_spend` при оформлении).
 */
export function passThroughEntries(
  order: PassThroughOrder,
): { ok: true; credit: PassThroughEntry; debit: PassThroughEntry } | { ok: false; reason: PassThroughSkip } {
  // Пополнение баланса зачисляется своим путём (`topup:<id>`) и не списывается.
  if (order.tariffKey === TOPUP_TARIFF_KEY) return { ok: false, reason: "topup-order" };
  if (order.status !== "paid" && order.status !== "completed") return { ok: false, reason: "not-paid" };
  if (order.heldAt) return { ok: false, reason: "held" };
  if (order.refundedAt) return { ok: false, reason: "refunded" };
  if (!order.organizationId) return { ok: false, reason: "no-organization" };
  const amount = Math.round(Number(order.amountRub.toString()));
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, reason: "no-money" };

  const how = order.paymentMethod === "invoice" ? "по счёту" : "картой";
  const test = order.isTest ? " (тестовый платёж)" : "";
  return {
    ok: true,
    credit: {
      organizationId: order.organizationId,
      amount,
      kind: "topup",
      description: `Пополнение ${how}, заказ №${order.id}${test}`,
      dedupeKey: paymentInDedupeKey(order.id),
      paymentOrderId: order.id,
    },
    debit: {
      organizationId: order.organizationId,
      amount: -amount,
      kind: "subscription_charge",
      description: `Оплата тарифа: ${order.description}, заказ №${order.id}`,
      dedupeKey: paymentOutDedupeKey(order.id),
      paymentOrderId: order.id,
    },
  };
}

/** Что ядру нужно от леджера внутри одной транзакции. */
export type PassThroughLedger = {
  has(dedupeKey: string): Promise<boolean>;
  apply(entry: PassThroughEntry): Promise<void>;
};

export type PassThroughResult =
  | { status: "recorded"; amount: number; organizationId: string }
  | { status: "already"; amount: number; organizationId: string }
  | { status: "skipped"; reason: PassThroughSkip | "missing" };

/**
 * Записать «поступление и списание» по заказу. Идемпотентно: обе строки уже
 * есть — `already`. Сначала кредит, потом дебет: баланс не уходит в минус
 * даже на миг, и `applyBalanceChange` не откажет в списании.
 */
export async function recordPassThrough(ledger: PassThroughLedger, order: PassThroughOrder): Promise<PassThroughResult> {
  const entries = passThroughEntries(order);
  if (!entries.ok) return { status: "skipped", reason: entries.reason };
  const { credit, debit } = entries;
  const [hasIn, hasOut] = await Promise.all([ledger.has(credit.dedupeKey), ledger.has(debit.dedupeKey)]);
  if (hasIn && hasOut) return { status: "already", amount: credit.amount, organizationId: credit.organizationId };
  if (!hasIn) await ledger.apply(credit);
  if (!hasOut) await ledger.apply(debit);
  return { status: "recorded", amount: credit.amount, organizationId: credit.organizationId };
}

/**
 * Обёртка с базой: заказ читается заново (после оформления новой организации
 * в нём уже стоит `organizationId`), обе строки — одна транзакция. Сбой не
 * ломает оплату: подписка уже продлена, строку допишет повтор (ROOT
 * «Применено» или следующий вызов) — ключи не дадут задвоить.
 */
export async function recordPaymentThroughBalance(orderId: number): Promise<PassThroughResult> {
  const [{ db }, { applyBalanceChange }] = await Promise.all([import("@/lib/db"), import("./ledger")]);
  const result = await db.$transaction(async (tx) => {
    const order = await tx.paymentOrder.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        tariffKey: true,
        status: true,
        amountRub: true,
        organizationId: true,
        paymentMethod: true,
        description: true,
        isTest: true,
        heldAt: true,
        refundedAt: true,
      },
    });
    if (!order) return { status: "skipped", reason: "missing" } as const;
    return recordPassThrough(
      {
        async has(dedupeKey) {
          const row = await tx.balanceTransaction.findUnique({ where: { dedupeKey }, select: { id: true } });
          return row !== null;
        },
        async apply(entry) {
          await applyBalanceChange(tx, entry);
        },
      },
      order,
    );
  });
  if (result.status === "recorded") {
    console.info(`[balance] payment passed through balance order=${orderId} org=${result.organizationId} rub=${result.amount}`);
  }
  return result;
}
