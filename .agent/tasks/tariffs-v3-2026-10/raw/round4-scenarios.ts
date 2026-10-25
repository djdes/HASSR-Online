// Живая проверка (независимая проверка 4). Только локальная БД. Оплата идёт
// тем же путём, что у кассы (settlePaidOrder + completePaidOrder); переходы на
// бесплатный — той же функцией, что у задачи и кабинета (transitionToFree).
//
// DATABASE_URL=... npx tsx --tsconfig tsconfig.json .agent/tasks/tariffs-v3-2026-10/raw/round4-scenarios.ts
import bcrypt from "bcryptjs";

import { settlePaidOrder } from "@/lib/balance/topup";
import {
  hasPendingInvoice,
  listTransitionJournals,
  loadAccountBilling,
  loadBillingUnit,
  runBillingTransitionJob,
  transitionToFree,
} from "@/lib/billing.server";
import { db } from "@/lib/db";
import { hashInviteToken } from "@/lib/invite-tokens";
import { createInvoiceOrder } from "@/lib/invoices/service";
import { completePaidOrder } from "@/lib/payment-fulfillment";
import { quoteCheckout } from "@/lib/plan-checkout.server";
import { basePlanSnapshot } from "@/lib/plan-payment";
import type { PlanTarget } from "@/lib/tariff-plans";

const DAY = 24 * 60 * 60 * 1000;
const day = (d: Date | null | undefined) => d?.toISOString().slice(0, 16).replace("T", " ") ?? "—";

type Made = { orgId: string; userId: string; accountId: string };

/** Аккаунт с одним руководителем; plan/end/points — как у подписки. */
async function account(
  email: string,
  name: string,
  opts: { plan: string; end: Date | null; points?: number; createdAt?: Date; trialEndsAt?: Date | null }
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
      planPoints: opts.points ?? 1,
      createdAt: opts.createdAt ?? new Date(Date.now() - 60 * DAY),
      trialEndsAt: opts.trialEndsAt === undefined ? new Date(Date.now() - 40 * DAY) : opts.trialEndsAt,
    },
  });
  return { orgId, userId, accountId: org.accountId! };
}

async function quotedOrder(orgId: string, email: string, target: PlanTarget) {
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
    },
  });
}

