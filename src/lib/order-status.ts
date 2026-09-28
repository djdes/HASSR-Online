/**
 * Подпись статуса заказа для таблиц истории оплат — одна на кабинет и
 * ROOT-карточку, чтобы «pending» не показывался сырым словом.
 */
export function orderStatusLabel(order: { status: string; paymentMethod?: string | null }): string {
  // completed — оплачен, и новый клиент уже дозаполнил профиль.
  if (order.status === "paid" || order.status === "completed") return "оплачен";
  if (order.status === "expired") return "истёк";
  if (order.status === "cancelled") return "отменён";
  if (order.status === "pending") {
    return order.paymentMethod === "invoice" ? "ждёт оплаты по счёту" : "ожидает оплаты";
  }
  return order.status;
}
