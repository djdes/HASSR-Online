// Тестовые аккаунты для локальной проверки витрины тарифов (только локальная БД).
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
const DAY = 24 * 60 * 60 * 1000;

async function make(opts: { key: string; name: string; plan: string; end: Date | null; cycle: string | null; points: number; createdDaysAgo: number }) {
  const email = `${opts.key}@example.test`;
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return;
  const createdAt = new Date(Date.now() - opts.createdDaysAgo * DAY);
  const org = await prisma.organization.create({
    data: { name: opts.name, type: "restaurant", subscriptionPlan: opts.plan, subscriptionEnd: opts.end, createdAt, inn: "7701234567", address: "Москва, ул. Тестовая, 1", phone: "+79990000000" },
  });
  const user = await prisma.user.create({
    data: { email, name: `Руководитель ${opts.name}`, passwordHash: await bcrypt.hash("TestPass123!", 10), role: "manager", organizationId: org.id, isActive: true, journalAccessMigrated: true, createdAt },
  });
  const account = await prisma.account.create({
    data: { ownerUserId: user.id, subscriptionPlan: opts.plan, subscriptionEnd: opts.end, planCycle: opts.cycle, planPoints: opts.points, createdAt },
  });
  await prisma.organization.update({ where: { id: org.id }, data: { accountId: account.id } });
  console.log("created", email, org.id);
}

async function main() {
  // Пробный период: аккаунт создан вчера.
  await make({ key: "trial", name: "Кафе Пробное", plan: "free", end: null, cycle: null, points: 1, createdDaysAgo: 1 });
  // «Стандарт» помесячно, оплачен ещё на 15 дней.
  await make({ key: "standard", name: "Кафе Стандарт", plan: "standard", end: new Date(Date.now() + 15 * DAY), cycle: "month", points: 1, createdDaysAgo: 40 });
  // Бесплатный после пробного (создан 30 дней назад, после запуска тарифов — пробный уже прошёл, если ROOT поставил запуск раньше).
  await make({ key: "premium", name: "Кафе Премиум", plan: "premium", end: new Date(Date.now() + 200 * DAY), cycle: "year", points: 3, createdDaysAgo: 100 });
}

main().then(() => prisma.$disconnect()).catch(async (error) => { console.error(error); await prisma.$disconnect(); process.exit(1); });
