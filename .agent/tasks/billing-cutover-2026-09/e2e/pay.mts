// Проведённая оплата заказа (тестовый заказ Робокассы, без кассы): тот же
// fulfillPaidOrder, что вызывают вебхук и «оплата баллами». Запуск из C:/wt/billing:
//   node --env-file=.env --import tsx <этот файл> <orderId>
const { db } = await import("file:///C:/wt/billing/src/lib/db.ts");
const { fulfillPaidOrder } = await import("file:///C:/wt/billing/src/lib/payment-fulfillment.ts");

const id = Number(process.argv[2]);
const order = await db.paymentOrder.findUnique({ where: { id } });
if (!order) throw new Error(`order ${id} not found`);
const result = await fulfillPaidOrder(order);
console.log(JSON.stringify({ orderId: id, organizationId: result.organizationId, subscriptionEnd: result.subscriptionEnd }));
process.exit(0);
