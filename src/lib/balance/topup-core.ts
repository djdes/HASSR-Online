/**
 * Пополнение баланса деньгами — ядро без БД (хранилище передаётся, как в
 * promo/lifetime-core). Обёртка с базой — lib/balance/topup.ts.
 *
 * Пополнение — отдельный вид заказа: `PaymentOrder.tariffKey =
 * "balance_topup"`. Подписку оно не продлевает, промокоды и акции к нему
 * не применяются. После подтверждённой оплаты сумма заказа зачисляется
 * на баланс организации баллами 1:1 — сразу, без холда: это деньги, а не
 * бонус.
 *
 * Идемпотентность — три слоя:
 *   1. pending → paid переводит ровно один вызов (условный updateMany);
 *   2. зачисление живёт в ТОЙ ЖЕ транзакции, что и перевод в paid: заказ
 *      не бывает «оплачен, но не зачислен», и откат одного откатывает
 *      другое — касса повторит уведомление, и всё пройдёт заново;
 *   3. строка леджера с ключом `topup:<orderId>` (unique dedupeKey):
 *      повторное зачисление по тому же заказу — no-op.
 * Сумма зачисления — только из заказа в БД (сервер посчитал её при
 * создании), никогда из запроса клиента или уведомления кассы.
 */

export const TOPUP_TARIFF_KEY = "balance_topup";

/** Что блоку «Пополнить баланс» нужно знать от сервера (topup-section.tsx). */
export type TopupBlockConfig = {
  /** Касса настроена — можно платить картой. */
  cardReady: boolean;
  /** Реквизиты WeSetup заполнены — можно выставить счёт. */
  invoiceReady: boolean;
  organizationName: string;
  organizationInn: string | null;
  /** Действующий неоплаченный счёт на пополнение — показываем вместо кнопки. */
  pendingInvoice: { id: number; amountRub: number; dueAt: string | null } | null;
  /**
   * Включено автопродление: оно списывает деньги с карты по цене тарифа,
   * баллы при автосписании не тратятся — предупреждаем честно.
   */
  recurringActive: boolean;
};

/** Заказ — пополнение баланса (а не подписка). */
export function isTopupOrder(order: { tariffKey?: string | null } | null | undefined): boolean {
  return order?.tariffKey === TOPUP_TARIFF_KEY;
}

/** Ключ идемпотентности строки леджера: одно зачисление на заказ. */
export function topupCreditDedupeKey(orderId: number): string {
  return `topup:${orderId}`;
}

function rub(value: number): string {
  // Обычные пробелы: строка уходит в кассу и в письма.
  return `${new Intl.NumberFormat("ru-RU").format(value).replace(/[  ]/g, " ")} ₽`;
}

/** Описание заказа — в кассе, в истории оплат, в счёте и у ROOT. */
export function topupOrderDescription(amountRub: number, method: "card" | "invoice"): string {
  return `Пополнение баланса на ${rub(amountRub)}${method === "invoice" ? " (счёт)" : ""}`;
}

/** Строка в истории баланса. */
export function topupLedgerDescription(order: {
  id: number;
  paymentMethod?: string | null;
  isTest?: boolean | null;
}): string {
  const how = order.paymentMethod === "invoice" ? "по счёту" : "картой";
  return `Пополнение баланса ${how}, заказ №${order.id}${order.isTest ? " (тестовый платёж)" : ""}`;
}

export type TopupOrderSnapshot = {
  id: number;
  tariffKey: string;
  status: string;
  /** Decimal из БД, число или строка — приводим через toString(). */
  amountRub: number | string | { toString(): string };
  organizationId: string | null;
  userId: string | null;
  isTest: boolean;
  paymentMethod: string;
};

/** Что ядру нужно от леджера (внутри транзакции). */
export type TopupLedger = {
  hasCredit(dedupeKey: string): Promise<boolean>;
  /** +amount к балансу и строка леджера — вместе (applyBalanceChange). */
  credit(entry: {
    organizationId: string;
    amount: number;
    description: string;
    dedupeKey: string;
    paymentOrderId: number;
    actorUserId: string | null;
  }): Promise<void>;
};

