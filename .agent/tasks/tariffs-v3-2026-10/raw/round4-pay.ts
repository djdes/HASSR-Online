// Оплата заказа тем же путём, что у вебхука кассы (settlePaidOrder +
// completePaidOrder), и итог: подписка аккаунта плательщика и отметка разбора.
// Только локальная БД.
//
// DATABASE_URL=... npx tsx --tsconfig tsconfig.json .agent/tasks/tariffs-v3-2026-10/raw/round4-pay.ts <orderId>
import { settlePaidOrder } from "@/lib/balance/topup";
import { db } from "@/lib/db";
import { completePaidOrder } from "@/lib/payment-fulfillment";

async function main() {
  console.info = () => {};
  const orderId = Number(process.argv[2]);
  await settlePaidOrder({ orderId, rawResult: { simulated: "round4-pay" } });
  const stored = await db.paymentOrder.findUnique({ where: { id: orderId } });
  await completePaidOrder(stored!);
  const order = await db.paymentOrder.findUnique({ where: { id: orderId }, select: { status: true, heldAt: true, email: true } });
  const user = await db.user.findUnique({
    where: { email: order!.email },
    select: { organization: { select: { account: { select: { subscriptionPlan: true, planCycle: true, planPoints: true, subscriptionEnd: true } } } } },
  });
  const a = user?.organization.account;
  console.log(`    заказ №${orderId}: ${order!.status}${order!.heldAt ? " · на разборе — ОШИБКА" : " · применён"}`);
  console.log(`    подписка: ${a?.subscriptionPlan} · ${a?.planCycle} · точек ${a?.planPoints} · до ${a?.subscriptionEnd?.toISOString().slice(0, 16).replace("T", " ")}`);
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  }
);
