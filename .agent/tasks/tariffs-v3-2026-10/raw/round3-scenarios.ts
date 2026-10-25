// Живая проверка (независимая проверка 3): сверка оплаты по снимку подписки.
// Только локальная БД. Оплата идёт тем же путём, что у кассы (settlePaidOrder +
// completePaidOrder) и у ROOT «Оплата поступила» для счёта (markInvoicePaid).
//
// DATABASE_URL=... npx tsx --tsconfig tsconfig.json .agent/tasks/tariffs-v3-2026-10/raw/round3-scenarios.ts
import bcrypt from "bcryptjs";

import { settlePaidOrder } from "@/lib/balance/topup";
import { closingEligibility } from "@/lib/closing-documents/service";
import { readPlatformRequisites } from "@/lib/closing-documents/requisites";
import { db } from "@/lib/db";
import { createInvoiceOrder, markInvoicePaid } from "@/lib/invoices/service";
import { completePaidOrder } from "@/lib/payment-fulfillment";
import { quoteCheckout } from "@/lib/plan-checkout.server";
import { basePlanSnapshot } from "@/lib/plan-payment";
import type { PlanTarget } from "@/lib/tariff-plans";

const DAY = 24 * 60 * 60 * 1000;
const day = (d: Date | null | undefined) => d?.toISOString().slice(0, 16).replace("T", " ") ?? "—";

/** Аккаунт с подпиской «Стандарт» помесячно (end) или без неё (null). */
async function account(email: string, name: string, end: Date | null): Promise<{ orgId: string; userId: string }> {
  const existing = await db.user.findUnique({ where: { email }, select: { id: true, organizationId: true } });
  let orgId: string;
  let userId: string;
  if (existing) {
    orgId = existing.organizationId;
    userId = existing.id;
    await db.paymentOrder.updateMany({ where: { organizationId: orgId, status: "pending" }, data: { status: "cancelled" } });
  } else {
    const org = await db.organization.create({ data: { name, type: "restaurant", subscriptionPlan: "free" } });
    const user = await db.user.create({
      data: { email, name, passwordHash: await bcrypt.hash("TestPass123!", 10), role: "manager", organizationId: org.id, isActive: true, journalAccessMigrated: true, legalVersion: "2026-09-30" },
    });
    const acc = await db.account.create({ data: { ownerUserId: user.id, subscriptionPlan: "free" } });
    await db.organization.update({ where: { id: org.id }, data: { accountId: acc.id } });
    orgId = org.id;
    userId = user.id;
  }
  const plan = end ? "standard" : "free";
  const org = await db.organization.update({ where: { id: orgId }, data: { subscriptionPlan: plan, subscriptionEnd: end, inn: "7707083893" }, select: { accountId: true } });
  await db.account.update({
    where: { id: org.accountId! },
    data: { subscriptionPlan: plan, subscriptionEnd: end, planCycle: end ? "month" : null, planPoints: 1, createdAt: new Date(Date.now() - 60 * DAY), trialEndsAt: new Date(Date.now() - 40 * DAY) },
  });
  return { orgId, userId };
}

async function quotedOrder(orgId: string, email: string, target: PlanTarget, extra: { paymentMethod?: string } = {}) {
  const quote = await quoteCheckout({ organizationId: orgId, target, now: new Date() });
  if (!quote.ok) throw new Error(`quote refused: ${quote.error}`);
  return db.paymentOrder.create({
    data: {
      email,
      tariffKey: quote.tariffKey,
      amountRub: quote.offer.priceRub,
      baseRub: quote.offer.baseRub,
      description: quote.title,
      status: "pending",
      isTest: false,
      organizationId: orgId,
      points: quote.target.points,
      changeKind: quote.change.kind,
      creditRub: quote.change.creditRub,
      periodEndsAt: quote.change.periodEnd,
      basePlanJson: basePlanSnapshot(quote.base),
      ...(extra.paymentMethod ? { paymentMethod: extra.paymentMethod, invoiceDueAt: new Date(Date.now() + 7 * DAY) } : {}),
    },
  });
}

