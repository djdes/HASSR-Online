// Живая проверка (независимая проверка 6). Только локальная БД. Оплата идёт
// тем же путём, что у кассы (settlePaidOrder + completePaidOrder) и у ROOT
// «Оплата поступила» для счёта (markInvoicePaid).
//
// DATABASE_URL=... npx tsx --tsconfig tsconfig.json .agent/tasks/tariffs-v3-2026-10/raw/round6-scenarios.ts
import bcrypt from "bcryptjs";

import { createOrderWithPoints } from "@/lib/balance/checkout";
import { applyBalanceChange } from "@/lib/balance/ledger";
import { settlePaidOrder } from "@/lib/balance/topup";
import { db } from "@/lib/db";
import { createDemoOrganization } from "@/lib/demo-organization";
import { markInvoicePaid } from "@/lib/invoices/service";
import { completePaidOrder } from "@/lib/payment-fulfillment";
import { quoteCheckout } from "@/lib/plan-checkout.server";
import { basePlanSnapshot } from "@/lib/plan-payment";

const DAY = 24 * 60 * 60 * 1000;
const day = (d: Date | null | undefined) => d?.toISOString().slice(0, 16).replace("T", " ") ?? "—";

type Made = { orgId: string; userId: string; accountId: string };

async function account(email: string, name: string, opts: { plan: string; end: Date | null; cycle?: string }): Promise<Made> {
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
  const org = await db.organization.update({
    where: { id: orgId },
    data: { subscriptionPlan: opts.plan, subscriptionEnd: opts.end, inn: "7707083893" },
    select: { accountId: true },
  });
  await db.account.update({
    where: { id: org.accountId! },
    data: {
      subscriptionPlan: opts.plan,
      subscriptionEnd: opts.end,
      planCycle: opts.end ? (opts.cycle ?? "month") : null,
      planPoints: 1,
      createdAt: new Date(Date.now() - 60 * DAY),
      trialEndsAt: new Date(Date.now() - 40 * DAY),
    },
  });
  return { orgId, userId, accountId: org.accountId! };
}

async function payCard(orderId: number) {
  await settlePaidOrder({ orderId, rawResult: { simulated: "round6-scenarios" } });
  const stored = await db.paymentOrder.findUnique({ where: { id: orderId } });
  await completePaidOrder(stored!);
}

async function subscription(orgId: string): Promise<string> {
  const org = await db.organization.findUnique({
    where: { id: orgId },
    select: { account: { select: { subscriptionPlan: true, planCycle: true, planPoints: true, subscriptionEnd: true } } },
  });
  const a = org!.account!;
  return `${a.subscriptionPlan} · ${a.planCycle ?? "—"} · точек ${a.planPoints} · до ${day(a.subscriptionEnd)}`;
}

async function orderState(orderId: number): Promise<string> {
  const o = await db.paymentOrder.findUnique({ where: { id: orderId }, select: { status: true, heldAt: true } });
  return `заказ №${orderId}: ${o!.status}${o!.heldAt ? " · на разборе (heldAt)" : " · применён"}`;
}

