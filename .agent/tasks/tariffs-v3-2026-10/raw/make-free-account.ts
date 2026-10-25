// Аккаунт «после пробного» (ROOT поставил конец пробного вчера) — только локальная БД.
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
const DAY = 24 * 60 * 60 * 1000;

async function main() {
  const email = "free@example.test";
  if (await prisma.user.findUnique({ where: { email } })) return;
  const createdAt = new Date(Date.now() - 30 * DAY);
  // Один журнал включён: остальные выключены — бесплатный без решения.
  const templates = await prisma.journalTemplate.findMany({ where: { isActive: true }, select: { code: true } });
  const disabled = templates.map((t) => t.code).filter((code) => code !== "hygiene");
  const org = await prisma.organization.create({
    data: { name: "Кафе Бесплатное", type: "restaurant", subscriptionPlan: "free", createdAt, disabledJournalCodes: disabled },
  });
  const user = await prisma.user.create({
    data: { email, name: "Руководитель Кафе Бесплатное", passwordHash: await bcrypt.hash("TestPass123!", 10), role: "manager", organizationId: org.id, isActive: true, journalAccessMigrated: true, createdAt },
  });
  const account = await prisma.account.create({
    data: { ownerUserId: user.id, subscriptionPlan: "free", createdAt, trialEndsAt: new Date(Date.now() - DAY) },
  });
  await prisma.organization.update({ where: { id: org.id }, data: { accountId: account.id } });
  console.log("created", email, org.id, "disabled", disabled.length);
}
main().then(() => prisma.$disconnect()).catch(async (error) => { console.error(error); await prisma.$disconnect(); process.exit(1); });
