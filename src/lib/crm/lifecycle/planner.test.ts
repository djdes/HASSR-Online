import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DEFAULT_PLAN_RATES } from "@/lib/tariff-plans";

import { addWorkingDays, atMsk, isWorkingDay, workingDayOnOrBefore } from "./calendar";
import { quoted, renderClientMessage, renderTaskCopy, whatTurnsOff, type MessageContext, type TaskContext } from "./copy";
import { recommendOffer, segmentOf, type UsageSnapshot } from "./offer";
import { latestStage, planLifecycle, stageDays, type DealView, type PlanInput, type UnitSnapshot } from "./planner";
import { DEFAULT_LIFECYCLE_SETTINGS, ladderDiscount, normalizeLifecycleSettings, type LifecycleSettings } from "./settings";
import { advanceStage } from "./stages";

const DAY = 24 * 60 * 60 * 1000;
/** Неразрывные пробелы чисел → обычные, чтобы сравнивать тексты. */
const plain = (text: string) => text.replace(/[\u00a0\u202f]/g, " ");
// Аккаунт создан в понедельник 2 ноября 2026, 10:00 МСК; пробный 14 дней — до 16 ноября 10:00
// (последний день — понедельник 16-го). «За 4 дня» — чт 12-го, «за 2 дня» — сб 14-го → пт 13-го.
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
  return {
    unit: u,
    deals: [],
    done: new Set(),
    now,
    settings: DEFAULT_LIFECYCLE_SETTINGS,
    rates: DEFAULT_PLAN_RATES,
    assigneeLimit: 15,
    ...extra,
  };
}

function deal(patch: Partial<DealView> = {}): DealView {
  return {
    id: "d1",
    dedupeKey: "trial:acc1",
    kind: "trial",
    stage: "registered",
    stageManual: false,
    periodEnd: TRIAL_END,
    offer: null,
    contractSignedAt: null,
    ...patch,
  };
}

describe("календарь ступеней", () => {
  it("выходные и праздники сдвигают ступень на рабочий день раньше", () => {
    assert.equal(isWorkingDay("2026-11-04"), false, "4 ноября — праздник");
    assert.equal(isWorkingDay("2026-11-14"), false, "суббота");
    assert.equal(workingDayOnOrBefore("2026-11-04"), "2026-11-03");
    assert.deepEqual(
      stageDays([4, 2], "2026-11-16", {}).map((item) => [item.stage, item.day]),
      [
        [4, "2026-11-12"],
        [2, "2026-11-13"],
      ],
    );
  });

  it("совпавшая с прошлой ступень уходит на рабочий день позже, но не позже последнего дня", () => {
    // Последний день — вторник 17-го: «за 4» — пт 13-го, «за 2» — вс 15-го → пт 13-го занят → пн 16-го.
    assert.deepEqual(
      stageDays([4, 2], "2026-11-17", {}).map((item) => [item.stage, item.day]),
      [
        [4, "2026-11-13"],
        [2, "2026-11-16"],
      ],
    );
    // Последний день — понедельник: ступень «за 1» (вс → пт) совпала бы с «за 2» (сб → пт) → пн.
    assert.deepEqual(stageDays([2, 1], "2026-11-16", {}).map((item) => item.day), ["2026-11-13", "2026-11-16"]);
  });

  it("рабочие дни после даты не считают выходные", () => {
    assert.equal(addWorkingDays("2026-11-13", 1), "2026-11-16");
    assert.equal(addWorkingDays("2026-11-03", 1), "2026-11-05", "4 ноября пропущено");
  });

  it("срабатывает только последняя наступившая ступень", () => {
    assert.equal(latestStage([4, 2], "2026-11-16", atMsk("2026-11-12", 9), {}), null, "до 10:00 рано");
    assert.equal(latestStage([4, 2], "2026-11-16", atMsk("2026-11-12", 10, 5), {})?.stage, 4);
    assert.equal(latestStage([4, 2], "2026-11-16", atMsk("2026-11-13", 12), {})?.stage, 2);
    assert.equal(latestStage([4, 2], "2026-11-16", atMsk("2026-11-17", 12), {}), null, "срок прошёл");
  });
});

