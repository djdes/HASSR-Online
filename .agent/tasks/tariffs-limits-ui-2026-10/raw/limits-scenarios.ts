// Живая проверка лимитов мест и «Меркурия» (tariffs-limits-ui). Только локальная БД.
// Готовит аккаунты lim-*; HTTP-проверки — limits-check.sh.
//
// DATABASE_URL=... npx tsx --tsconfig tsconfig.json .agent/tasks/tariffs-limits-ui-2026-10/raw/limits-scenarios.ts
import bcrypt from "bcryptjs";

import { db } from "@/lib/db";

const DAY = 24 * 60 * 60 * 1000;

async function account(email: string, name: string, opts: { plan: string; end: Date | null; points?: number; trialOver?: boolean }) {
  const existing = await db.user.findUnique({ where: { email }, select: { id: true, organizationId: true } });
  let orgId: string;
  if (existing) {
    orgId = existing.organizationId;
  } else {
    const org = await db.organization.create({ data: { name, type: "restaurant", subscriptionPlan: "free" } });
    const user = await db.user.create({
      data: { email, name, passwordHash: await bcrypt.hash("TestPass123!", 10), role: "manager", organizationId: org.id, isActive: true, journalAccessMigrated: true, legalVersion: "2026-09-30" },
    });
    const acc = await db.account.create({ data: { ownerUserId: user.id, subscriptionPlan: "free" } });
    await db.organization.update({ where: { id: org.id }, data: { accountId: acc.id } });
    orgId = org.id;
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
      planCycle: opts.end ? "month" : null,
      planPoints: opts.points ?? 1,
      createdAt: new Date(Date.now() - 60 * DAY),
      trialEndsAt: new Date(Date.now() - 40 * DAY),
    },
  });
  return orgId;
}

/** Ровно `total` активных сотрудников в организации (руководитель + повара). */
async function staff(orgId: string, prefix: string, total: number) {
  const active = await db.user.count({ where: { organizationId: orgId, isActive: true, archivedAt: null, isRoot: false } });
  if (active < total) {
    // Сотрудники без входа: пароль не задан (пустой хеш, как у заведённых без доступа).
    await db.user.createMany({
      data: Array.from({ length: total - active }, (_, i) => ({
        email: `${prefix}-cook-${active + i}-${Date.now()}@example.test`,
        passwordHash: "",
        name: `Повар ${active + i}`,
        role: "cook",
        organizationId: orgId,
        isActive: true,
        journalAccessMigrated: true,
      })),
    });
  } else if (active > total) {
    const extra = await db.user.findMany({
      where: { organizationId: orgId, isActive: true, archivedAt: null, role: "cook" },
      select: { id: true },
      take: active - total,
    });
    await db.user.updateMany({ where: { id: { in: extra.map((u) => u.id) } }, data: { archivedAt: new Date() } });
  }
  return db.user.count({ where: { organizationId: orgId, isActive: true, archivedAt: null, isRoot: false } });
}

async function main() {
  console.info = () => {};
  const end = new Date(Date.now() + 20 * DAY);
  const rows: Array<[string, string, number]> = [];
  const add = async (email: string, name: string, opts: Parameters<typeof account>[2], total: number) => {
    const orgId = await account(email, name, opts);
    rows.push([email, `${opts.plan} · точек ${opts.points ?? 1}`, await staff(orgId, email.split("@")[0], total)]);
  };
  await add("lim-free@example.test", "Лимиты: бесплатный", { plan: "free", end: null }, 1);
  await add("lim-std-full@example.test", "Лимиты: Стандарт, мест нет", { plan: "standard", end }, 25);
  await add("lim-std-over@example.test", "Лимиты: Стандарт, 40 сотрудников", { plan: "standard", end }, 40);
  await add("lim-prem-full@example.test", "Лимиты: Премиум, мест нет", { plan: "premium", end }, 100);
  await add("lim-prem-over@example.test", "Лимиты: Премиум, 140 сотрудников", { plan: "premium", end }, 140);
  for (const [email, plan, active] of rows) console.log(`${email}: ${plan}, активных ${active}`);
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  }
);
