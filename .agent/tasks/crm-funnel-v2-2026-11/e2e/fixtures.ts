/**
 * Клиенты для живой проверки сценария «пробный и оплата» v2 — только локальная
 * БД. Сроки — от «сегодня» по Москве (D0), прогон — с реальным now: каждая
 * организация попадает ровно в одну ступень.
 *
 *   npx tsx .agent/tasks/crm-funnel-v2-2026-11/e2e/fixtures.ts
 */
import "dotenv/config";

import bcrypt from "bcryptjs";

import { db } from "../../../../src/lib/db";

if (!/127\.0\.0\.1|localhost/.test(process.env.DATABASE_URL ?? "")) {
  console.error("fixtures: only for a local database");
  process.exit(1);
}

const DAY = 24 * 3_600_000;
const H = 3_600_000;
/** «2026-11-10» по Москве. */
const D0 = new Date(Date.now() + 3 * H).toISOString().slice(0, 10);
/** Полночь по Москве дня D0 + n. */
const day = (n: number, hour = 0) => new Date(new Date(`${D0}T00:00:00+03:00`).getTime() + n * DAY + hour * H);

type Persona = {
  key: string;
  name: string;
  users: number;
  buildings: number;
  inn: string | null;
  entriesWeek: number;
  /** Старые записи (за неделей) — начали, но сейчас не ведут. */
  entriesOld?: number;
  phone: string | null;
  account: { trialEndsAt?: Date; plan?: string; subscriptionEnd?: Date; planCycle?: string; planPoints?: number; createdAt: Date };
  managerEmail?: string;
  expect: string;
};

// D0 — вторник 10.11: до понедельника 16.11 00:00 — 4 рабочих дня, до четверга 12.11 — 2.
const PERSONAS: Persona[] = [
  { key: "romashka", name: "Кафе «Ромашка» e2e", users: 24, buildings: 2, inn: "7701234567", entriesWeek: 300, phone: "+7 900 100-00-01", account: { trialEndsAt: day(6), createdAt: day(-8, 12) }, expect: "trial_first: письмо+счёт, звонок 10 %" },
  { key: "stolovaya", name: "Столовая комбината e2e", users: 120, buildings: 3, inn: "7702345678", entriesWeek: 1800, phone: "+7 900 100-00-02", account: { trialEndsAt: day(6), createdAt: day(-8, 12) }, managerEmail: "sales@wesetup.local.test", expect: "trial_first: согласование 20 % → звонок ждёт" },
  { key: "pekarnya", name: "Пекарня «Хлеб» e2e", users: 3, buildings: 1, inn: null, entriesWeek: 0, phone: null, account: { trialEndsAt: day(6), createdAt: day(-8, 12) }, expect: "trial_idle: письмо «продлим пробный», без задачи" },
  { key: "solo", name: "ИП Петров e2e", users: 1, buildings: 1, inn: null, entriesWeek: 30, phone: "+7 900 100-00-10", account: { trialEndsAt: day(6), createdAt: day(-8, 12) }, expect: "trial_first: звонок без скидки (1 человек, ведёт)" },
  { key: "quiet", name: "Кулинария «Тишина» e2e", users: 30, buildings: 1, inn: "7709012345", entriesWeek: 0, entriesOld: 12, phone: "+7 900 100-00-11", account: { trialEndsAt: day(6), createdAt: day(-8, 12) }, expect: "trial_first: письмо, без задачи (30 человек, но за неделю пусто)" },
  { key: "vtoroe", name: "Кофейня «Второе касание» e2e", users: 9, buildings: 1, inn: "7701112233", entriesWeek: 60, phone: "+7 900 100-00-12", account: { trialEndsAt: day(2), createdAt: day(-12, 12) }, expect: "trial_second: письмо, срочный звонок" },
  { key: "lost", name: "Бар «Ушли» e2e", users: 6, buildings: 1, inn: "7702223344", entriesWeek: 40, phone: "+7 900 100-00-13", account: { trialEndsAt: day(-1), createdAt: day(-15, 12) }, expect: "trial_lost: «узнать причину» (писали до конца)" },
  { key: "grace", name: "Бистро «Грейс» e2e", users: 8, buildings: 1, inn: "7703456789", entriesWeek: 120, phone: "+7 900 100-00-04", account: { trialEndsAt: day(-5), createdAt: day(-19, 12) }, expect: "grace_last: письмо+счёт, «последний шанс»" },
  { key: "year", name: "Сеть «Вкусно рядом» e2e", users: 60, buildings: 3, inn: "7704567890", entriesWeek: 900, phone: "+7 900 100-00-05", account: { plan: "standard", planCycle: "year", planPoints: 3, subscriptionEnd: day(25), createdAt: day(-340, 12) }, expect: "renewal_early: письмо «оплатите заранее» + счёт на год" },
  { key: "expired", name: "Кофейня «Не продлили» e2e", users: 5, buildings: 1, inn: "7706789012", entriesWeek: 40, phone: "+7 900 100-00-07", account: { plan: "standard", planCycle: "month", planPoints: 1, subscriptionEnd: day(-1), trialEndsAt: day(-56), createdAt: day(-70, 12) }, expect: "payment_overdue: задача" },
  { key: "invoice", name: "Цех полуфабрикатов e2e", users: 12, buildings: 1, inn: "7707890123", entriesWeek: 150, phone: "+7 900 100-00-08", account: { plan: "standard", planCycle: "month", planPoints: 1, subscriptionEnd: day(8), createdAt: day(-120, 12) }, expect: "invoice_ahead: счёт на продление по безналу" },
  { key: "paid", name: "Ресторан «Оплатили» e2e", users: 10, buildings: 1, inn: "7708901234", entriesWeek: 200, phone: "+7 900 100-00-09", account: { trialEndsAt: day(6), createdAt: day(-8, 12) }, expect: "trial_first, потом оплата: задачи закрыты, сделка «Оплачено»" },
];