describe("сегмент и предложение", () => {
  it("сегменты по данным аккаунта", () => {
    assert.equal(segmentOf(usage({ activeUsers: 1, enabledJournals: 1 })), "fits_free");
    assert.equal(segmentOf(usage({ entries14d: 0 })), "idle");
    assert.equal(segmentOf(usage({ activeUsers: 1 })), "solo");
    assert.equal(segmentOf(usage()), "team");
  });

  it("лестница скидок по сотрудникам", () => {
    const ladder = DEFAULT_LIFECYCLE_SETTINGS.discountLadder;
    assert.equal(ladderDiscount(ladder, 9), 0);
    assert.equal(ladderDiscount(ladder, 10), 10);
    assert.equal(ladderDiscount(ladder, 30), 15);
    assert.equal(ladderDiscount(ladder, 120), 25);
  });

  it("24 сотрудника на 2 точках — «Стандарт» за год со скидкой 10 %", () => {
    const offer = recommendOffer({ kind: "trial", usage: usage(), newClientCycle: "year", ladder: DEFAULT_LIFECYCLE_SETTINGS.discountLadder, rates: DEFAULT_PLAN_RATES });
    assert.equal(offer.tier, "standard");
    assert.equal(offer.points, 2);
    assert.equal(offer.cycle, "year");
    assert.equal(offer.amountRub, 1990 * 12 * 2);
    assert.equal(offer.discountPercent, 10);
    assert.equal(offer.discountedRub, Math.round(1990 * 12 * 2 * 0.9));
    assert.equal(offer.yearSavingRub, 2990 * 2 * 12 - 1990 * 12 * 2);
  });

  it("120 сотрудников на одной точке — «Премиум» на 3 точки, скидка 25 %", () => {
    const offer = recommendOffer({
      kind: "trial",
      usage: usage({ activeUsers: 120, pointsInUse: 1 }),
      newClientCycle: "year",
      ladder: DEFAULT_LIFECYCLE_SETTINGS.discountLadder,
      rates: DEFAULT_PLAN_RATES,
    });
    assert.equal(offer.tier, "premium");
    assert.equal(offer.points, 3);
    assert.equal(offer.discountPercent, 25);
    assert.ok(offer.reasons.some((reason) => reason.includes("120")));
  });

  it("датчики — «Премиум»; продление — тот же тариф и период", () => {
    assert.equal(
      recommendOffer({ kind: "trial", usage: usage({ activeUsers: 3, devices: 2 }), newClientCycle: "year", ladder: [], rates: DEFAULT_PLAN_RATES }).tier,
      "premium",
    );
    const renewal = recommendOffer({
      kind: "renewal",
      usage: usage({ activeUsers: 5, pointsInUse: 1 }),
      paidTier: "premium",
      planCycle: "month",
      planPoints: 2,
      newClientCycle: "year",
      ladder: [],
      rates: DEFAULT_PLAN_RATES,
    });
    assert.deepEqual([renewal.tier, renewal.cycle, renewal.points], ["premium", "month", 2]);
  });
});