async function main() {
  const now = Date.now();
  console.info = () => {};

  console.log("=== S1. Сотрудник, чья организация — демо аккаунта «Премиум»");
  {
    const owner = await account("r6-demo-owner@example.test", "R6 Премиум с демо", { plan: "premium", end: new Date(now + 40 * DAY) });
    const demo = await createDemoOrganization({ accountId: owner.accountId, ownerUserId: owner.userId, sphere: "restaurant" });
    const cookEmail = "r6-demo-cook@example.test";
    const found = await db.user.findUnique({ where: { email: cookEmail }, select: { id: true } });
    if (found) await db.user.update({ where: { id: found.id }, data: { organizationId: demo.organizationId, isActive: true, archivedAt: null } });
    else {
      await db.user.create({
        data: { email: cookEmail, name: "Повар R6 в демо", passwordHash: await bcrypt.hash("TestPass123!", 10), role: "cook", organizationId: demo.organizationId, isActive: true, journalAccessMigrated: true, legalVersion: "2026-09-30" },
      });
    }
    await db.paymentOrder.updateMany({ where: { email: cookEmail, status: "pending" }, data: { status: "cancelled" } });
    console.log(`подписка аккаунта: ${await subscription(owner.orgId)}; демо-организация ${demo.organizationId} (${demo.created ? "создана" : "уже была"})`);
    const quote = await quoteCheckout({ organizationId: null, target: { tier: "standard", cycle: "month", points: 1 }, now: new Date(), payer: { email: cookEmail, guest: false } });
    console.log(`расчёт для повара: ${quote.ok ? `ОШИБКА — ${quote.change.kind}, ${quote.offer.priceRub} ₽` : `${quote.status} ${quote.code}: ${quote.error}`}`);
    // Страховка оплаты: заказ, как его сохранял прежний путь (без организации, «новая», без подписки в снимке).
    const legacy = await db.paymentOrder.create({
      data: {
        email: cookEmail, tariffKey: "standard_month", amountRub: 3000, baseRub: 3000, description: "Тариф «Стандарт» на месяц",
        status: "pending", isTest: false, points: 1, changeKind: "new", periodEndsAt: new Date(now + 30 * DAY), basePlanJson: basePlanSnapshot(null),
      },
    });
    await payCard(legacy.id);
    console.log(`оплата такого заказа: ${await orderState(legacy.id)}; подписка аккаунта: ${await subscription(owner.orgId)}`);
  }

  console.log("\n=== S2. Переход на год по счёту: счёт выставлен 6 дней назад (7 дней остатка в зачёте), оплачен сегодня");
  {
    const end = new Date(now + 1 * DAY);
    const { orgId } = await account("r6-switch@example.test", "R6 Переход на год по счёту", { plan: "standard", end });
    const created = new Date(now - 6 * DAY);
    const root = await db.user.findFirst({ where: { isRoot: true }, select: { id: true } });
    // Как сохранило оформление 6 дней назад: зачёт 700 ₽, конец — через 365 дней от счёта.
    const order = await db.paymentOrder.create({
      data: {
        email: "r6-switch@example.test", tariffKey: "standard_year", amountRub: 23180, baseRub: 23880, creditRub: 700,
        description: "Тариф «Стандарт» за год (счёт; зачтён остаток 700 ₽)", status: "pending", isTest: false, organizationId: orgId, points: 1,
        changeKind: "switch", periodEndsAt: new Date(created.getTime() + 365 * DAY), createdAt: created,
        paymentMethod: "invoice", invoiceDueAt: end, basePlanJson: basePlanSnapshot({ tier: "standard", cycle: "month", points: 1, paidUntil: end }),
      },
    });
    const marked = await markInvoicePaid(order.id, root!.id);
    console.log(`ROOT «Оплата поступила»: ${marked.ok ? "ok" : marked.error}`);
    console.log(`после оплаты: ${await subscription(orgId)} (ожидание: год до ${day(new Date(created.getTime() + 365 * DAY))}, как в счёте)`);
    console.log(await orderState(order.id));
  }

  console.log("\n=== S3. Подготовка: обычная оплата и оплата на разборе с баллами (итог «оплачено» проверяет round6-check.sh)");
  {
    const { orgId, userId } = await account("r6-totals@example.test", "R6 Итоги оплат", { plan: "standard", end: new Date(now + 15 * DAY) });
    await db.paymentOrder.updateMany({ where: { organizationId: orgId }, data: { status: "cancelled" } });
    const quote = await quoteCheckout({ organizationId: orgId, target: { tier: "standard", cycle: "month", points: 1 }, now: new Date() });
    if (!quote.ok) throw new Error(quote.error);
    const renew = await db.paymentOrder.create({
      data: {
        email: "r6-totals@example.test", tariffKey: quote.tariffKey, amountRub: quote.offer.priceRub, baseRub: quote.offer.baseRub, description: quote.title,
        status: "pending", isTest: false, organizationId: orgId, points: 1, changeKind: quote.change.kind, periodEndsAt: quote.change.periodEnd,
        basePlanJson: basePlanSnapshot(quote.base),
      },
    });
    await payCard(renew.id);
    console.log(`продление: ${await orderState(renew.id)}, ${quote.offer.priceRub} ₽`);
    await db.organization.update({ where: { id: orgId }, data: { balanceRub: 0 } });
    await db.$transaction((tx) => applyBalanceChange(tx, { organizationId: orgId, amount: 400, kind: "manual_adjust", description: "round6: баллы для оплаты" }));
    const realEnd = (await db.organization.findUnique({ where: { id: orgId }, select: { subscriptionEnd: true } }))!.subscriptionEnd!;
    const stale = await createOrderWithPoints({
      organizationId: orgId, userId, email: "r6-totals@example.test", tariffKey: "premium_month", description: "Тариф «Премиум» на месяц (доплата)",
      grossRub: 1000, subscriptionRub: 1000, bundleConfig: null, isTest: false, recurringConsent: false, partnerSlug: null, referrerOrganizationId: null,
      usePoints: true, baseRub: 1000, points: 1, changeKind: "upgrade", periodEndsAt: realEnd,
      basePlanJson: basePlanSnapshot({ tier: "standard", cycle: "month", points: 1, paidUntil: new Date(realEnd.getTime() - 5 * DAY) }),
    });
    await payCard(stale.id);
    console.log(`доплата со старым снимком: ${await orderState(stale.id)}, ${stale.amountRub} ₽ + ${stale.pointsSpent} баллов`);
  }

  console.log("\n=== S4. Подготовка: «Стандарт» помесячно, 3 дня до конца (срок счёта на доплату проверяет round6-check.sh)");
  {
    const end = new Date(now + 3 * DAY);
    await account("r6-due@example.test", "R6 Срок счёта", { plan: "standard", end });
    console.log(`подписка до ${day(end)} (МСК: ${end.toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })})`);
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  }
);
