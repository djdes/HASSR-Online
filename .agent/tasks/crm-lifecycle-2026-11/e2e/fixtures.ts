/**
 * Клиенты для живой проверки автоворонки — только локальная БД. Сроки — от
 * «сегодня» по Москве (D0), чтобы ступени срабатывали в прогоне с now = D0 10:30.
 *
 *   npx tsx .agent/tasks/crm-lifecycle-2026-11/e2e/fixtures.ts
 */
import "dotenv/config";

import bcrypt from "bcryptjs";

import { db } from "../../../../src/lib/db";
import { addDays, atMsk, mskDay } from "../../../../src/lib/crm/lifecycle/calendar";

if (!/127\.0\.0\.1|localhost/.test(process.env.DATABASE_URL ?? "")) {
  console.error("fixtures: only for a local database");
  process.exit(1);
}

const D0 = mskDay(new Date());
const H = 3_600_000;

type Persona = {
  key: string;
  name: string;
  users: number;
  buildings: number;
  inn: string | null;
  entriesWeek: number;
  phone: string | null;
  account: { trialEndsAt?: Date; plan?: string; subscriptionEnd?: Date; planCycle?: string; planPoints?: number; createdAt: Date };
  managerEmail?: string;
};

const PERSONAS: Persona[] = [
  { key: "romashka", name: "Кафе «Ромашка» e2e", users: 24, buildings: 2, inn: "7701234567", entriesWeek: 300, phone: "+7 900 100-00-01", account: { trialEndsAt: atMsk(addDays(D0, 5), 0), createdAt: atMsk(addDays(D0, -9), 12) } },
  { key: "stolovaya", name: "Столовая комбината e2e", users: 120, buildings: 3, inn: "7702345678", entriesWeek: 1800, phone: "+7 900 100-00-02", account: { trialEndsAt: atMsk(addDays(D0, 5), 0), createdAt: atMsk(addDays(D0, -9), 12) }, managerEmail: "sales@wesetup.local.test" },
  { key: "pekarnya", name: "Пекарня «Хлеб» e2e", users: 3, buildings: 1, inn: null, entriesWeek: 0, phone: null, account: { trialEndsAt: atMsk(addDays(D0, 5), 0), createdAt: atMsk(addDays(D0, -9), 12) } },
  { key: "grace", name: "Бистро «Грейс» e2e", users: 8, buildings: 1, inn: "7703456789", entriesWeek: 120, phone: "+7 900 100-00-04", account: { trialEndsAt: atMsk(addDays(D0, -4), 0), createdAt: atMsk(addDays(D0, -18), 12) } },
  { key: "year", name: "Сеть «Вкусно рядом» e2e", users: 60, buildings: 3, inn: "7704567890", entriesWeek: 900, phone: "+7 900 100-00-05", account: { plan: "standard", planCycle: "year", planPoints: 3, subscriptionEnd: atMsk(addDays(D0, 31), 0), createdAt: atMsk(addDays(D0, -340), 12) } },
  { key: "month", name: "«Шаурма Экспресс» e2e", users: 6, buildings: 1, inn: "7705678901", entriesWeek: 80, phone: "+7 900 100-00-06", account: { plan: "standard", planCycle: "month", planPoints: 1, subscriptionEnd: atMsk(addDays(D0, 3), 0), createdAt: atMsk(addDays(D0, -100), 12) } },
  { key: "expired", name: "Кофейня «Не продлили» e2e", users: 5, buildings: 1, inn: "7706789012", entriesWeek: 40, phone: "+7 900 100-00-07", account: { plan: "standard", planCycle: "month", planPoints: 1, subscriptionEnd: atMsk(addDays(D0, -1), 0), trialEndsAt: atMsk(addDays(D0, -56), 0), createdAt: atMsk(addDays(D0, -70), 12) } },
  { key: "invoice", name: "Цех полуфабрикатов e2e", users: 12, buildings: 1, inn: "7707890123", entriesWeek: 150, phone: "+7 900 100-00-08", account: { trialEndsAt: atMsk(addDays(D0, 10), 0), createdAt: atMsk(addDays(D0, -4), 12) } },
  { key: "paid", name: "Ресторан «Оплатили» e2e", users: 10, buildings: 1, inn: "7708901234", entriesWeek: 200, phone: "+7 900 100-00-09", account: { trialEndsAt: atMsk(addDays(D0, 5), 0), createdAt: atMsk(addDays(D0, -9), 12) } },
  { key: "solo", name: "ИП Петров e2e", users: 1, buildings: 1, inn: null, entriesWeek: 30, phone: "+7 900 100-00-10", account: { trialEndsAt: atMsk(addDays(D0, 5), 0), createdAt: atMsk(addDays(D0, -9), 12) } },
];