describe("автоворонка: пробный период", () => {
  it("регистрация: сделка «Зарегистрировался» и задача «Познакомиться» на следующий рабочий день", () => {
    const plan = planLifecycle(input(unit(), atMsk("2026-11-02", 12)));
    assert.equal(plan.deal?.key, "trial:acc1");
    assert.equal(plan.deal?.exists, false);
    const welcome = plan.tasks.find((task) => task.scenario === "welcome");
    assert.ok(welcome);
    assert.equal(welcome.dueAt.toISOString(), atMsk("2026-11-03", 11).toISOString());
    assert.equal(plan.messages.length, 0);
  });

  it("за 4 дня: письмо со счётом и задача позвонить, скидка в пределах лимита", () => {
    const plan = planLifecycle(input(unit(), atMsk("2026-11-12", 10, 30)));
    assert.equal(plan.messages.length, 1);
    const message = plan.messages[0];
    assert.equal(message.key, "lc:msg:trial_t4:acc1:2026-11-16");
    assert.equal(message.attachInvoice, true);
    assert.deepEqual(message.invoiceTarget, { tier: "standard", cycle: "year", points: 2 });
    assert.equal(message.daysLeft, 4);
    const task = plan.tasks.find((item) => item.scenario === "trial");
    assert.ok(task);
    assert.equal(task.kind, "call");
    assert.equal(task.supersede, true);
    assert.equal(task.approval.needed, false);
    assert.equal(task.dueAt.toISOString(), atMsk("2026-11-12", 11).toISOString());
  });

  it("повторный прогон ничего не дублирует", () => {
    const first = planLifecycle(input(unit(), atMsk("2026-11-12", 10, 30)));
    const done = new Set([...first.messages.map((m) => m.key), ...first.tasks.map((t) => t.key)]);
    const second = planLifecycle(input(unit(), atMsk("2026-11-12", 11, 30), { done, deals: [deal()] }));
    assert.equal(second.messages.length, 0);
    assert.equal(second.tasks.length, 0);
    assert.equal(second.deal?.exists, true);
  });

  it("вечером письмо ждёт утра, задача ставится", () => {
    const plan = planLifecycle(input(unit(), atMsk("2026-11-12", 20)));
    assert.equal(plan.messages.length, 0);
    assert.ok(plan.tasks.some((task) => task.scenario === "trial"));
  });

  it("пропустили «за 4 дня» — только «за 2 дня» (в пятницу вместо субботы)", () => {
    const plan = planLifecycle(input(unit(), atMsk("2026-11-13", 12)));
    assert.deepEqual(plan.messages.map((m) => m.stage), [2]);
    assert.deepEqual(plan.tasks.filter((t) => t.scenario === "trial").map((t) => t.stage), [2]);
  });

  it("не начали работать: задача на 4-й день, за 4 дня — письмо без счёта и задача, за 2 дня — только письмо", () => {
    const idle = unit({ usage: usage({ entries7d: 0, entries14d: 0, lastEntryAt: null }) });
    const day4 = planLifecycle(input(idle, atMsk("2026-11-05", 12)));
    assert.ok(day4.tasks.some((task) => task.scenario === "activation"));
    const t4 = planLifecycle(input(idle, atMsk("2026-11-12", 12)));
    assert.equal(t4.messages[0].segment, "idle");
    assert.equal(t4.messages[0].attachInvoice, false);
    assert.ok(t4.tasks.some((task) => task.scenario === "trial"));
    assert.ok(!t4.tasks.some((task) => task.scenario === "activation"), "после ступени активация уже не ставится");
    const t2 = planLifecycle(input(idle, atMsk("2026-11-13", 12)));
    assert.equal(t2.messages.length, 1);
    assert.equal(t2.tasks.filter((task) => task.scenario === "trial").length, 0);
  });

  it("в пределах бесплатного: короткое письмо, задач нет", () => {
    const plan = planLifecycle(input(unit({ usage: usage({ activeUsers: 1, enabledJournals: 1 }) }), atMsk("2026-11-12", 12)));
    assert.equal(plan.messages[0].segment, "fits_free");
    assert.equal(plan.messages[0].attachInvoice, false);
    assert.equal(plan.tasks.length, 0);
  });

  it("один человек: задача только за 4 дня", () => {
    const solo = unit({ usage: usage({ activeUsers: 1 }) });
    assert.ok(planLifecycle(input(solo, atMsk("2026-11-12", 12))).tasks.some((t) => t.scenario === "trial"));
    assert.ok(!planLifecycle(input(solo, atMsk("2026-11-13", 12))).tasks.some((t) => t.scenario === "trial"));
  });

  it("100+ сотрудников — супер-скидка на согласование, если лимит меньше", () => {
    const big = unit({ usage: usage({ activeUsers: 140, pointsInUse: 4 }) });
    const manager = planLifecycle(input(big, atMsk("2026-11-12", 12), { assigneeLimit: 15 }));
    const task = manager.tasks.find((t) => t.scenario === "trial");
    assert.equal(task?.offer?.discountPercent, 25);
    assert.equal(task?.approval.needed, true);
    const director = planLifecycle(input(big, atMsk("2026-11-12", 12), { assigneeLimit: 25 }));
    assert.equal(director.tasks.find((t) => t.scenario === "trial")?.approval.needed, false);
  });

  it("без ИНН счёт не прикладывается", () => {
    const plan = planLifecycle(input(unit({ hasInn: false }), atMsk("2026-11-12", 12)));
    assert.equal(plan.messages[0].attachInvoice, false);
  });

  it("переход на оплату выключен — клиенту не пишем, задачи ставим", () => {
    const plan = planLifecycle(input(unit({ enforcement: false }), atMsk("2026-11-12", 12)));
    assert.equal(plan.messages.length, 0);
    assert.equal(plan.tasks.length, 0, "ступени пробного без перехода на оплату не срабатывают");
  });

  it("договор подписан — колонка «Договор подписан»; ручная колонка не двигается", () => {
    const signed = unit({ contractSignedAt: atMsk("2026-11-06", 15) });
    const plan = planLifecycle(input(signed, atMsk("2026-11-06", 16), { deals: [deal()] }));
    assert.deepEqual(plan.stageChanges.map((c) => c.to), ["contract_signed"]);
    const manual = planLifecycle(input(signed, atMsk("2026-11-06", 16), { deals: [deal({ stageManual: true })] }));
    assert.equal(manual.stageChanges.length, 0);
  });

  it("отказ, отмеченный руками, останавливает письма и задачи", () => {
    const plan = planLifecycle(input(unit(), atMsk("2026-11-12", 12), { deals: [deal({ stage: "lost", stageManual: true })] }));
    assert.equal(plan.messages.length, 0);
    assert.equal(plan.tasks.length, 0);
  });

  it("автоворонка выключена — ничего", () => {
    const settings: LifecycleSettings = { ...DEFAULT_LIFECYCLE_SETTINGS, enabled: false };
    const plan = planLifecycle(input(unit(), atMsk("2026-11-12", 12), { settings }));
    assert.equal(plan.deal, null);
  });

  it("письма клиентам выключены — только задачи", () => {
    const settings: LifecycleSettings = { ...DEFAULT_LIFECYCLE_SETTINGS, clientMessages: false };
    const plan = planLifecycle(input(unit(), atMsk("2026-11-12", 12), { settings }));
    assert.equal(plan.messages.length, 0);
    assert.ok(plan.tasks.some((task) => task.scenario === "trial"));
  });
});

