/*
 * Local-only data for measuring /settings/users (task staff-dialog-lag-2026-11-23):
 * an organization shaped like the owner's screenshot — 117 staff in three categories,
 * weekly days off Sat/Sun, a few manual exceptions in the current month.
 *
 *   npx tsx .agent/tasks/staff-dialog-lag-2026-11-23/raw/seed-staff-perf.ts
 *
 * Prints {email, password} for the measuring script. Refuses non-local databases
 * (scripts/e2e/env.ts guard).
 */
import "../../../../scripts/e2e/env";

import bcrypt from "bcryptjs";

import { db } from "@/lib/db";
import { LEGAL_VERSION } from "@/lib/legal-consent";

const ORG_NAME = "Перф-кафе сотрудники";
const PASSWORD = "perf-pass-2026";
const EMAIL = "perf-staff-owner@example.test";

const POSITIONS: Array<{ category: "management" | "staff" | "commission"; name: string; count: number }> = [
  { category: "management", name: "Администратор", count: 1 },
  { category: "management", name: "Заведующий производством", count: 13 },
  { category: "staff", name: "Буфетчик", count: 9 },
  { category: "staff", name: "Кухонный рабочий", count: 38 },
  { category: "staff", name: "Повар", count: 32 },
  { category: "staff", name: "Кладовщик", count: 8 },
  { category: "commission", name: "Член бракеражной комиссии", count: 16 },
];

const SURNAMES = ["Акулинина", "Бубнова", "Геворгян", "Кузьмина", "Мамбетова", "Мурадян", "Панфилова", "Пилявская", "Амирян", "Бабаева", "Барсегян", "Белан", "Белоногова", "Бородкина", "Ваганичева", "Варданян", "Демчук", "Джула", "Комова", "Коровякова"];
const NAMES = ["Елена Викторовна", "Татьяна Александровна", "Марине Норайровна", "Надежда Алексеевна", "Тамара Галустовна", "Анна Павловна", "Галина Юрьевна", "Наталья Алексеевна", "Арина Павловна", "Ирина Николаевна"];

async function main() {
  const old = await db.organization.findMany({ where: { name: ORG_NAME }, select: { id: true } });
  for (const org of old) {
    await db.user.deleteMany({ where: { organizationId: org.id } });
    await db.organization.delete({ where: { id: org.id } });
  }
  await db.user.deleteMany({ where: { email: EMAIL } });

  const org = await db.organization.create({
    data: { name: ORG_NAME, type: "restaurant", subscriptionPlan: "free" },
  });
  const owner = await db.user.create({
    data: {
      email: EMAIL,
      name: "Алексей",
      phone: "+79153254650",
      passwordHash: await bcrypt.hash(PASSWORD, 10),
      role: "owner",
      organizationId: org.id,
      journalAccessMigrated: true,
      emailVerifiedAt: new Date(),
      legalVersion: LEGAL_VERSION,
      weeklyDaysOff: [5, 6],
    },
  });

  // Staff sign in through Telegram/QR; they still need some hash in the column.
  const staffHash = await bcrypt.hash(`${PASSWORD}-staff`, 4);
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  let sort = 0;
  let n = 0;
  const offRows: Array<{ userId: string; date: Date; kind: string }> = [];
  for (const spec of POSITIONS) {
    const position = await db.jobPosition.create({
      data: { organizationId: org.id, categoryKey: spec.category, name: spec.name, sortOrder: sort++ },
    });
    // The owner is the administrator (the «Администратор 1» row on the screenshot).
    if (spec.name === "Администратор") {
      await db.user.update({ where: { id: owner.id }, data: { jobPositionId: position.id, positionTitle: position.name } });
      continue;
    }
    for (let i = 0; i < spec.count; i++, n++) {
      const user = await db.user.create({
        data: {
          email: `perf-staff-${n}@example.test`,
          name: `${SURNAMES[n % SURNAMES.length]} ${NAMES[(n * 7) % NAMES.length]} ${n}`,
          phone: n % 3 === 0 ? `+7915${String(1000000 + n).slice(-7)}` : null,
          passwordHash: staffHash,
          role: spec.category === "management" ? "head_chef" : "cook",
          organizationId: org.id,
          jobPositionId: position.id,
          positionTitle: position.name,
          journalAccessMigrated: true,
          weeklyDaysOff: n % 5 === 0 ? [0, 1] : [5, 6],
        },
      });
      // A few manual exceptions this month: one extra day off, one worked Saturday.
      offRows.push({ userId: user.id, date: new Date(Date.UTC(year, month, 3 + (n % 20))), kind: "off" });
      offRows.push({ userId: user.id, date: new Date(Date.UTC(year, month, 1 + ((n * 3) % 27))), kind: "work" });
    }
  }
  await db.staffWorkOffDay.createMany({ data: offRows, skipDuplicates: true });
  const total = await db.user.count({ where: { organizationId: org.id } });
  console.log(JSON.stringify({ email: EMAIL, password: PASSWORD, organizationId: org.id, users: total }));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