export type TopupCreditResult =
  | { status: "credited"; organizationId: string; amountRub: number }
  | { status: "already"; organizationId: string; amountRub: number }
  | {
      status: "skipped";
      reason: "not-topup" | "not-paid" | "no-organization" | "bad-amount";
    };

/** Сумма пополнения из заказа: целые положительные рубли, иначе null. */
export function topupAmountOf(order: Pick<TopupOrderSnapshot, "amountRub">): number | null {
  const amount = Number(order.amountRub.toString());
  return Number.isInteger(amount) && amount > 0 ? amount : null;
}

/**
 * Зачислить оплаченное пополнение. Идемпотентно: повтор по тому же заказу
 * возвращает `already` и баланс не трогает.
 */
export async function creditTopupOrder(
  ledger: TopupLedger,
  order: TopupOrderSnapshot,
  actorUserId: string | null = null,
): Promise<TopupCreditResult> {
  if (!isTopupOrder(order)) return { status: "skipped", reason: "not-topup" };
  if (order.status !== "paid" && order.status !== "completed") {
    return { status: "skipped", reason: "not-paid" };
  }
  if (!order.organizationId) return { status: "skipped", reason: "no-organization" };
  const amountRub = topupAmountOf(order);
  if (amountRub === null) return { status: "skipped", reason: "bad-amount" };

  const dedupeKey = topupCreditDedupeKey(order.id);
  // Проверяем ДО начисления: applyBalanceChange сначала двигает баланс и
  // только потом пишет строку. Гонку страхует unique dedupeKey — он
  // откатит транзакцию целиком (как releaseOrder в checkout.ts).
  if (await ledger.hasCredit(dedupeKey)) {
    return { status: "already", organizationId: order.organizationId, amountRub };
  }
  await ledger.credit({
    organizationId: order.organizationId,
    amount: amountRub,
    description: topupLedgerDescription(order),
    dedupeKey,
    paymentOrderId: order.id,
    actorUserId,
  });
  return { status: "credited", organizationId: order.organizationId, amountRub };
}

/** Транзакция подтверждения оплаты: перевод заказа в paid + леджер. */
export type SettleTx = TopupLedger & {
  /** pending → paid одним условным апдейтом; false — заказ уже не ждал оплаты. */
  claimPending(input: {
    orderId: number;
    paymentMethod?: string;
    paidAt: Date;
    rawResult: unknown;
  }): Promise<boolean>;
  findOrder(orderId: number): Promise<TopupOrderSnapshot | null>;
};

export type SettleStore = {
  transaction<T>(fn: (tx: SettleTx) => Promise<T>): Promise<T>;
};

export type SettleInput = {
  orderId: number;
  /** "invoice" — подтверждение ROOT «Оплата поступила»: только заказы-счета. */
  paymentMethod?: "invoice";
  rawResult: unknown;
  paidAt?: Date;
  /** Кто подтвердил (ROOT для счёта); касса — null. */
  actorUserId?: string | null;
};

export type SettleResult = {
  /** Этот вызов перевёл заказ в paid. false — повторное уведомление или чужой статус. */
  claimed: boolean;
  order: TopupOrderSnapshot | null;
  /** Зачисление пополнения; null — заказ не пополнение (подписка). */
  topup: TopupCreditResult | null;
};

/**
 * Подтверждение оплаты любого заказа — касса (ResultURL) и «Оплата
 * поступила» по счёту. Для подписки это прежний атомарный перевод в paid;
 * для пополнения в той же транзакции баланс получает сумму заказа.
 */
export async function settleOrderPayment(
  store: SettleStore,
  input: SettleInput,
): Promise<SettleResult> {
  return store.transaction(async (tx) => {
    const claimed = await tx.claimPending({
      orderId: input.orderId,
      paymentMethod: input.paymentMethod,
      paidAt: input.paidAt ?? new Date(),
      rawResult: input.rawResult,
    });
    if (!claimed) return { claimed: false, order: null, topup: null };
    const order = await tx.findOrder(input.orderId);
    if (!order || !isTopupOrder(order)) return { claimed: true, order, topup: null };
    const topup = await creditTopupOrder(tx, order, input.actorUserId ?? null);
    return { claimed: true, order, topup };
  });
}