describe("автоворонка: найдено эмулятором", () => {
  it("задача ночью получает срок 11:00 ближайшего рабочего дня, а не «сейчас»", () => {
    const idle = unit({ usage: usage({ entries7d: 0, entries14d: 0, lastEntryAt: null }) });
    const night = planLifecycle(input(idle, atMsk("2026-11-05", 22, 5)));
    const task = night.tasks.find((t) => t.scenario === "activation");
    assert.equal(task?.dueAt.toISOString(), atMsk("2026-11-06", 11).toISOString());
    assert.equal(task?.kind, "call");
    const telegramOnly = planLifecycle(input(unit({ usage: idle.usage, owner: { phone: false, telegram: true, email: true } }), atMsk("2026-11-05", 12)));
    assert.equal(telegramOnly.tasks.find((t) => t.scenario === "activation")?.kind, "message");
    const emailOnly = planLifecycle(input(unit({ usage: idle.usage, owner: { phone: false, telegram: false, email: true } }), atMsk("2026-11-05", 12)));
    assert.ok(!emailOnly.tasks.some((t) => t.scenario === "activation"), "без телефона и Telegram — только приветственная цепочка писем");
  });

  it("знакомство и активация — без скидки и согласования", () => {
    const big = unit({ usage: usage({ activeUsers: 140, pointsInUse: 4 }) });
    const welcome = planLifecycle(input(big, atMsk("2026-11-02", 12))).tasks.find((t) => t.scenario === "welcome");
    assert.equal(welcome?.approval.needed, false);
  });

  it("в пределах бесплатного — одно письмо, а не на каждой ступени", () => {
    const fits = unit({ usage: usage({ activeUsers: 1, enabledJournals: 1 }) });
    assert.equal(planLifecycle(input(fits, atMsk("2026-11-12", 12))).messages.length, 1);
    assert.equal(planLifecycle(input(fits, atMsk("2026-11-13", 12))).messages.length, 0);
  });

  it("сделка прошлого срока без оплаты закрывается, когда у аккаунта уже другой период", () => {
    const stale = deal({ dedupeKey: "renewal:acc1:2026-11-11", kind: "renewal", periodEnd: atMsk("2026-11-12", 0), stage: "message_sent" });
    const plan = planLifecycle(input(unit(), atMsk("2026-11-13", 12), { deals: [stale] }));
    assert.deepEqual(plan.lost.map((l) => [l.dealKey, l.reason]), [["renewal:acc1:2026-11-11", "Срок прошёл без оплаты"]]);
    assert.equal(plan.deal?.key, "trial:acc1");
  });

  it("продление постоянного клиента — без скидки по лестнице", () => {
    const paidUntil = atMsk("2027-01-21", 0);
    const plan = planLifecycle(input(unit({}, { kind: "paid", paidTier: "standard", planCycle: "year", planPoints: 2, paidUntil, subscriptionEnd: paidUntil }), atMsk("2027-01-15", 11)));
    assert.equal(plan.deal?.offer.discountPercent, 0);
  });

  it("грейс продления — «оплата закончилась», а не «пробный»", () => {
    const paidUntil = atMsk("2027-01-21", 0);
    const expired = unit({}, { kind: "needs_decision", reason: "subscription_expired", subscriptionEnd: paidUntil, graceEndsAt: new Date(paidUntil.getTime() + 7 * DAY) });
    const task = planLifecycle(input(expired, atMsk("2027-01-21", 12))).tasks.find((t) => t.scenario === "grace_start");
    assert.ok(task);
    const copy = renderTaskCopy(task, { orgName: "Шаурма", contact: { name: null, phone: null, telegram: false, email: null }, messageSent: false, invoice: null, hasInn: true });
    assert.match(copy.title, /оплата закончилась/);
  });
});

