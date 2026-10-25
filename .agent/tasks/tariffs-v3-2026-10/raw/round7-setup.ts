// Подготовка аккаунтов для round7-check.sh (доводка после независимой проверки 7).
// Только локальная БД.
//
// DATABASE_URL=... npx tsx --tsconfig tsconfig.json .agent/tasks/tariffs-v3-2026-10/raw/round7-setup.ts
import bcrypt from "bcryptjs";

import { db } from "@/lib/db";

const DAY = 24 * 60 * 60 * 1000;

async function account(email: string, name: string, opts: { plan: string; end: Date; cycle: string | null }) {
  const existing = await db.user.findUnique({ where: { email }, select: { id: true, organizationId: true } });
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
  await account("r7-tz@example.test", "R7 Срок счёта и пояс", { plan: "standard", end: new Date(now + 3 * DAY), cycle: "month" });
  await account("r7-switch@example.test", "R7 Счёт на переход", { plan: "standard", end: new Date(now + 10 * DAY), cycle: "month" });
  await account("r7-short@example.test", "R7 Сутки до конца", { plan: "standard", end: new Date(now + 25 * 60 * 60 * 1000), cycle: "month" });
  // Прежняя «Подписка», оплаченная на два года вперёд: зачёт больше цены года.
  await account("r7-zero@example.test", "R7 Зачёт больше года", { plan: "paid", end: new Date(now + 730 * DAY), cycle: null });
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  }
);
