/**
 * Подпись статуса заказа для таблиц истории оплат — одна на кабинет и
 * ROOT-карточку, чтобы «pending» не показывался сырым словом.
 */
export function orderStatusLabel(
  order: { status: string; paymentMethod?: string | null; heldAt?: Date | null; invoiceDueAt?: Date | null },
  now: Date = new Date()
): string {
  // Оплачен, но к тарифу не применён: подписка изменилась после оформления,
  // оплату разбирают вручную.
  if (order.status === "paid" && order.heldAt) return "оплачен — применим вручную";
  // completed — оплачен, и новый клиент уже дозаполнил профиль.
  if (order.status === "paid" || order.status === "completed") return "оплачен";
  if (order.status === "expired") return "истёк";
  if (order.status === "cancelled") return "отменён";
  if (order.status === "pending") {
    if (order.paymentMethod !== "invoice") return "ожидает оплаты";
    // Срок оплаты счёта прошёл — платить по нему уже не нужно.
    return order.invoiceDueAt && order.invoiceDueAt.getTime() <= now.getTime() ? "счёт истёк" : "ждёт оплаты по счёту";
  }
  return order.status;
}