describe("автоворонка: грейс, оплата, отказ", () => {
  const GRACE_END = new Date(TRIAL_END.getTime() + 7 * DAY); // последний день грейса — пн 23-го
  const grace = (patch: Partial<UnitSnapshot> = {}) =>
    unit(patch, { kind: "needs_decision", reason: "trial_ended", graceEndsAt: GRACE_END });

  it("пробный кончился: задача «не оплачено» на следующий рабочий день", () => {
    const plan = planLifecycle(input(grace(), atMsk("2026-11-16", 12), { deals: [deal()] }));
    const task = plan.tasks.find((t) => t.scenario === "grace_start");
    assert.ok(task);
    assert.equal(task.dueAt.toISOString(), atMsk("2026-11-17", 11).toISOString());
    assert.equal(plan.messages.length, 0);
  });

  it("за 2 дня до конца грейса: последнее письмо со счётом и срочная задача", () => {
    const plan = planLifecycle(input(grace(), atMsk("2026-11-20", 11), { deals: [deal()] }));
    assert.equal(plan.messages[0]?.scenario, "grace_last");
    assert.equal(plan.messages[0]?.graceLastDay, "2026-11-23");
    assert.equal(plan.messages[0]?.attachInvoice, true);
    assert.ok(plan.tasks.some((t) => t.scenario === "grace_last"));
    assert.ok(!plan.tasks.some((t) => t.scenario === "grace_start"));
  });

  it("оплатили — сделка «Оплачено», текущей сделки нет", () => {
    const paid = unit({}, { kind: "paid", paidTier: "standard", planCycle: "year", paidUntil: new Date(TRIAL_END.getTime() + 365 * DAY), subscriptionEnd: new Date(TRIAL_END.getTime() + 365 * DAY) });
    const plan = planLifecycle(input(paid, atMsk("2026-11-14", 12), { deals: [deal({ stage: "called" })] }));
    assert.deepEqual(plan.won.map((w) => w.dealKey), ["trial:acc1"]);
    assert.equal(plan.deal, null);
  });

  it("ушли на бесплатный — «Отказ» и задача «вернуть» через 3 рабочих дня; в пределах бесплатного — без задачи", () => {
    const free = unit({ usage: usage({ activeUsers: 1, enabledJournals: 1 }) }, { kind: "free", reason: "trial_ended" });
    const offer = recommendOffer({ kind: "trial", usage: usage(), newClientCycle: "year", ladder: DEFAULT_LIFECYCLE_SETTINGS.discountLadder, rates: DEFAULT_PLAN_RATES });
    const plan = planLifecycle(input(free, atMsk("2026-11-24", 9), { deals: [deal({ offer })] }));
    assert.equal(plan.lost[0]?.reason, "Перешёл на бесплатный тариф");
    const winback = plan.tasks.find((t) => t.scenario === "winback");
    assert.equal(winback?.dueAt.toISOString(), atMsk("2026-11-27", 11).toISOString());
    const quiet = planLifecycle(input(free, atMsk("2026-11-24", 9), { deals: [deal({ offer: { ...offer, segment: "fits_free" } })] }));
    assert.equal(quiet.lost.length, 1);
    assert.equal(quiet.tasks.length, 0);
  });
});

