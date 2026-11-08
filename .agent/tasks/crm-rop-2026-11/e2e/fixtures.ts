/**
 * Локальные данные для проверки CRM: обращения во всех источниках, РОП и
 * менеджер продаж. Только для локальной БД (DATABASE_URL на 127.0.0.1).
 *
 *   npx tsx .agent/tasks/crm-rop-2026-11/e2e/fixtures.ts
 */
import "dotenv/config";

import bcrypt from "bcryptjs";

import { db } from "../../../../src/lib/db";
import { PLATFORM_SECTION_KEYS } from "../../../../src/lib/platform-access";

if (!/127\.0\.0\.1|localhost/.test(process.env.DATABASE_URL ?? "")) {
  console.error("fixtures: only for a local database");
  process.exit(1);
}

const hours = (h: number) => new Date(Date.now() - h * 3_600_000);

async function main() {
  const passwordHash = await bcrypt.hash("LocalUser-2026!", 10);
  // Как на проде: Алексей — администратор панели (все разделы), РОП выдаст сид.
  await db.user.upsert({
    where: { email: "alexey@wesetup.ru" },
    update: {},
    create: { email: "alexey@wesetup.ru", name: "Алексей", role: "manager", organizationId: "platform", passwordHash, platformSections: [...PLATFORM_SECTION_KEYS] },
  });
  await db.user.upsert({
    where: { email: "sales@wesetup.local.test" },
    update: {},
    create: { email: "sales@wesetup.local.test", name: "Мария (продажи)", role: "manager", organizationId: "platform", passwordHash, platformSections: ["clients", "sales", "partners", "edo"] },
  });

  const cafe = await db.organization.upsert({
    where: { id: "fixture-cafe" },
    update: {},
    create: { id: "fixture-cafe", name: "Кафе «Ромашка»", type: "restaurant", createdAt: hours(30) },
  });
  const owner = await db.user.upsert({
    where: { email: "ivan@romashka-cafe.ru" },
    update: {},
    create: { email: "ivan@romashka-cafe.ru", name: "Иван Петров", role: "owner", organizationId: cafe.id, phone: "+7 912 345-67-89", passwordHash, createdAt: hours(30) },
  });

  await db.serviceRequest.createMany({
    data: [
      { id: "fx-demo-1", serviceKey: "demo-call", serviceTitle: "Показ WeSetup за 15 минут", contactName: "Ольга Смирнова", contactPhone: "8 (903) 111-22-33", contactEmail: "olga@stolovaya-12.ru", comment: "Школьная столовая, 2 пищеблока", source: "site", createdAt: hours(5) },
      { id: "fx-service-1", serviceKey: "journals-setup", serviceTitle: "Настройка журналов под ключ", organizationId: cafe.id, organizationName: cafe.name, userId: owner.id, contactName: "Иван Петров", contactPhone: "+7 912 345-67-89", contactEmail: "ivan@romashka-cafe.ru", comment: "Нужна настройка на 3 точки", createdAt: hours(0.7) },
    ],
    skipDuplicates: true,
  });

  await db.feedbackReport.createMany({
    data: [
      { id: "fx-fb-1", type: "support", message: "Как распечатать журнал гигиены за месяц?", userId: owner.id, userEmail: owner.email, userName: owner.name, organizationId: cafe.id, organizationName: cafe.name, source: "site", responseMessage: "Журналы → Гигиена → Печать, выберите месяц.", respondedAt: hours(20), respondedByName: "Алексей", createdAt: hours(22) },
      { id: "fx-fb-2", type: "suggestion", message: "Хочу подключить WeSetup в сеть пекарен, 7 точек. Сколько стоит?", userName: "Дмитрий", phone: "+79215550011", source: "telegram", telegramChatId: "700100200", createdAt: hours(80) },
    ],
    skipDuplicates: true,
  });

  const thread = await db.supportThread.upsert({
    where: { key: "guest:fixture-1" },
    update: {},
    create: { key: "guest:fixture-1", userEmail: "anna@bistro-anna.ru", userName: "Анна", phone: "+7 999 000-11-22", lastMessageAt: hours(0.2), unreadForStaff: 1 },
  });
  await db.supportMessage.createMany({
    data: [
      { id: "fx-chat-1", threadId: thread.id, author: "client", body: "Здравствуйте! Есть ли у вас журнал бракеража?", authorName: "Анна", createdAt: hours(26) },
      { id: "fx-chat-2", threadId: thread.id, author: "operator", body: "Да, и готовой продукции, и сырой. Показать?", operatorName: "Алексей", createdAt: hours(25.5) },
      { id: "fx-chat-3", threadId: thread.id, author: "client", body: "Да, давайте в четверг", authorName: "Анна", createdAt: hours(0.2) },
    ],
    skipDuplicates: true,
  });

  await db.paymentOrder.upsert({
    where: { id: 900001 },
    update: {},
    create: {
      id: 900001,
      email: "buh@pekarnya-hleb.ru",
      tariffKey: "standard",
      amountRub: 12000,
      description: "Тариф «Стандарт», 12 мес.",
      paymentMethod: "invoice",
      buyerJson: { inn: "7701234567", name: "ООО «Пекарня Хлеб»", kpp: null, address: null, legalProfile: null },
      createdAt: hours(50),
    },
  });

  await db.legalConsent.upsert({
    where: { id: "fx-blank-1" },
    update: {},
    create: { id: "fx-blank-1", email: "chef@kafe-ugolok.ru", version: "2026-10", statementText: "Согласен", source: "blank-download", createdAt: hours(10) },
  });
  await db.auditLog.create({
    data: { organizationId: "platform", action: "blank.download", entity: "legalConsent", entityId: "fx-blank-1", details: { title: "Журнал бракеража готовой продукции", format: "pdf" } },
  });

  console.log("fixtures ready");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
    process.exit(process.exitCode ?? 0);
  });
