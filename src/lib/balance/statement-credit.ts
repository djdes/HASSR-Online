import type { Prisma } from "@prisma/client";

/**
 * Поступление из выписки банка, зачисленное на баланс, пока похожий счёт
 * ещё открыт (src/lib/sber/balance-credit.ts): платёж пришёл с «чужой»
 * суммой, деньги ушли на баланс своим заказом-пополнением, а запись
 * `SberIncomingPayment.reviewOrderId` помнит счёт. Когда админ потом жмёт
 * по этому счёту «Оплата поступила», деньги второй раз не зачисляются:
 * пополнение по счёту считается проведённым, а у тарифа остаётся только
 * списание с баланса.
 */
export async function hasStatementCreditForOrder(tx: Prisma.TransactionClient, orderId: number): Promise<boolean> {
  const row = await tx.sberIncomingPayment.findFirst({
    where: { reviewOrderId: orderId, status: "credited" },
    select: { id: true },
  });
  return row !== null;
}