describe("автоворонка: продление", () => {
  const paidUntil = atMsk("2027-01-21", 0); // последний день — ср 20 января 2027
  const paidUnit = (cycle: "year" | "month") =>
    unit({}, { kind: "paid", paidTier: "standard", planCycle: cycle, planPoints: 2, paidUntil, subscriptionEnd: paidUntil, trialEndsAt: TRIAL_END });

  it("год: за 30 дней — письмо «продлите заранее» со счётом на продление, без задачи", () => {
    const plan = planLifecycle(input(paidUnit("year"), atMsk("2026-12-21", 11)));
    assert.equal(plan.deal?.kind, "renewal");
    assert.equal(plan.deal?.key, "renewal:acc1:2027-01-20");
    assert.equal(plan.messages[0]?.stage, 30);
    assert.deepEqual(plan.messages[0]?.invoiceTarget, { tier: "standard", cycle: "year", points: 2 });
    assert.equal(plan.tasks.length, 0);
  });

  it("год: раньше окна сделки нет", () => {
    assert.equal(planLifecycle(input(paidUnit("year"), atMsk("2026-12-10", 11))).deal, null);
  });

  it("за 4 и 2 дня — письмо и задача; за 1 день — только письмо", () => {
    const t4 = planLifecycle(input(paidUnit("year"), atMsk("2027-01-15", 11)));
    assert.equal(t4.messages[0]?.stage, 4);
    assert.ok(t4.tasks.some((t) => t.scenario === "renewal" && t.stage === 4));
    const t1 = planLifecycle(input(paidUnit("year"), atMsk("2027-01-19", 11)));
    assert.equal(t1.messages[0]?.stage, 1);
    assert.equal(t1.tasks.length, 0);
  });

  it("помесячно: окно 7 дней", () => {
    assert.equal(planLifecycle(input(paidUnit("month"), atMsk("2027-01-12", 11))).deal, null);
    assert.equal(planLifecycle(input(paidUnit("month"), atMsk("2027-01-13", 11))).messages[0]?.stage, 7);
  });

  it("продлили — сделка продления «Оплачено»", () => {
    const renewed = unit({}, { kind: "paid", paidTier: "standard", planCycle: "year", paidUntil: atMsk("2028-01-21", 0), subscriptionEnd: atMsk("2028-01-21", 0) });
    const plan = planLifecycle(input(renewed, atMsk("2027-01-18", 11), { deals: [deal({ dedupeKey: "renewal:acc1:2027-01-20", kind: "renewal", periodEnd: paidUntil, stage: "message_sent" })] }));
    assert.deepEqual(plan.won.map((w) => w.reason), ["Продлили"]);
  });

  it("оплата кончилась — грейс по сделке продления", () => {
    const expired = unit({}, { kind: "needs_decision", reason: "subscription_expired", paidTier: null, subscriptionEnd: paidUntil, graceEndsAt: new Date(paidUntil.getTime() + 7 * DAY) });
    const plan = planLifecycle(input(expired, atMsk("2027-01-21", 12), { deals: [deal({ dedupeKey: "renewal:acc1:2027-01-20", kind: "renewal", periodEnd: paidUntil })] }));
    assert.equal(plan.deal?.key, "renewal:acc1:2027-01-20");
    assert.ok(plan.tasks.some((t) => t.scenario === "grace_start"));
  });
});

