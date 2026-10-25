// Живая проверка (независимая проверка 2, дефект 1): оплата устаревшего заказа
// тарифа не применяется к подписке. Только локальная БД.
//
// Аккаунт stale@example.test — «Стандарт» помесячно, 15 дней до конца. От этой
// подписки оформляются два заказа — доплата за «Премиум» помесячно и переход
// на «Стандарт» за год; оплачиваются по очереди тем же путём, что у вебхука
// кассы (settlePaidOrder + completePaidOrder). Затем — обратный случай: новая
// подписка, оформленная до покупки «Премиума» на год, оплачивается после неё.
//
// DATABASE_URL=... npx tsx --tsconfig tsconfig.json .agent/tasks/tariffs-v3-2026-10/raw/round2-stale-orders.ts
import bcrypt from "bcryptjs";

import { settlePaidOrder } from "@/lib/balance/topup";
import { db } from "@/lib/db";
import { completePaidOrder } from "@/lib/payment-fulfillment";
import { quoteCheckout } from "@/lib/plan-checkout.server";
import { basePlanSnapshot } from "@/lib/plan-payment";
import type { PlanTarget } from "@/lib/tariff-plans";

const DAY = 24 * 60 * 60 * 1000;

async function makeAccount(email: string, name: string, paid: boolean): Promise<string> {
  const existing = await db.user.findUnique({ where: { email }, select: { organizationId: true } });
  if (existing) await db.paymentOrder.updateMany({ where: { organizationId: existing.organizationId, status: "pending" }, data: { status: "cancelled" } });
  const end = paid ? new Date(Date.now() + 15 * DAY) : null;
  if (existing) {
    const org = await db.organization.findUnique({ where: { id: existing.organizationId }, select: { accountId: true } });
    await db.organization.update({ where: { id: existing.organizationId }, data: { subscriptionPlan: paid ? "standard" : "free", subscriptionEnd: end } });
    if (org?.accountId) {
      await db.account.update({
        where: { id: org.accountId },
        data: { subscriptionPlan: paid ? "standard" : "free", subscriptionEnd: end, planCycle: paid ? "month" : null, planPoints: 1, scheduledPlanJson: undefined },
      });
    }
    return existing.organizationId;
  }
  const org = await db.organization.create({ data: { name, type: "restaurant", subscriptionPlan: paid ? "standard" : "free", subscriptionEnd: end } });
  const user = await db.user.create({
    data: { email, name, passwordHash: await bcrypt.hash("TestPass123!", 10), role: "manager", organizationId: org.id, isActive: true, journalAccessMigrated: true, legalVersion: "2026-09-30" },
  });
  const account = await db.account.create({
    data: { ownerUserId: user.id, subscriptionPlan: paid ? "standard" : "free", subscriptionEnd: end, planCycle: paid ? "month" : null, planPoints: 1 },
  });
  await db.organization.update({ where: { id: org.id }, data: { accountId: account.id } });
  return org.id;
}

/** Заказ так же, как его сохраняет оформление (/api/payments/robokassa/create). */
async function makeOrder(organizationId: string, email: string, target: PlanTarget) {
  const quote = await quoteCheckout({ organizationId, target, now: new Date() });
  if (!quote.ok) throw new Error(`quote refused: ${quote.error}`);
  return db.paymentOrder.create({
    data: {
      email,
      tariffKey: quote.tariffKey,
      amountRub: quote.offer.priceRub,
      baseRub: quote.offer.baseRub,
      description: quote.title,
      status: "pending",
      isTest: true,
      organizationId,
      points: quote.target.points,
      changeKind: quote.change.kind,
      creditRub: quote.change.creditRub,
      periodEndsAt: quote.change.periodEnd,
      basePlanJson: basePlanSnapshot(quote.base),
    },
  });
}

async function pay(orderId: number) {
  await settlePaidOrder({ orderId, rawResult: { simulated: "round2-stale-orders" } });
  const stored = await db.paymentOrder.findUnique({ where: { id: orderId } });
  if (!stored) throw new Error(`order ${orderId} missing`);
  await completePaidOrder(stored);
}

async function show(label: string, organizationId: string) {
  const org = await db.organization.findUnique({
    where: { id: organizationId },
    select: { account: { select: { subscriptionPlan: true, planCycle: true, planPoints: true, subscriptionEnd: true } } },
  });
  const a = org?.account;
  console.log(`${label}: ${a?.subscriptionPlan} · ${a?.planCycle ?? "—"} · точек ${a?.planPoints} · до ${a?.subscriptionEnd?.toISOString().slice(0, 10) ?? "—"}`);
}

async function heldNotice(organizationId: string, orderId: number): Promise<boolean> {
  const row = await db.notification.findFirst({ where: { organizationId, dedupeKey: { contains: `billing.order-held:${orderId}` } }, select: { id: true } });
  return row !== null;
}

async function main() {
  console.log("=== Доплата, оформленная до перехода на год, после него");
  const a = await makeAccount("stale@example.test", "Кафе Устаревший заказ", true);
  await show("подписка", a);
  const upgrade = await makeOrder(a, "stale@example.test", { tier: "premium", cycle: "month", points: 1 });
  const toYear = await makeOrder(a, "stale@example.test", { tier: "standard", cycle: "year", points: 1 });
  console.log(`заказ №${upgrade.id}: ${upgrade.changeKind}, ${upgrade.amountRub} ₽; заказ №${toYear.id}: ${toYear.changeKind}, ${toYear.amountRub} ₽`);
  await pay(toYear.id);
  await show(`после оплаты №${toYear.id} (переход на год)`, a);
  await pay(upgrade.id);
  await show(`после оплаты №${upgrade.id} (устаревшая доплата)`, a);
  console.log(`уведомление руководству о ручном разборе №${upgrade.id}: ${(await heldNotice(a, upgrade.id)) ? "есть" : "нет"}`);

  console.log("\n=== Новая подписка, оформленная до покупки «Премиума» на год");
  const b = await makeAccount("stale-new@example.test", "Кафе Устаревшая новая", false);
  await show("подписка", b);
  const fresh = await makeOrder(b, "stale-new@example.test", { tier: "standard", cycle: "month", points: 1 });
  const premiumYear = await makeOrder(b, "stale-new@example.test", { tier: "premium", cycle: "year", points: 3 });
  console.log(`заказ №${fresh.id}: ${fresh.changeKind}, ${fresh.amountRub} ₽; заказ №${premiumYear.id}: ${premiumYear.changeKind}, ${premiumYear.amountRub} ₽`);
  await pay(premiumYear.id);
  await show(`после оплаты №${premiumYear.id} (Премиум за год, 3 точки)`, b);
  await pay(fresh.id);
  await show(`после оплаты №${fresh.id} (устаревшая новая подписка)`, b);
  console.log(`уведомление руководству о ручном разборе №${fresh.id}: ${(await heldNotice(b, fresh.id)) ? "есть" : "нет"}`);

  console.log("\n=== Обычная оплата (подписка не менялась) применяется");
  const c = await makeAccount("stale-ok@example.test", "Кафе Обычная оплата", true);
  const ok = await makeOrder(c, "stale-ok@example.test", { tier: "premium", cycle: "month", points: 1 });
  console.log(`заказ №${ok.id}: ${ok.changeKind}, ${ok.amountRub} ₽`);
  await pay(ok.id);
  await show(`после оплаты №${ok.id} (доплата)`, c);
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  }
);