async function payCard(orderId: number) {
  await settlePaidOrder({ orderId, rawResult: { simulated: "round4-scenarios" } });
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

/** Письма в dev пишутся в консоль: ловим текст писем, пока идёт `fn`. */
async function captureEmails(fn: () => Promise<void>): Promise<string[]> {
  const bodies: string[] = [];
  const original = console.info;
  console.info = (...args: unknown[]) => {
    const line = args.map(String).join(" ");
    if (line.startsWith("[email/dev] Subject:") || line.startsWith("[email/dev] Body:")) bodies.push(line);
  };
  try {
    await fn();
  } finally {
    console.info = original;
  }
  return bodies;
}

async function main() {
  const now = Date.now();
  // Служебные логи биллинга (многострочные объекты) — не в отчёт; письма
  // ловит captureEmails.
  console.info = () => {};

  console.log("=== S1. Срок кончился, задача перевела аккаунт на бесплатный; затем оплачено продление, оформленное до конца срока");
  {
    const end = new Date(now - 10 * DAY);
    const { orgId } = await account("r4-free-renew@example.test", "R4 Продление после бесплатного", { plan: "standard", end });
    const order = await db.paymentOrder.create({
      data: {
        email: "r4-free-renew@example.test", tariffKey: "standard_month", amountRub: 3000, baseRub: 3000, description: "Тариф «Стандарт» на месяц (продление)",
        status: "pending", isTest: false, organizationId: orgId, points: 1, changeKind: "renew", periodEndsAt: new Date(end.getTime() + 30 * DAY), createdAt: new Date(end.getTime() - 3 * DAY),
        basePlanJson: basePlanSnapshot({ tier: "standard", cycle: "month", points: 1, paidUntil: end }),
      },
    });
    const before = await loadAccountBilling(orgId);
    console.log(`состояние до перехода: ${before?.state.kind}, причина ${before?.state.reason}`);
    let outcome = "";
    const mails = await captureEmails(async () => {
      const r = await transitionToFree({ organizationId: orgId, mode: "auto", actor: { userId: null, userName: "WeSetup" } });
      outcome = r.ok ? (r.noop ? "noop" : `ok, в архиве ${r.archivedCount}, выключено журналов ${r.disabledJournalsCount}`) : `отказ: ${r.error}`;
    });
    console.log(`автопереход: ${outcome}; подписка: ${await subscription(orgId)}`);
    const body = mails.find((m) => m.startsWith("[email/dev] Body:")) ?? "";
    console.log(`письмо владельцу: ${mails.find((m) => m.startsWith("[email/dev] Subject:"))?.replace("[email/dev] ", "") ?? "нет"}`);
    console.log(
      `  текст: ${body.includes("Оплаченная подписка закончилась") ? "«Оплаченная подписка закончилась…»" : body.includes("Пробный период закончился") ? "«Пробный период закончился…» — ОШИБКА" : "не найден"}`
    );
    await payCard(order.id);
    console.log(`после оплаты продления: ${await subscription(orgId)} (ожидание: Стандарт, +30 дней от сегодня)`);
    console.log(await orderState(order.id));
  }

  console.log("\n=== S2. Счёт на доплату действует не дольше оплаченного срока");
  {
    const end = new Date(now + 3 * DAY);
    const { orgId, userId } = await account("r4-due@example.test", "R4 Срок счёта", { plan: "standard", end });
    const upgrade = await createInvoiceOrder({ organizationId: orgId, userId, email: "r4-due@example.test", target: { tier: "premium", cycle: "month", points: 1 } });
    if (!upgrade.ok) throw new Error(upgrade.error);
    console.log(`подписка до ${day(end)}; счёт №${upgrade.order.id} (${upgrade.order.changeKind}) действует до ${day(upgrade.order.invoiceDueAt)} — ${upgrade.order.invoiceDueAt?.getTime() === end.getTime() ? "до конца срока" : "ОШИБКА"}`);
    const renew = await createInvoiceOrder({ organizationId: orgId, userId, email: "r4-due@example.test", target: { tier: "standard", cycle: "month", points: 1 } });
    if (!renew.ok) throw new Error(renew.error);
    const days = Math.round(((renew.order.invoiceDueAt?.getTime() ?? 0) - now) / DAY);
    console.log(`счёт №${renew.order.id} (${renew.order.changeKind}) действует до ${day(renew.order.invoiceDueAt)} — ${days} дн. (продление не ограничено сроком)`);
  }

  console.log("\n=== S3. Оплата на разборе держит автопереход на бесплатный");
  {
    const { orgId } = await account("r4-held@example.test", "R4 Оплата на разборе", { plan: "standard", end: new Date(now - 20 * DAY) });
    const held = await db.paymentOrder.create({
      data: {
        email: "r4-held@example.test", tariffKey: "premium_month", amountRub: 1000, baseRub: 5000, description: "Тариф «Премиум» на месяц (доплата)",
        status: "paid", paidAt: new Date(now - DAY), heldAt: new Date(now - DAY), isTest: false, organizationId: orgId, points: 1, changeKind: "upgrade",
        createdAt: new Date(now - 22 * DAY), completeTokenHash: hashInviteToken(`r4-held-token-${now}`), completeTokenExpiresAt: new Date(now - DAY),
        basePlanJson: basePlanSnapshot({ tier: "standard", cycle: "month", points: 1, paidUntil: new Date(now - 20 * DAY) }),
      },
    });
    // Ссылка возврата для проверки страницы /order (токен истёк — форма достройки не нужна).
    console.log(`токен возврата: r4-held-token-${now} (заказ №${held.id})`);
    const unit = await loadBillingUnit(orgId);
    const loaded = await loadAccountBilling(orgId);
    console.log(`состояние: ${loaded?.state.kind}, грейс истёк: ${loaded?.state.graceExpired}`);
    console.log(`оплата на разборе считается решением «платим»: ${await hasPendingInvoice(unit!.scopeOrgIds)}`);
    const job = await runBillingTransitionJob({ dryRun: true });
    console.log(`задача (dry run): ${job.results.find((r) => r.organizationId === orgId)?.outcome ?? "нет строки"}`);
    await db.paymentOrder.update({ where: { id: held.id }, data: { heldAt: null } });
    const job2 = await runBillingTransitionJob({ dryRun: true });
    console.log(`без отметки разбора (dry run): ${job2.results.find((r) => r.organizationId === orgId)?.action ?? "нет строки"} → ${job2.results.find((r) => r.organizationId === orgId)?.outcome ?? "—"}`);
    await db.paymentOrder.update({ where: { id: held.id }, data: { heldAt: new Date(now - DAY) } });
    // Просроченный счёт для подписи «счёт истёк» в истории оплат кабинета.
    await db.paymentOrder.create({
      data: {
        email: "r4-held@example.test", tariffKey: "standard_month", amountRub: 3000, baseRub: 3000, description: "Тариф «Стандарт» на месяц (счёт)",
        status: "pending", isTest: false, organizationId: orgId, points: 1, changeKind: "new", paymentMethod: "invoice", invoiceDueAt: new Date(now - 2 * DAY),
        createdAt: new Date(now - 9 * DAY), basePlanJson: basePlanSnapshot(null),
      },
    });
  }

  console.log("\n=== S4. Сеть из двух точек: копия срока у второй точки позже — продление от самого позднего конца, срок во всех точках");
  {
    const { orgId, accountId } = await account("r4-multi@example.test", "R4 Сеть A", { plan: "standard", end: new Date(now + 5 * DAY), points: 2 });
    let second = await db.organization.findFirst({ where: { accountId, id: { not: orgId } }, select: { id: true } });
    if (!second) second = await db.organization.create({ data: { name: "R4 Сеть B", type: "restaurant", subscriptionPlan: "standard", accountId }, select: { id: true } });
    const laterEnd = new Date(now + 20 * DAY);
    await db.organization.update({ where: { id: second.id }, data: { subscriptionPlan: "standard", subscriptionEnd: laterEnd } });
    console.log(`аккаунт до ${day(new Date(now + 5 * DAY))}, точка B до ${day(laterEnd)}; подписка в кабинете: до ${day((await loadAccountBilling(orgId))?.state.paidUntil)}`);
    const order = await quotedOrder(orgId, "r4-multi@example.test", { tier: "standard", cycle: "month", points: 2 });
    console.log(`заказ №${order.id}: ${order.changeKind}, ${order.amountRub} ₽`);
    await payCard(order.id);
    const ends = await db.organization.findMany({ where: { accountId }, select: { name: true, subscriptionPlan: true, subscriptionEnd: true }, orderBy: { name: "asc" } });
    console.log(`после оплаты: аккаунт ${await subscription(orgId)}`);
    for (const o of ends) console.log(`  ${o.name}: ${o.subscriptionPlan} до ${day(o.subscriptionEnd)}`);
    console.log(`ожидание: до ${day(new Date(laterEnd.getTime() + 30 * DAY))} везде`);
    console.log(await orderState(order.id));
  }

  console.log("\n=== S5. «Перейти на бесплатный» во время пробного заканчивает пробный период");
  {
    const { orgId, userId, accountId } = await account("r4-trial-free@example.test", "R4 Выход из пробного", {
      plan: "free",
      end: null,
      createdAt: new Date(now - 2 * DAY),
      trialEndsAt: null,
    });
    const cookEmail = "r4-trial-free-cook@example.test";
    const cook = await db.user.findUnique({ where: { email: cookEmail }, select: { id: true } });
    if (cook) await db.user.update({ where: { id: cook.id }, data: { isActive: true, archivedAt: null, organizationId: orgId } });
    else {
      await db.user.create({
        data: { email: cookEmail, name: "Повар R4", passwordHash: await bcrypt.hash("TestPass123!", 10), role: "cook", organizationId: orgId, isActive: true, journalAccessMigrated: true },
      });
    }
    const before = await loadAccountBilling(orgId);
    console.log(`до: ${before?.state.kind}, пробный по ${day(before?.state.trialEndsAt)}, сотрудников ${before?.state.activeUsers}, журналов ${before?.state.enabledJournals}`);
    const unit = await loadBillingUnit(orgId);
    const journals = await listTransitionJournals(unit!);
    const r = await transitionToFree({
      organizationId: orgId,
      mode: "voluntary",
      keepUserId: userId,
      keepJournalCode: journals[0]?.code ?? null,
      actor: { userId, userName: "R4 Выход из пробного" },
    });
    console.log(`переход: ${r.ok ? (r.noop ? "noop" : `ok, в архиве ${r.archivedCount}`) : r.error}`);
    const acc = await db.account.findUnique({ where: { id: accountId }, select: { trialEndsAt: true } });
    const after = await loadAccountBilling(orgId);
    console.log(`после: ${after?.state.kind}, пробный закончился ${day(acc?.trialEndsAt)}, лимит сотрудников ${after?.state.seatLimit}`);
  }

  console.log("\n=== S6. Подготовка для проверки маршрута: ещё один аккаунт в пробном (руководитель и повар)");
  {
    const { orgId } = await account("r4-trial-api@example.test", "R4 Пробный через API", {
      plan: "free",
      end: null,
      createdAt: new Date(now - 1 * DAY),
      trialEndsAt: null,
    });
    const cookEmail = "r4-trial-api-cook@example.test";
    const cook = await db.user.findUnique({ where: { email: cookEmail }, select: { id: true } });
    if (cook) await db.user.update({ where: { id: cook.id }, data: { isActive: true, archivedAt: null, organizationId: orgId } });
    else {
      await db.user.create({
        data: { email: cookEmail, name: "Повар R4 API", passwordHash: await bcrypt.hash("TestPass123!", 10), role: "cook", organizationId: orgId, isActive: true, journalAccessMigrated: true },
      });
    }
    const state = (await loadAccountBilling(orgId))?.state;
    console.log(`состояние: ${state?.kind}, сотрудников ${state?.activeUsers}`);
  }

  console.log("\n=== S7. Подготовка для проверки маршрута оплаты: «Стандарт» помесячно, до конца срока 10 часов, повар платит сам");
  {
    const end = new Date(now + 10 * 60 * 60 * 1000);
    const { orgId } = await account("r4-last-day@example.test", "R4 Последние сутки", { plan: "standard", end });
    const cookEmail = "r4-last-day-cook@example.test";
    const cook = await db.user.findUnique({ where: { email: cookEmail }, select: { id: true } });
    if (cook) await db.user.update({ where: { id: cook.id }, data: { isActive: true, archivedAt: null, organizationId: orgId } });
    else {
      await db.user.create({
        data: { email: cookEmail, name: "Повар R4 сутки", passwordHash: await bcrypt.hash("TestPass123!", 10), role: "cook", organizationId: orgId, isActive: true, journalAccessMigrated: true, legalVersion: "2026-09-30" },
      });
    }
    await db.paymentOrder.updateMany({ where: { email: cookEmail, status: "pending" }, data: { status: "cancelled" } });
    console.log(`подписка: ${await subscription(orgId)}`);
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  }
);