async function payCard(orderId: number) {
  await settlePaidOrder({ orderId, rawResult: { simulated: "round3-scenarios" } });
  const stored = await db.paymentOrder.findUnique({ where: { id: orderId } });
  await completePaidOrder(stored!);
}

async function subscription(orgId: string): Promise<string> {
  const org = await db.organization.findUnique({ where: { id: orgId }, select: { account: { select: { subscriptionPlan: true, planCycle: true, planPoints: true, subscriptionEnd: true } } } });
  const a = org!.account!;
  return `${a.subscriptionPlan} · ${a.planCycle ?? "—"} · точек ${a.planPoints} · до ${day(a.subscriptionEnd)}`;
}

async function orderState(orderId: number): Promise<string> {
  const o = await db.paymentOrder.findUnique({ where: { id: orderId }, select: { status: true, heldAt: true } });
  const audit = await db.auditLog.count({ where: { action: "billing.order-held", entityId: String(orderId) } });
  return `заказ №${orderId}: ${o!.status}${o!.heldAt ? " · на разборе (heldAt)" : ""}${audit ? " · аудит есть" : ""}`;
}

async function main() {
  const now = Date.now();

  console.log("=== S1. Продление картой, оплаченное после конца срока (заказ оформлен за 3 дня до конца)");
  {
    const end = new Date(now - 2 * DAY);
    const { orgId } = await account("r3-renew@example.test", "R3 Продление после срока", end);
    const created = new Date(now - 5 * DAY);
    const order = await db.paymentOrder.create({
      data: {
        email: "r3-renew@example.test", tariffKey: "standard_month", amountRub: 3000, baseRub: 3000, description: "Тариф «Стандарт» на месяц (продление)",
        status: "pending", isTest: false, organizationId: orgId, points: 1, changeKind: "renew", periodEndsAt: new Date(end.getTime() + 30 * DAY), createdAt: created,
        basePlanJson: basePlanSnapshot({ tier: "standard", cycle: "month", points: 1, paidUntil: end }),
      },
    });
    console.log(`подписка: ${await subscription(orgId)}`);
    await payCard(order.id);
    console.log(`после оплаты: ${await subscription(orgId)} (ожидание: +30 дней от сегодня)`);
    console.log(await orderState(order.id));
  }

  console.log("\n=== S2. Продление по счёту: ROOT отмечает оплату после конца срока");
  {
    const end = new Date(now - 2 * DAY);
    const { orgId } = await account("r3-invoice@example.test", "R3 Счёт после срока", end);
    const root = await db.user.findFirst({ where: { isRoot: true }, select: { id: true } });
    const order = await db.paymentOrder.create({
      data: {
        email: "r3-invoice@example.test", tariffKey: "standard_month", amountRub: 3000, baseRub: 3000, description: "Тариф «Стандарт» на месяц (счёт; продление)",
        status: "pending", isTest: false, organizationId: orgId, points: 1, changeKind: "renew", periodEndsAt: new Date(end.getTime() + 30 * DAY), createdAt: new Date(now - 5 * DAY),
        paymentMethod: "invoice", invoiceDueAt: new Date(now + 2 * DAY),
        basePlanJson: basePlanSnapshot({ tier: "standard", cycle: "month", points: 1, paidUntil: end }),
      },
    });
    const marked = await markInvoicePaid(order.id, root!.id);
    console.log(`ROOT «Оплата поступила»: ${marked.ok ? "ok" : marked.error}`);
    console.log(`после оплаты: ${await subscription(orgId)} (ожидание: +30 дней от сегодня)`);
    console.log(await orderState(order.id));
  }

  console.log("\n=== S3. ROOT поднял цену между оформлением и оплатой");
  {
    const { orgId } = await account("r3-price@example.test", "R3 Смена цены", null);
    const order = await quotedOrder(orgId, "r3-price@example.test", { tier: "standard", cycle: "month", points: 1 });
    const before = await db.platformTariff.findUnique({ where: { key: "standard_month" }, select: { priceRub: true } });
    await db.platformTariff.update({ where: { key: "standard_month" }, data: { priceRub: (before?.priceRub ?? 3000) + 300 } });
    try {
      await payCard(order.id);
    } finally {
      await db.platformTariff.update({ where: { key: "standard_month" }, data: { priceRub: before?.priceRub ?? 3000 } });
    }
    console.log(`заказ №${order.id} (${order.changeKind}, ${order.amountRub} ₽), цена тарифа на время оплаты +300 ₽ (после — возвращена)`);
    console.log(`после оплаты: ${await subscription(orgId)}`);
    console.log(await orderState(order.id));
  }

  console.log("\n=== S4. Доплата, оформленная до перехода на год, после него — на разбор");
  {
    const { orgId } = await account("r3-stale@example.test", "R3 Устаревшая доплата", new Date(now + 15 * DAY));
    const upgrade = await quotedOrder(orgId, "r3-stale@example.test", { tier: "premium", cycle: "month", points: 1 });
    const toYear = await quotedOrder(orgId, "r3-stale@example.test", { tier: "standard", cycle: "year", points: 1 });
    await payCard(toYear.id);
    console.log(`после перехода на год (№${toYear.id}): ${await subscription(orgId)}`);
    await payCard(upgrade.id);
    console.log(`после устаревшей доплаты (№${upgrade.id}): ${await subscription(orgId)}`);
    console.log(await orderState(upgrade.id));
    const held = await db.paymentOrder.findUnique({ where: { id: upgrade.id }, select: { status: true, isTest: true, amountRub: true, refundedAt: true, heldAt: true, tariffKey: true } });
    console.log(`УПД по нему: ${JSON.stringify(closingEligibility(held!, await readPlatformRequisites()))}`);
  }

  console.log("\n=== S5. Обычная доплата применяется");
  {
    const { orgId } = await account("r3-ok@example.test", "R3 Обычная доплата", new Date(now + 15 * DAY));
    const order = await quotedOrder(orgId, "r3-ok@example.test", { tier: "premium", cycle: "month", points: 1 });
    await payCard(order.id);
    console.log(`после оплаты №${order.id}: ${await subscription(orgId)}`);
    console.log(await orderState(order.id));
  }

  console.log("\n=== S6. Счёт «новая подписка», затем оплата картой: прежний счёт закрывается, повторный — новый");
  {
    const { orgId, userId } = await account("r3-reuse@example.test", "R3 Повтор счёта", null);
    const target: PlanTarget = { tier: "standard", cycle: "month", points: 1 };
    const first = await createInvoiceOrder({ organizationId: orgId, userId, email: "r3-reuse@example.test", target });
    if (!first.ok) throw new Error(first.error);
    console.log(`счёт №${first.order.id}: ${first.order.changeKind}, ${first.order.amountRub} ₽`);
    const again = await createInvoiceOrder({ organizationId: orgId, userId, email: "r3-reuse@example.test", target });
    console.log(`повтор сразу: ${again.ok ? `№${again.order.id}, created=${again.created}` : again.error}`);
    const card = await quotedOrder(orgId, "r3-reuse@example.test", target);
    await payCard(card.id);
    console.log(`после оплаты картой №${card.id}: ${await subscription(orgId)}; счёт №${first.order.id} — ${(await db.paymentOrder.findUnique({ where: { id: first.order.id }, select: { status: true } }))!.status}`);
    const third = await createInvoiceOrder({ organizationId: orgId, userId, email: "r3-reuse@example.test", target });
    console.log(`новый запрос счёта: ${third.ok ? `№${third.order.id}, ${third.order.changeKind}, created=${third.created}` : third.error}`);
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  }
);