describe("автоворонка: счета и оплата картой", () => {
  it("счёт клиента не оплачен 2 рабочих дня — задача; просрочен — задача; счёт автоворонки — без задачи", () => {
    const invoice = { id: 501, createdAt: atMsk("2026-11-05", 12), dueAt: atMsk("2026-11-12", 12), amountRub: 47760, auto: false };
    const early = planLifecycle(input(unit({ invoices: [invoice] }), atMsk("2026-11-06", 12)));
    assert.ok(!early.tasks.some((t) => t.scenario === "invoice_unpaid"), "1 рабочий день — рано");
    const late = planLifecycle(input(unit({ invoices: [invoice] }), atMsk("2026-11-09", 12)));
    assert.ok(late.tasks.some((t) => t.scenario === "invoice_unpaid"));
    const expired = planLifecycle(input(unit({ invoices: [invoice] }), atMsk("2026-11-13", 12)));
    assert.ok(expired.tasks.some((t) => t.scenario === "invoice_expired"));
    const auto = planLifecycle(input(unit({ invoices: [{ ...invoice, auto: true }] }), atMsk("2026-11-09", 12)));
    assert.ok(!auto.tasks.some((t) => t.scenario.startsWith("invoice")));
  });

  it("брошенная оплата картой — задача через 2 часа, не позже 72 часов", () => {
    const card = { id: 77, createdAt: atMsk("2026-11-06", 10), amountRub: 2990 };
    assert.ok(!planLifecycle(input(unit({ abandonedCard: card }), atMsk("2026-11-06", 11))).tasks.some((t) => t.scenario === "card_abandoned"));
    assert.ok(planLifecycle(input(unit({ abandonedCard: card }), atMsk("2026-11-06", 13))).tasks.some((t) => t.scenario === "card_abandoned"));
    assert.ok(!planLifecycle(input(unit({ abandonedCard: card }), atMsk("2026-11-10", 13))).tasks.some((t) => t.scenario === "card_abandoned"));
  });
});

describe("колонки сделки", () => {
  it("вперёд — да, назад — нет, ручная — только оплата/отказ", () => {
    assert.equal(advanceStage({ stage: "registered", stageManual: false }, "message_sent"), "message_sent");
    assert.equal(advanceStage({ stage: "called", stageManual: false }, "message_sent"), null);
    assert.equal(advanceStage({ stage: "registered", stageManual: true }, "called"), null);
    assert.equal(advanceStage({ stage: "registered", stageManual: true }, "won"), "won");
    assert.equal(advanceStage({ stage: "lost", stageManual: true }, "won"), "won");
    assert.equal(advanceStage({ stage: "won", stageManual: false }, "lost"), null);
  });
});

describe("настройки", () => {
  it("битые поля — значения по умолчанию, ступени по убыванию", () => {
    const settings = normalizeLifecycleSettings({ enabled: false, trialStages: [2, 4, 4], discountLadder: "x", invoiceCycle: "week" });
    assert.equal(settings.enabled, false);
    assert.deepEqual(settings.trialStages, [4, 2]);
    assert.deepEqual(settings.discountLadder, DEFAULT_LIFECYCLE_SETTINGS.discountLadder);
    assert.equal(settings.invoiceCycle, "year");
  });
});

