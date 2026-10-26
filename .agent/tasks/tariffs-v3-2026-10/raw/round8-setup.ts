// Подготовка аккаунтов для round8-check.sh (доводка после финальной проверки).
// Только локальная БД.
//
// DATABASE_URL=... npx tsx --tsconfig tsconfig.json .agent/tasks/tariffs-v3-2026-10/raw/round8-setup.ts
import bcrypt from "bcryptjs";

import { db } from "@/lib/db";

const DAY = 24 * 60 * 60 * 1000;

async function account(email: string, name: string, opts: { plan: string; end: Date; cycle: string | null }) {
  const existing = await db.user.findUnique({ where: { email }, select: { organizationId: true } });
  let orgId = existing?.organizationId;
  if (!orgId) {
    const org = await db.organization.create({ data: { name, type: "restaurant", subscriptionPlan: "free" } });
    const user = await db.user.create({
      data: { email, name, passwordHash: await bcrypt.hash("TestPass123!", 10), role: "manager", organizationId: org.id, isActive: true, journalAccessMigrated: true, legalVersion: "2026-09-30" },
    });
    const acc = await db.account.create({ data: { ownerUserId: user.id, subscriptionPlan: "free" } });
    await db.organization.update({ where: { id: org.id }, data: { accountId: acc.id } });
    orgId = org.id;
  }
  await db.paymentOrder.updateMany({ where: { organizationId: orgId, status: "pending" }, data: { status: "cancelled" } });
  const org = await db.organization.update({
    where: { id: orgId },
    data: { subscriptionPlan: opts.plan, subscriptionEnd: opts.end, inn: "7707083893" },
    select: { accountId: true },
  });
  await db.account.update({
    where: { id: org.accountId! },
    data: { subscriptionPlan: opts.plan, subscriptionEnd: opts.end, planCycle: opts.cycle, planPoints: 1, createdAt: new Date(Date.now() - 60 * DAY), trialEndsAt: new Date(Date.now() - 40 * DAY) },
  });
  console.log(`${email}: ${opts.plan} · ${opts.cycle ?? "—"} · до ${opts.end.toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })} МСК`);
}

async function main() {
  const now = Date.now();
  // Последние сутки срока: «новая» подписка добавляется к концу текущего.
  await account("r8-lastday@example.test", "R8 Последние сутки", { plan: "standard", end: new Date(now + 10 * 60 * 60 * 1000), cycle: "month" });
  // Карточка счёта на узбекском: срок и сумма одинаково на сервере и в браузере.
  await account("r8-uz@example.test", "R8 Счёт на узбекском", { plan: "standard", end: new Date(now + 3 * DAY), cycle: "month" });
  await db.user.update({ where: { email: "r8-uz@example.test" }, data: { locale: "uz" } });
  // Прежняя «Подписка» на два года вперёд: переход на год стоит 0 ₽.
  await account("r8-zero@example.test", "R8 Заказ за 0 ₽", { plan: "paid", end: new Date(now + 730 * DAY), cycle: null });
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  }
);
