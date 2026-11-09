/**
 * Независимая проверка автоворонки CRM (ревью Opus, 2026-11-09).
 *
 * Блок «найдено» — ошибки, найденные ревью (тест падал на коде до правки,
 * ожидание — правильное поведение); теперь это регрессионные тесты. Блок
 * «проверено» — важные свойства, которые верны и должны оставаться такими.
 *
 * Серверные функции (`offers.server`, `settings.server`) проверяются с
 * подменёнными методами `db` — база не трогается (адрес базы — заведомо
 * недоступный, все используемые запросы подменены).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DEFAULT_PLAN_RATES, quotePlanChange } from "@/lib/tariff-plans";

import { atMsk, mskDay } from "./calendar";
import { quoted, renderClientMessage, type MessageContext } from "./copy";
import type { UsageSnapshot } from "./offer";
import { planLifecycle, stageDays, type DealView, type MessagePlan, type PlanInput, type UnitSnapshot } from "./planner";
import { DEFAULT_LIFECYCLE_SETTINGS, type LifecycleSettings } from "./settings";

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const plain = (text: string) => text.replace(/[  ]/g, " ");

// Как в planner.test.ts: создан пн 2 ноября 2026 10:00 МСК, пробный до пн 16 ноября 10:00.
const CREATED = atMsk("2026-11-02", 10);
const TRIAL_END = new Date(CREATED.getTime() + 14 * DAY);

function usage(patch: Partial<UsageSnapshot> = {}): UsageSnapshot {
  return {
    activeUsers: 24,
    enabledJournals: 12,
    pointsInUse: 2,
    entries7d: 340,
    entries14d: 600,
    journalsUsed14d: 9,
    lastEntryAt: atMsk("2026-11-11", 18),
    devices: 0,
    ...patch,
  };
}

function unit(patch: Partial<UnitSnapshot> = {}, billing: Partial<UnitSnapshot["billing"]> = {}): UnitSnapshot {
  return {
    unitKey: "acc1",
    organizationId: "org1",
    organizationName: "Кафе «Ромашка»",
    accountCreatedAt: CREATED,
    enforcement: true,
    billing: {
      kind: "free_period",
      inactive: false,
      paidTier: null,
      planCycle: "month",
      planPoints: 1,
      paidUntil: null,
      subscriptionEnd: null,
      trialEndsAt: TRIAL_END,
      graceEndsAt: null,
      reason: null,
      ...billing,
    },
    usage: usage(),
    owner: { phone: true, telegram: true, email: true },
    hasInn: true,
    contractSignedAt: null,
    invoices: [],
    abandonedCard: null,
    ...patch,
  };
}

function input(u: UnitSnapshot, now: Date, extra: Partial<PlanInput> = {}): PlanInput {
  return { unit: u, deals: [], done: new Set(), now, settings: DEFAULT_LIFECYCLE_SETTINGS, rates: DEFAULT_PLAN_RATES, assigneeLimit: 15, ...extra };
}

function deal(patch: Partial<DealView> = {}): DealView {
  return { id: "d1", dedupeKey: "trial:acc1", kind: "trial", stage: "registered", stageManual: false, periodEnd: TRIAL_END, offer: null, contractSignedAt: null, ...patch };
}

const CTX: MessageContext = {
  orgName: "Кафе «Ромашка»",
  recipientName: "Анна",
  invoice: null,
  innMissing: false,
  manager: { name: "Алексей", position: "Менеджер", phone: null, email: "alexey@wesetup.ru" },
  links: { pay: "https://wesetup.ru/settings/subscription", pricing: "https://wesetup.ru/pricing", organization: "https://wesetup.ru/settings/organization" },
  graceDays: 7,
};

/** Подменить методы моделей `db` (без обращения к базе). */
async function mockDb(patch: Record<string, Record<string, unknown>>) {
  process.env.DATABASE_URL = "postgresql://invalid:invalid@127.0.0.1:1/none";
  process.env.DATABASE_URL_DIRECT = process.env.DATABASE_URL;
  const { db } = await import("@/lib/db");
  const target = db as unknown as Record<string, unknown>;
  for (const [model, methods] of Object.entries(patch)) target[model] = methods;
  return db;
}