describe("тексты", () => {
  const ctx: MessageContext = {
    orgName: "Кафе «Ромашка»",
    recipientName: "Анна",
    invoice: { number: "501", amountRub: 47760, dueDay: "2026-11-19" },
    innMissing: false,
    manager: { name: "Алексей", position: "Коммерческий директор", phone: "+7 900 000-00-00", email: "alexey@wesetup.ru" },
    links: { pay: "https://wesetup.ru/settings/subscription", pricing: "https://wesetup.ru/pricing", organization: "https://wesetup.ru/settings/organization" },
    graceDays: 7,
  };

  it("письмо «за 4 дня» — по данным аккаунта, со счётом и подписью", () => {
    const plan = planLifecycle(input(unit(), atMsk("2026-11-12", 10, 30)));
    const rendered = renderClientMessage(plan.messages[0], ctx);
    const message = { ...rendered, text: plain(rendered.text) };
    assert.match(message.subject, /пробный период до 16 ноября/);
    assert.match(message.text, /24 сотрудника, 12 журналов, 2 точки; за последнюю неделю — 340 записей/);
    assert.match(message.text, /23 сотрудника уйдут в архив, 11 журналов выключатся/);
    assert.match(message.text, /«Стандарт» на 2 точки: 47 760 ₽ за год — 3 980 ₽\/мес/);
    assert.match(message.text, /Счёт № 501 на 47 760 ₽ — во вложении, действует до 19 ноября/);
    assert.match(message.text, /через 4 дня — 16 ноября \(понедельник\) последний день/);
    assert.match(message.text, /Коммерческий директор/);
    assert.ok(!message.html.includes("<script"));
  });

  it("не начали — предложение продлить пробный; без ИНН — подсказка указать ИНН", () => {
    const idle = planLifecycle(input(unit({ usage: usage({ entries14d: 0, entries7d: 0 }) }), atMsk("2026-11-12", 12)));
    assert.match(renderClientMessage(idle.messages[0], { ...ctx, invoice: null }).text, /продлим пробный период/);
    const noInn = planLifecycle(input(unit({ hasInn: false }), atMsk("2026-11-12", 12)));
    assert.match(renderClientMessage(noInn.messages[0], { ...ctx, invoice: null, innMissing: true }).text, /укажите ИНН/);
  });

  it("помесячное продление предлагает год", () => {
    const paidUntil = atMsk("2027-01-21", 0);
    const plan = planLifecycle(
      input(unit({}, { kind: "paid", paidTier: "standard", planCycle: "month", planPoints: 1, paidUntil, subscriptionEnd: paidUntil }), atMsk("2027-01-15", 11)),
    );
    assert.match(renderClientMessage(plan.messages[0], ctx).text, /Перейдите на оплату за год/);
  });

  it("название в кавычках не кавычится второй раз", () => {
    assert.equal(quoted("Ромашка"), "«Ромашка»");
    assert.equal(quoted("Кафе «Ромашка»"), "Кафе «Ромашка»");
  });

  it("что отключится — только реальные цифры", () => {
    assert.equal(whatTurnsOff({ users: 2, journals: 1 }), "1 сотрудник уйдёт в архив");
    assert.equal(whatTurnsOff({ users: 1, journals: 1 }), null);
  });

  it("задача: факты аккаунта, предложение и пометка о согласовании", () => {
    const big = planLifecycle(input(unit({ usage: usage({ activeUsers: 140, pointsInUse: 4 }) }), atMsk("2026-11-12", 12), { assigneeLimit: 15 }));
    const task = big.tasks.find((t) => t.scenario === "trial");
    assert.ok(task);
    const taskCtx: TaskContext = { orgName: "Кафе «Ромашка»", contact: { name: "Анна", phone: "+7 900", telegram: true, email: "anna@cafe.ru" }, messageSent: true, invoice: null, hasInn: true };
    const copy = renderTaskCopy(task, taskCtx);
    assert.match(copy.title, /^Пробный Кафе «Ромашка» до 16 ноября/);
    assert.ok(!copy.title.includes("««"), "кавычки названия не удваиваются");
    assert.match(plain(copy.body), /140 сотрудников/);
    assert.match(copy.body, /25 %/);
    assert.match(copy.body, /согласование/);
    assert.match(copy.body, /телефон \+7 900/);
  });
});
