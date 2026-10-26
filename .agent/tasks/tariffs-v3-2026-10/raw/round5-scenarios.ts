// Живая проверка (независимая проверка 5). Только локальная БД. Оплата идёт
// тем же путём, что у кассы (settlePaidOrder + completePaidOrder); заказ с
// баллами — той же функцией, что у страницы оплаты (createOrderWithPoints).
//
// DATABASE_URL=... npx tsx --tsconfig tsconfig.json .agent/tasks/tariffs-v3-2026-10/raw/round5-scenarios.ts
import bcrypt from "bcryptjs";

import { createOrderWithPoints } from "@/lib/balance/checkout";
import { applyBalanceChange } from "@/lib/balance/ledger";
import { settlePaidOrder } from "@/lib/balance/topup";
import { loadAccountBilling, transitionToFree } from "@/lib/billing.server";
import { db } from "@/lib/db";
import { completePaidOrder } from "@/lib/payment-fulfillment";
import { basePlanSnapshot } from "@/lib/plan-payment";

const DAY = 24 * 60 * 60 * 1000;
const day = (d: Date | null | undefined) => d?.toISOString().slice(0, 16).replace("T", " ") ?? "—";

type Made = { orgId: string; userId: string; accountId: string };

/** Аккаунт с руководителем; plan/end — как у подписки. */
async function account(
  email: string,
  name: string,
  opts: { plan: string; end: Date | null; createdAt?: Date; trialEndsAt?: Date | null }
): Promise<Made> {
  const existing = await db.user.findUnique({ where: { email }, select: { id: true, organizationId: true } });
  let orgId: string;
  let userId: string;
  if (existing) {
    orgId = existing.organizationId;
    userId = existing.id;
    await db.paymentOrder.updateMany({ where: { organizationId: orgId, status: "pending" }, data: { status: "cancelled" } });
    await db.paymentOrder.updateMany({ where: { organizationId: orgId, heldAt: { not: null } }, data: { heldAt: null } });
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
  await db.user.update({ where: { id: userId }, data: { isActive: true, archivedAt: null } });
  const org = await db.organization.update({
    where: { id: orgId },
    data: { subscriptionPlan: opts.plan, subscriptionEnd: opts.end, inn: "7707083893", disabledJournalCodes: [] },
    select: { accountId: true },
  });
  await db.account.update({
    where: { id: org.accountId! },
    data: {
      subscriptionPlan: opts.plan,
      subscriptionEnd: opts.end,
      planCycle: opts.end ? "month" : null,
      planPoints: 1,
      scheduledPlanJson: undefined,
      createdAt: opts.createdAt ?? new Date(Date.now() - 60 * DAY),
      trialEndsAt: opts.trialEndsAt === undefined ? new Date(Date.now() - 40 * DAY) : opts.trialEndsAt,
    },
  });
  return { orgId, userId, accountId: org.accountId! };
}

async function staff(email: string, name: string, orgId: string, role = "cook") {
  const found = await db.user.findUnique({ where: { email }, select: { id: true } });
  if (found) {
    await db.user.update({ where: { id: found.id }, data: { isActive: true, archivedAt: null, organizationId: orgId, role } });
    return;
  }
  await db.user.create({
    data: { email, name, passwordHash: await bcrypt.hash("TestPass123!", 10), role, organizationId: orgId, isActive: true, journalAccessMigrated: true, legalVersion: "2026-09-30" },
  });
}

async function payCard(orderId: number) {
  await settlePaidOrder({ orderId, rawResult: { simulated: "round5-scenarios" } });
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
  const o = await db.paymentOrder.findUnique({ where: { id: orderId }, select: { status: true, heldAt: true, pointsSpent: true } });
  return `заказ №${orderId}: ${o!.status}${o!.heldAt ? " · на разборе (heldAt)" : " · применён"}${o!.pointsSpent ? ` · баллами ${o!.pointsSpent}` : ""}`;
}

async function balance(orgId: string): Promise<number> {
  return (await db.organization.findUnique({ where: { id: orgId }, select: { balanceRub: true } }))?.balanceRub ?? 0;
}

async function referralRewards(referredOrgId: string): Promise<number> {
  return db.balanceTransaction.count({ where: { kind: "referral_reward", referredOrganizationId: referredOrgId } });
}

/** Заказ «Премиум» помесячно (доплата) со снимком, который уже не совпадёт с подпиской — оплата уйдёт на разбор. */
async function staleUpgradeWithPoints(orgId: string, userId: string, email: string, promoCode: string | null) {
  const realEnd = (await db.organization.findUnique({ where: { id: orgId }, select: { subscriptionEnd: true } }))!.subscriptionEnd!;
  const created = await createOrderWithPoints({
    organizationId: orgId,
    userId,
    email,
    tariffKey: "premium_month",
    description: "Тариф «Премиум» на месяц (доплата)",
    grossRub: 1000,
    subscriptionRub: 1000,
    bundleConfig: null,
    isTest: false,
    recurringConsent: false,
    partnerSlug: null,
    referrerOrganizationId: null,
    usePoints: true,
    promoCode,
    discountRub: promoCode ? 100 : 0,
    baseRub: 1100,
    points: 1,
    changeKind: "upgrade",
    periodEndsAt: realEnd,
    // Снимок — от подписки, срок которой с тех пор сдвинули (ROOT сократил на 5 дней).
    basePlanJson: basePlanSnapshot({ tier: "standard", cycle: "month", points: 1, paidUntil: new Date(realEnd.getTime() + 5 * DAY) }),
  });
  return created;
}

async function main() {
  const now = Date.now();
  console.info = () => {};

  console.log("=== S1. «Новая» из последних суток срока, аккаунт перевели на бесплатный, затем оплата");
  {
    const end = new Date(now - 2 * DAY);
    const { orgId } = await account("r5-lastday-free@example.test", "R5 Последние сутки и бесплатный", { plan: "standard", end });
    const order = await db.paymentOrder.create({
      data: {
        email: "r5-lastday-free@example.test", tariffKey: "standard_month", amountRub: 3000, baseRub: 3000, description: "Тариф «Стандарт» на месяц (счёт)",
        // Как сохраняет оформление: «новая» — 30 дней с даты заказа.
        status: "pending", isTest: false, organizationId: orgId, points: 1, changeKind: "new",
        periodEndsAt: new Date(end.getTime() - 10 * 60 * 60 * 1000 + 30 * DAY),
        paymentMethod: "invoice", invoiceDueAt: new Date(now + 3 * DAY), createdAt: new Date(end.getTime() - 10 * 60 * 60 * 1000),
        basePlanJson: basePlanSnapshot({ tier: "standard", cycle: "month", points: 1, paidUntil: end }),
      },
    });
    const r = await transitionToFree({ organizationId: orgId, mode: "auto", actor: { userId: null, userName: "WeSetup" } });
    console.log(`переход на бесплатный: ${r.ok ? "ok" : r.error}; подписка: ${await subscription(orgId)}`);
    await payCard(order.id);
    console.log(`после оплаты: ${await subscription(orgId)} (ожидание: Стандарт до ${day(new Date(now + 30 * DAY))} ± минуты)`);
    console.log(await orderState(order.id));
  }

  console.log("\n=== S2. Подготовка: приглашённое заведение, оплата на разборе с баллами и кодом скидки навсегда");
  {
    const referrer = await account("r5-referrer@example.test", "R5 Пригласивший", { plan: "standard", end: new Date(now + 30 * DAY) });
    await db.promoCode.upsert({
      where: { code: "R5LIFE" },
      update: { active: true, lifetime: true, kind: "percent", value: 10 },
      create: { code: "R5LIFE", kind: "percent", value: 10, lifetime: true, note: "round5 — проверка привязки при разборе" },
    });
    for (const [email, name, promo] of [
      ["r5-ref-apply@example.test", "R5 Приглашённое (применим)", "R5LIFE"],
      ["r5-ref-refund@example.test", "R5 Приглашённое (вернём)", null],
    ] as const) {
      const made = await account(email, name, { plan: "standard", end: new Date(now + 15 * DAY) });
      await db.organization.update({ where: { id: made.orgId }, data: { referredByOrganizationId: referrer.orgId, balanceRub: 0 } });
      await db.balanceTransaction.deleteMany({ where: { referredOrganizationId: made.orgId, kind: "referral_reward" } });
      await db.accountLifetimeDiscount.deleteMany({ where: { accountId: made.accountId } });
      await db.$transaction((tx) =>
        applyBalanceChange(tx, { organizationId: made.orgId, amount: 400, kind: "manual_adjust", description: "round5: баллы для оплаты" })
      );
      const order = await staleUpgradeWithPoints(made.orgId, made.userId, email, promo);
      await payCard(order.id);
      console.log(`${name}: ${await orderState(order.id)}; баланс ${await balance(made.orgId)}; награда пригласившему: ${await referralRewards(made.orgId)}; скидка навсегда: ${(await db.accountLifetimeDiscount.count({ where: { accountId: made.accountId } })) ? "привязана" : "нет"}`);
    }
  }

  console.log("\n=== S3. Подготовка: «Стандарт» помесячно, 3 дня до конца — счёт на доплату (PDF проверяет round5-check.sh)");
  {
    await account("r5-due@example.test", "R5 Срок счёта в PDF", { plan: "standard", end: new Date(now + 3 * DAY) });
    console.log(`подписка до ${day(new Date(now + 3 * DAY))}`);
  }

  console.log("\n=== S4. Подготовка: оплаченный аккаунт для демо-организации");
  {
    const { orgId } = await account("r5-demo@example.test", "R5 Демо-проверка", { plan: "premium", end: new Date(now + 40 * DAY) });
    console.log(`подписка: ${await subscription(orgId)}`);
  }

  console.log("\n=== S5. Подготовка: окно решения после пробного, повар в мини-приложении");
  {
    const { orgId } = await account("r5-decision@example.test", "R5 Решение", { plan: "free", end: null, createdAt: new Date(now - 30 * DAY), trialEndsAt: new Date(now - DAY) });
    await staff("r5-decision-cook@example.test", "Повар R5", orgId);
    await staff("r5-decision-waiter@example.test", "Официант R5", orgId, "waiter");
    const state = (await loadAccountBilling(orgId))?.state;
    console.log(`состояние: ${state?.kind}, сотрудников ${state?.activeUsers}`);
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  }
);