type StaffRow = { id: string; name: string; isRoot: boolean; key: string | null; limit: number; salesHead?: boolean };
const staffRows = (rows: StaffRow[]) =>
  rows.map((row, index) => ({
    id: row.id,
    name: row.name,
    email: `${row.id}@wesetup.ru`,
    contactEmail: null,
    telegramChatId: null,
    isRoot: row.isRoot,
    platformSalesHead: row.salesHead ?? false,
    createdAt: new Date(Date.UTC(2026, 0, 1 + index)),
    platformRole: row.key ? { key: row.key, discountLimit: row.limit } : null,
  }));

const STAFF: StaffRow[] = [
  { id: "root", name: "Владелец", isRoot: true, key: null, limit: 100 },
  { id: "dir", name: "Алексей", isRoot: false, key: "commercial_director", limit: 25 },
  { id: "rop", name: "РОП", isRoot: false, key: "sales_head", limit: 15, salesHead: true },
  { id: "mgr", name: "Менеджер 1", isRoot: false, key: "sales_manager", limit: 10 },
  { id: "mgr2", name: "Менеджер 2", isRoot: false, key: "sales_manager", limit: 10 },
];

// ---------------------------------------------------------------------------
describe("ревью Opus: найденные ошибки (исправлены)", () => {
  it("A: переход на оплату выключен — о продлении не напоминает никто (биллинг уступил, автоворонка молчит)", async () => {
    await mockDb({ platformSetting: { findUnique: async () => null } });
    const { lifecycleOwnsBillingReminders } = await import("./settings.server");
    const owns = await lifecycleOwnsBillingReminders();
    // Помесячная оплата до ср 20 января 2027; «за 7 дней» — ср 13-го.
    const paidUntil = atMsk("2027-01-21", 0);
    const paid = unit({ enforcement: false }, { kind: "paid", paidTier: "standard", planCycle: "month", planPoints: 1, paidUntil, subscriptionEnd: paidUntil });
    const plan = planLifecycle(input(paid, atMsk("2027-01-13", 11)));
    assert.ok(
      !owns || plan.messages.length > 0,
      `биллинг пропускает remind_paid_end (lifecycleOwnsBillingReminders=${owns}), а планировщик при enforcement=false писем не планирует (${plan.messages.length}) — клиент без напоминания`,
    );
  });

  it("B1: «счёт на продление» «Стандарта» с датчиками — на самом деле доплата за апгрейд до конца срока, срок не продлевается", () => {
    const paidUntil = atMsk("2027-01-21", 0); // последний день — ср 20 января; «за 4 дня» — пт 15-го
    const now = atMsk("2027-01-15", 11);
    const std = unit({ usage: usage({ activeUsers: 6, pointsInUse: 1, devices: 2 }) }, { kind: "paid", paidTier: "standard", planCycle: "month", planPoints: 1, paidUntil, subscriptionEnd: paidUntil });
    const message = planLifecycle(input(std, now)).messages[0];
    assert.ok(message?.invoiceTarget, "письмо продления со счётом");
    const quote = quotePlanChange({ rates: DEFAULT_PLAN_RATES, legacyMonthlyRub: 0, current: { paidUntil, tier: "standard", cycle: "month", points: 1 }, target: message.invoiceTarget, now });
    assert.equal(
      quote.kind,
      "renew",
      `счёт «продления» на ${JSON.stringify(message.invoiceTarget)} — это «${quote.kind}» на ${quote.amountRub} ₽ с концом ${quote.periodEnd.toISOString()} (оплаченный срок не продлится)`,
    );
  });

  it("B2: письмо продления называет оплаченным тарифом рекомендацию («Премиум»), а не то, за что платят («Стандарт»)", () => {
    const paidUntil = atMsk("2027-01-21", 0);
    const std = unit({ usage: usage({ activeUsers: 6, pointsInUse: 1, devices: 2 }) }, { kind: "paid", paidTier: "standard", planCycle: "month", planPoints: 1, paidUntil, subscriptionEnd: paidUntil });
    const message = planLifecycle(input(std, atMsk("2027-01-15", 11))).messages[0];
    const text = plain(renderClientMessage(message, CTX).text);
    assert.match(text, /Оплаченный период [^\n]*\(«Стандарт», помесячно\)/, text.split("\n")[2]);
  });

  it("B3: прежняя «Подписка» (legacy) — письмо утверждает, что оплачен «Стандарт»", () => {
    const paidUntil = atMsk("2027-01-21", 0);
    const legacy = unit({ usage: usage({ activeUsers: 6, pointsInUse: 1 }) }, { kind: "paid", paidTier: "legacy", planCycle: "month", planPoints: 1, paidUntil, subscriptionEnd: paidUntil });
    const message = planLifecycle(input(legacy, atMsk("2027-01-15", 11))).messages[0];
    const text = plain(renderClientMessage(message, CTX).text);
    assert.doesNotMatch(text, /Оплаченный период [^\n]*\(«Стандарт»/, "у клиента «Подписка», а не «Стандарт»");
  });

  it("C: свои ступени [7, 1], конец в понедельник — тема «завтра последний оплаченный день» за 3 дня до конца", () => {
    const settings: LifecycleSettings = { ...DEFAULT_LIFECYCLE_SETTINGS, renewalMonthStages: [7, 1] };
    const paidUntil = atMsk("2027-01-19", 0); // последний день — пн 18 января; «за 1» — вс → пт 15-го
    const paid = unit({}, { kind: "paid", paidTier: "standard", planCycle: "month", planPoints: 1, paidUntil, subscriptionEnd: paidUntil });
    const message = planLifecycle(input(paid, atMsk("2027-01-15", 11), { settings })).messages[0];
    assert.equal(message?.stage, 1);
    assert.equal(message.daysLeft, 3);
    const subject = renderClientMessage(message, CTX).subject;
    assert.doesNotMatch(subject, /завтра/, `тема «${subject}», а до конца ${message.daysLeft} дня`);
  });

  it("J: грейс 0 дней (настройка допускает 0) — письмо пробного обещает «0 дней на решение»", () => {
    const message = planLifecycle(input(unit(), atMsk("2026-11-12", 10, 30))).messages[0];
    const text = plain(renderClientMessage(message, { ...CTX, graceDays: 0 }).text);
    assert.doesNotMatch(text, /будет 0 дней на решение/);
  });

  it("D1: «работает» один человек — за 2 дня нет задачи «повторный контакт» (строка «Пробный −2» спеки)", () => {
    const solo = unit({ usage: usage({ activeUsers: 1 }) });
    const plan = planLifecycle(input(solo, atMsk("2026-11-13", 12)));
    assert.ok(plan.tasks.some((task) => task.scenario === "trial"), "solo — сегмент «работает»: задача за 2 дня");
  });

  it("D2: ступень «за 4 дня» не сработала (автоворонку включили / пробный короткий) — у «не начал» ни одной задачи", () => {
    const idle = unit({ usage: usage({ entries7d: 0, entries14d: 0, lastEntryAt: null }) });
    const plan = planLifecycle(input(idle, atMsk("2026-11-13", 12)));
    assert.ok(plan.messages.length === 1, "письмо уходит");
    assert.ok(plan.tasks.length > 0, "менеджер так и не узнаёт про «не начал» — задачи нет ни на одной ступени");
  });

  it("G1: пробный кончился 31 декабря — срок задачи грейса после конца грейса", () => {
    const trialEnd = atMsk("2026-12-31", 15);
    const graceEnd = new Date(trialEnd.getTime() + 7 * DAY); // чт 7 января 15:00
    const u = unit({ accountCreatedAt: new Date(trialEnd.getTime() - 14 * DAY) }, { kind: "needs_decision", reason: "trial_ended", trialEndsAt: trialEnd, graceEndsAt: graceEnd });
    const plan = planLifecycle(input(u, atMsk("2026-12-31", 16), { deals: [deal({ periodEnd: trialEnd, stage: "message_sent" })] }));
    const task = plan.tasks.find((t) => t.scenario === "grace_start" || t.scenario === "grace_last");
    assert.ok(task, "задача грейса есть");
    assert.ok(task.dueAt.getTime() <= graceEnd.getTime(), `срок ${task.dueAt.toISOString()} позже автоперехода ${graceEnd.toISOString()}`);
  });

  it("G2: пробный кончился 31 декабря — письма «последний шанс» за весь грейс нет", () => {
    const trialEnd = atMsk("2026-12-31", 15);
    const graceEnd = new Date(trialEnd.getTime() + 7 * DAY);
    const u = unit({ accountCreatedAt: new Date(trialEnd.getTime() - 14 * DAY) }, { kind: "needs_decision", reason: "trial_ended", trialEndsAt: trialEnd, graceEndsAt: graceEnd });
    const done = new Set<string>();
    const sent: MessagePlan[] = [];
    for (let t = trialEnd.getTime() + HOUR; t < graceEnd.getTime(); t += HOUR) {
      const plan = planLifecycle(input(u, new Date(t), { done, deals: [deal({ periodEnd: trialEnd, stage: "message_sent" })] }));
      for (const m of plan.messages) {
        sent.push(m);
        done.add(m.key);
      }
      for (const task of plan.tasks) done.add(task.key);
    }
    assert.ok(sent.some((m) => m.scenario === "grace_last"), "клиент уходит на бесплатный без предупреждения (единственное рабочее окно — 31.12 15:00–19:00)");
  });

  it("R: сделку закрыла автоматика («Отказ»), ROOT продлил пробный — автоворонка по новому пробному молчит", () => {
    // Продлили до пн 7 декабря 00:00: последний день вс 6-го, «за 4 дня» — ср 2 декабря.
    const extended = unit({}, { kind: "free_period", trialEndsAt: atMsk("2026-12-07", 0) });
    const plan = planLifecycle(input(extended, atMsk("2026-12-02", 12), { deals: [deal({ stage: "lost", stageManual: false })] }));
    assert.equal(plan.messages.length, 1, "комментарий планировщика: останавливают только отмеченные руками");
  });

  it("S: срок оплаты сдвинули меньше чем на сутки — старая сделка продления остаётся открытой навсегда", () => {
    const oldUntil = atMsk("2027-01-21", 0);
    const newUntil = atMsk("2027-01-21", 12);
    const paid = unit({}, { kind: "paid", paidTier: "standard", planCycle: "year", planPoints: 2, paidUntil: newUntil, subscriptionEnd: newUntil });
    const old = deal({ dedupeKey: "renewal:acc1:2027-01-20", kind: "renewal", periodEnd: oldUntil, stage: "message_sent" });
    const plan = planLifecycle(input(paid, atMsk("2027-01-15", 14), { deals: [old] }));
    const handled = plan.deal?.key === old.dedupeKey || plan.won.some((w) => w.dealKey === old.dedupeKey) || plan.lost.some((l) => l.dealKey === old.dedupeKey);
    assert.ok(handled, `новая сделка ${plan.deal?.key}, а ${old.dedupeKey} не закрыта и не текущая`);
  });

  it("O1: спец-КП — согласованный процент берётся из любой задачи «Отправить КП» (чужой сделки и чужого менеджера)", async () => {
    await mockDb({
      crmDeal: {
        findUnique: async ({ where }: { where: { id: string } }) =>
          where.id === "dealY" ? { id: "dealY", ownerId: "mgr", contactId: null, organizationId: "orgY", kind: "trial", stage: "registered", offerJson: null } : null,
      },
      organization: { findUnique: async () => ({ id: "orgY", name: "Кафе Y", type: "cafe", inn: null, legalProfileJson: null }) },
      user: { findMany: async () => staffRows(STAFF) },
      platformTariff: { findMany: async () => [], createMany: async () => ({ count: 0 }) },
      crmTask: {
        // Задача «Скидка 25 % согласована: отправить КП» другой сделки, другого менеджера.
        findUnique: async () => ({ id: "taskX", kind: "offer", status: "open", assigneeId: "mgr2", dealId: "dealX", payloadJson: { dealId: "dealX", approvedPercent: 25, discountPercent: 25, requestedById: "mgr2" } }),
        create: async () => {
          throw new Error("APPROVAL_PATH");
        },
      },
      promoCode: {
        findMany: async () => {
          throw new Error("SEND_PATH_REACHED");
        },
      },
    });
    const { sendSpecialOffer } = await import("./offers.server");
    const error = await sendSpecialOffer(
      { dealId: "dealY", tier: "standard", cycle: "year", points: 1, discountPercent: 25, lifetime: false, validDays: 7, attachInvoice: false, toEmail: "boss@client.ru", note: "", taskId: "taskX" },
      { id: "mgr", name: "Менеджер 1", organizationId: "platform", own: true },
    ).then(
      () => null,
      (e: unknown) => e as Error,
    );
    assert.notEqual(error?.message, "SEND_PATH_REACHED", "менеджер с лимитом 10 % выпускает код на 25 % без согласования по чужой задаче");
  });

  it("O2: согласование — посторонний менеджер (охват «свои») отклоняет чужую заявку, передав percent: 1", async () => {
    await mockDb({
      user: { findMany: async () => staffRows(STAFF) },
      crmTask: {
        findUnique: async () => ({
          id: "appr1",
          kind: "approval",
          status: "open",
          assigneeId: "dir",
          dealId: "dealX",
          contactId: null,
          organizationId: "orgX",
          payloadJson: { dealId: "dealX", discountPercent: 25, requestedById: "mgr2", requestedByName: "Менеджер 2" },
        }),
        update: async () => {
          throw new Error("DECIDED");
        },
      },
    });
    const { decideApproval } = await import("./offers.server");
    const { CrmActionError } = await import("@/lib/crm/actions.server");
    const error = await decideApproval("appr1", { approve: false, percent: 1, comment: "" }, { id: "mgr", name: "Менеджер 1", organizationId: "platform", own: true }).then(
      () => null,
      (e: unknown) => e as Error,
    );
    assert.ok(error instanceof CrmActionError && (error as unknown as { status: number }).status === 403, `ожидали 403, получили: ${error?.message ?? "успех"}`);
  });
});

// ---------------------------------------------------------------------------
describe("ревью Opus: проверено (должно проходить)", () => {
  it("январские праздники: годовое продление по 9 января — ступени 30/14/4, «за 2» и «за 1» не выпадают на конец", () => {
    assert.deepEqual(
      stageDays([30, 14, 4, 2, 1], "2027-01-09", {}).map((s) => [s.stage, s.day]),
      [
        [30, "2026-12-10"],
        [14, "2026-12-25"],
        [4, "2026-12-31"],
      ],
    );
  });

  it("помесячно, конец в понедельник: «за 1 день» уходит в сам последний день — тема «сегодня»", () => {
    const paidUntil = atMsk("2027-01-19", 0); // последний день — пн 18 января
    const paid = unit({}, { kind: "paid", paidTier: "standard", planCycle: "month", planPoints: 1, paidUntil, subscriptionEnd: paidUntil });
    const message = planLifecycle(input(paid, atMsk("2027-01-18", 11))).messages[0];
    assert.equal(message?.stage, 1);
    assert.equal(message.daysLeft, 0);
    assert.match(renderClientMessage(message, CTX).subject, /сегодня последний оплаченный день/);
  });

  it("пробный кончается ровно в полночь МСК — последний день предыдущий; в 23:30 письма нет, задача есть", () => {
    const end = atMsk("2026-11-17", 0); // последний день — пн 16-го
    const u = unit({}, { trialEndsAt: end });
    assert.deepEqual(stageDays([4, 2], mskDay(new Date(end.getTime() - 1)), {}).map((s) => s.day), ["2026-11-12", "2026-11-13"]);
    const late = planLifecycle(input(u, atMsk("2026-11-12", 23, 30)));
    assert.equal(late.messages.length, 0);
    assert.ok(late.tasks.some((t) => t.scenario === "trial"));
  });

  it("повторные прогоны в разные дни: та же ступень не повторяется, следующая — один раз", () => {
    const done = new Set<string>();
    const keys: string[] = [];
    for (let t = atMsk("2026-11-12", 9).getTime(); t < atMsk("2026-11-14", 12).getTime(); t += 15 * 60 * 1000) {
      const plan = planLifecycle(input(unit(), new Date(t), { done, deals: [deal()] }));
      for (const item of [...plan.messages, ...plan.tasks]) {
        keys.push(item.key);
        done.add(item.key);
      }
    }
    assert.deepEqual(keys.sort(), ["lc:msg:trial_t2:acc1:2026-11-16", "lc:msg:trial_t4:acc1:2026-11-16", "lc:task:trial_t2:acc1:2026-11-16", "lc:task:trial_t4:acc1:2026-11-16"]);
  });

  it("оплата посреди ступени: сделка «Оплачено», писем и задач нет", () => {
    const until = new Date(TRIAL_END.getTime() + 365 * DAY);
    const paid = unit({}, { kind: "paid", paidTier: "standard", planCycle: "year", paidUntil: until, subscriptionEnd: until });
    const plan = planLifecycle(input(paid, atMsk("2026-11-12", 10, 30), { deals: [deal({ stage: "message_sent" })] }));
    assert.deepEqual(plan.won.map((w) => w.dealKey), ["trial:acc1"]);
    assert.equal(plan.messages.length, 0);
    assert.equal(plan.tasks.length, 0);
  });

  it("названия в кавычках: прямые и ёлочки не кавычатся второй раз", () => {
    assert.equal(quoted('ООО "Ромашка"'), 'ООО "Ромашка"');
    assert.equal(quoted("ИП Петров"), "«ИП Петров»");
  });

  it("согласующий: не сам просящий, коммерческий директор раньше владельца, некому — null", async () => {
    await mockDb({});
    const { approverFor, pickAssignee } = await import("./people.server");
    const staff = staffRows(STAFF).map((row) => ({
      id: row.id,
      name: row.name,
      email: row.email,
      contactEmail: null,
      telegramChatId: null,
      isRoot: row.isRoot,
      salesHead: row.platformSalesHead,
      roleKey: row.platformRole?.key ?? null,
      limit: row.isRoot ? 100 : (row.platformRole?.discountLimit ?? 0),
      createdAt: row.createdAt,
    }));
    assert.equal(approverFor(staff, 25, "mgr")?.id, "dir");
    assert.equal(approverFor(staff, 25, "dir")?.id, "root");
    assert.equal(approverFor(staff.filter((p) => !p.isRoot), 30, "mgr"), null);
    assert.equal(pickAssignee(staff, { dealOwnerId: "gone", accountManagerId: "mgr" }), "mgr");
    assert.equal(pickAssignee(staff, {}), "rop");
  });
});
