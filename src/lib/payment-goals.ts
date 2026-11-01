import { ymGoal } from "@/lib/signup-source";

/**
 * Цели Метрики на странице оплаты (2026-11-01): без них не посчитать, во
 * что обходится оплата из рекламы. `order_start` — нажали «Оплатить»,
 * `payment_success` — заказ оплачен (сумма в `order_price`, один раз на
 * заказ даже после обновления страницы), `invoice_request` — гость получил
 * счёт по ИНН.
 */

export const PAYMENT_GOALS = {
  start: "order_start",
  success: "payment_success",
  invoice: "invoice_request",
} as const;

const REPORTED_KEY = "wesetup.payment-goal";

/** Один раз на заказ: ключ в sessionStorage; без хранилища — просто шлём. */
export function reportPaymentSuccess(order: { invId: number; amountRub: number; status: string; isTest?: boolean }): boolean {
  if (order.status !== "paid" && order.status !== "completed") return false;
  if (order.isTest) return false;
  const key = `${REPORTED_KEY}:${order.invId}`;
  try {
    if (window.sessionStorage.getItem(key)) return false;
    window.sessionStorage.setItem(key, "1");
  } catch {
    /* sessionStorage недоступен — цель всё равно шлём */
  }
  ymGoal(PAYMENT_GOALS.success, { order_price: Math.round(order.amountRub), currency: "RUB" });
  return true;
}