async function main() {
  const passwordHash = await bcrypt.hash("LocalUser-2026!", 10);
  const template = await db.journalTemplate.findFirstOrThrow({ where: { isActive: true }, select: { id: true } });
  const managers = new Map((await db.user.findMany({ where: { organizationId: "platform" }, select: { id: true, email: true } })).map((user) => [user.email, user.id]));

  // Чистый лист: сделки, задачи, ключи сценария, счета, контакты и коды прошлых прогонов.
  await db.crmTask.deleteMany({});
  await db.crmDeal.deleteMany({});
  await db.crmReminderLog.deleteMany({ where: { dedupeKey: { startsWith: "lc:" } } });
  await db.paymentOrder.deleteMany({ where: { organizationId: { startsWith: "lc-" } } });
  await db.crmContact.deleteMany({ where: { OR: [{ email: { contains: "@lc-" } }, { organizationId: { startsWith: "lc-" } }] } });
  await db.promoCode.deleteMany({ where: { organizationId: { startsWith: "lc-" } } });
  await db.edoDocument.deleteMany({ where: { organizationId: { startsWith: "lc-" } } });
  // Ответственный по умолчанию — Алексей.
  const alexey = managers.get("alexey@wesetup.ru") ?? null;
  await db.platformSetting.upsert({ where: { key: "crm.lifecycle" }, create: { key: "crm.lifecycle", value: JSON.stringify({ enabled: true, assigneeId: alexey }) }, update: { value: JSON.stringify({ enabled: true, assigneeId: alexey }) } });

  for (const persona of PERSONAS) {
    const orgId = `lc-${persona.key}`;
    const ownerEmail = `owner@lc-${persona.key}.ru`;
    await db.account.deleteMany({ where: { organizations: { some: { id: orgId } } } });
    await db.organization.deleteMany({ where: { id: orgId } });
    await db.user.deleteMany({ where: { email: { endsWith: `@lc-${persona.key}.ru` } } });
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
      data: { email: ownerEmail, name: `Ирина ${persona.key[0].toUpperCase()}${persona.key.slice(1)}`, role: "owner", organizationId: org.id, phone: persona.phone, passwordHash, createdAt: persona.account.createdAt, journalAccessMigrated: false },
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
        data: Array.from({ length: persona.users - 1 }, (_, index) => ({ email: `staff${index}@lc-${persona.key}.ru`, name: `Сотрудник ${index + 1}`, role: "cook", organizationId: org.id, passwordHash, createdAt: persona.account.createdAt })),
      });
    }
    if (persona.buildings > 1) {
      await db.building.deleteMany({ where: { organizationId: org.id } });
      await db.building.createMany({ data: Array.from({ length: persona.buildings }, (_, index) => ({ organizationId: org.id, name: `Точка ${index + 1}` })) });
    }
    const base = Date.now();
    const entries = [
      ...Array.from({ length: persona.entriesWeek }, (_, index) => new Date(base - ((index % 144) + 1) * H)),
      ...Array.from({ length: persona.entriesOld ?? 0 }, (_, index) => new Date(base - (8 + index) * DAY)),
    ];
    if (entries.length) {
      await db.journalEntry.createMany({ data: entries.map((createdAt) => ({ templateId: template.id, organizationId: org.id, filledById: owner.id, data: {}, createdAt })) });
    }
  }

  // «Ушли»: сценарий писал им перед концом пробного (иначе «узнать причину» не ставится).
  const lost = await db.account.findFirstOrThrow({ where: { organizations: { some: { id: "lc-lost" } } }, select: { id: true, trialEndsAt: true } });
  await db.crmReminderLog.create({ data: { dedupeKey: `lc:${lost.id}:trial:${lost.trialEndsAt!.toISOString()}:trial_second`, kind: "lifecycle.trial_second" } });

  // Цех: прошлую оплату провели по счёту — значит, продление тоже счётом.
  const invoiceOwner = await db.user.findUniqueOrThrow({ where: { email: "owner@lc-invoice.ru" }, select: { id: true } });
  await db.paymentOrder.create({
    data: { email: "owner@lc-invoice.ru", tariffKey: "standard_month", amountRub: 2990, description: "«Стандарт» помесячно (счёт)", status: "paid", paidAt: day(-22, 12), organizationId: "lc-invoice", userId: invoiceOwner.id, paymentMethod: "invoice", createdAt: day(-25, 12), points: 1, changeKind: "renew" },
  });

  // Договор «Ромашки» подписан в ЭДО (Saby, код 7).
  await db.edoDocument.create({
    data: { organizationId: "lc-romashka", kind: "contract", sabyType: "ДоговорДок", number: "WS-2026/0099", docDate: D0, fileName: "Договор.pdf", sabyDocId: `e2e-${Date.now()}`, cabinetClientId: "e2e", recipientInn: "7701234567", recipientName: "Кафе «Ромашка» e2e", stateCode: 7, stateName: "Подписан", refreshedAt: day(-1, 15) },
  });

  console.log(`fixtures: ${PERSONAS.length} клиентов, D0=${D0}`);
  for (const persona of PERSONAS) console.log(`  lc-${persona.key}: ${persona.expect}`);
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
