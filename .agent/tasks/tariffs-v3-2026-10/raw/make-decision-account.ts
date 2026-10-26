// Аккаунт «пробный кончился, нужно решение» (ROOT поставил конец пробного
// вчера): три сотрудника и все журналы включены — у руководителя должно
// открыться окно «Выбрать тариф / Остаться на бесплатном». Только локальная БД.
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
const DAY = 24 * 60 * 60 * 1000;

async function main() {
  const email = "decision@example.test";
  if (await prisma.user.findUnique({ where: { email } })) return;
  const createdAt = new Date(Date.now() - 30 * DAY);
  const passwordHash = await bcrypt.hash("TestPass123!", 10);
  const org = await prisma.organization.create({
    data: { name: "Кафе Решение", type: "restaurant", subscriptionPlan: "free", createdAt, disabledJournalCodes: [] },
  });
  const owner = await prisma.user.create({
    data: { email, name: "Руководитель Кафе Решение", passwordHash, role: "manager", organizationId: org.id, isActive: true, journalAccessMigrated: true, createdAt },
  });
  for (const [i, name] of ["Повар Иванов", "Официант Петрова"].entries()) {
    await prisma.user.create({
      data: { email: `decision-staff${i + 1}@example.test`, name, passwordHash, role: i === 0 ? "cook" : "waiter", organizationId: org.id, isActive: true, journalAccessMigrated: true, createdAt },
    });
  }
  const account = await prisma.account.create({
    data: { ownerUserId: owner.id, subscriptionPlan: "free", createdAt, trialEndsAt: new Date(Date.now() - DAY) },
  });
  await prisma.organization.update({ where: { id: org.id }, data: { accountId: account.id } });
  await prisma.user.update({ where: { id: owner.id }, data: { legalVersion: "2026-09-30" } });
  console.log("created", email, org.id);
}
main().then(() => prisma.$disconnect()).catch(async (error) => { console.error(error); await prisma.$disconnect(); process.exit(1); });