async function main() {
  const passwordHash = await bcrypt.hash("LocalUser-2026!", 10);
  const template = await db.journalTemplate.findFirstOrThrow({ where: { isActive: true }, select: { id: true } });
  const managers = new Map((await db.user.findMany({ where: { organizationId: "platform" }, select: { id: true, email: true } })).map((user) => [user.email, user.id]));

  // Реквизиты исполнителя — без них счёт по ИНН не выставляется.
  const requisites = {
    nameFull: "Общество с ограниченной ответственностью «БФС»",
    nameShort: "ООО «БФС»",
    inn: "5018215599",
    kpp: "501801001",
    ogrn: "1225000000000",
    address: "141070, Московская обл., г. Королёв, ул. Тестовая, д. 1",
    bank: { name: "ПАО Сбербанк", bik: "044525225", account: "40702810000000000001", corrAccount: "30101810400000000225" },
    head: { post: "Генеральный директор", name: "Иванов Иван Иванович" },
    vatMode: "none",
    email: "info@wesetup.ru",
    phone: "+7 495 000-00-00",
    facsimileFile: null,
    stampFile: null,
    updatedAt: new Date().toISOString(),
  };
  await db.platformSetting.upsert({ where: { key: "legal.requisites" }, create: { key: "legal.requisites", value: JSON.stringify(requisites) }, update: { value: JSON.stringify(requisites) } });

  // Чистый лист: сделки, задачи, счета и контакты прошлых прогонов.
  await db.crmTask.deleteMany({ where: { organizationId: { startsWith: "lc-" } } });
  await db.crmDeal.deleteMany({ where: { organizationId: { startsWith: "lc-" } } });
  await db.paymentOrder.deleteMany({ where: { organizationId: { startsWith: "lc-" } } });
  await db.crmContact.deleteMany({ where: { OR: [{ email: { endsWith: ".ru", contains: "@lc-" } }, { organizationId: { startsWith: "lc-" } }] } });
  await db.promoCode.deleteMany({ where: { organizationId: { startsWith: "lc-" } } });

  for (const persona of PERSONAS) {
    const orgId = `lc-${persona.key}`;
    const ownerEmail = `owner@lc-${persona.key}.ru`;
    await db.organization.deleteMany({ where: { id: orgId } });
    await db.user.deleteMany({ where: { email: ownerEmail } });
    const org = await db.organization.create({
      data: {
        id: orgId,
        name: persona.name,
        type: "restaurant",
        inn: persona.inn,
        createdAt: persona.account.createdAt,
        accountManagerId: persona.managerEmail ? (managers.get(persona.managerEmail) ?? null) : null,
        subscriptionPlan: persona.account.plan ?? "free",
        subscriptionEnd: persona.account.subscriptionEnd ?? null,
      },
    });
    const owner = await db.user.create({
      data: { email: ownerEmail, name: `Владелец ${persona.key}`, role: "owner", organizationId: org.id, phone: persona.phone, passwordHash, createdAt: persona.account.createdAt, journalAccessMigrated: false },
    });
    await db.account.create({
      data: {
        ownerUserId: owner.id,
        subscriptionPlan: persona.account.plan ?? "free",
        subscriptionEnd: persona.account.subscriptionEnd ?? null,
        planCycle: persona.account.planCycle ?? null,
        planPoints: persona.account.planPoints ?? 1,
        trialEndsAt: persona.account.trialEndsAt ?? null,
        createdAt: persona.account.createdAt,
        organizations: { connect: { id: org.id } },
      },
    });
    if (persona.users > 1) {
      await db.user.createMany({
        data: Array.from({ length: persona.users - 1 }, (_, index) => ({
          email: `staff${index}@lc-${persona.key}.ru`,
          name: `Сотрудник ${index + 1}`,
          role: "cook",
          organizationId: org.id,
          passwordHash,
          createdAt: persona.account.createdAt,
        })),
      });
    }
    if (persona.buildings > 1) {
      await db.building.createMany({ data: Array.from({ length: persona.buildings }, (_, index) => ({ organizationId: org.id, name: `Точка ${index + 1}` })) });
    }
    if (persona.entriesWeek > 0) {
      const base = Date.now();
      await db.journalEntry.createMany({
        data: Array.from({ length: persona.entriesWeek }, (_, index) => ({
          templateId: template.id,
          organizationId: org.id,
          filledById: owner.id,
          data: {},
          createdAt: new Date(base - ((index % 144) + 1) * H),
        })),
      });
    }
  }

  // Клиент сам выставил счёт 3 рабочих дня назад и бросил оплату картой 3 часа назад.
  const invoiceOwner = await db.user.findUniqueOrThrow({ where: { email: "owner@lc-invoice.ru" }, select: { id: true } });
  await db.paymentOrder.deleteMany({ where: { id: { in: [910001, 910002] } } });
  await db.paymentOrder.create({
    data: { id: 910001, email: "owner@lc-invoice.ru", tariffKey: "standard_year", amountRub: 23880, description: "«Стандарт» за год (счёт)", status: "pending", organizationId: "lc-invoice", userId: invoiceOwner.id, paymentMethod: "invoice", invoiceDueAt: atMsk(addDays(D0, 2), 0), createdAt: atMsk(addDays(D0, -5), 15), points: 1, changeKind: "new" },
  });
  await db.paymentOrder.create({
    data: { id: 910002, email: "owner@lc-invoice.ru", tariffKey: "standard_month", amountRub: 2990, description: "«Стандарт» помесячно", status: "pending", organizationId: "lc-invoice", userId: invoiceOwner.id, paymentMethod: "card", createdAt: new Date(Date.now() - 3 * H), points: 1, changeKind: "new" },
  });

  // Договор «Ромашки» подписан в ЭДО (Saby, код 7).
  await db.edoDocument.deleteMany({ where: { organizationId: "lc-romashka" } });
  await db.edoDocument.create({
    data: { organizationId: "lc-romashka", kind: "contract", sabyType: "ДоговорДок", number: "WS-2026/0099", docDate: D0, fileName: "Договор.pdf", sabyDocId: `e2e-${Date.now()}`, cabinetClientId: "e2e", recipientInn: "7701234567", recipientName: "Кафе «Ромашка» e2e", stateCode: 7, stateName: "Подписан", refreshedAt: atMsk(addDays(D0, -1), 15) },
  });

  console.log(`fixtures: ${PERSONAS.length} клиентов, D0=${D0}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect().catch(() => undefined);
    process.exit(process.exitCode ?? 0);
  });
