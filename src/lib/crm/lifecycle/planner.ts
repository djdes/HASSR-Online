/**
 * Планировщик автоворонки CRM — чистая функция: по снимку аккаунта биллинга,
 * его сделкам, уже сделанным действиям и времени решает, что сделать сейчас:
 * завести или закрыть сделку, двинуть колонку, написать клиенту, поставить
 * задачу ответственному. Сервер (`run.server.ts`) только собирает снимок и
 * исполняет план; эмулятор (`scripts/crm-lifecycle-simulate.ts`) гоняет этот
 * же планировщик по дням.
 *
 * Правила (спека `.agent/tasks/crm-lifecycle-2026-11/spec.md`):
 * - ступени «за N дней» считаются от последнего дня срока, выходные и праздники
 *   сдвигают ступень на рабочий день раньше (совпала с прошлой — на рабочий
 *   день позже, но не позже последнего дня);
 * - срабатывает только последняя наступившая ступень: пропущенные не догоняем;
 * - каждое действие — по уникальному ключу: повторный прогон ничего не дублирует;
 * - письма клиенту — в рабочее время, задачи — со сроком на день ступени.
 */

import { isPaidTier, planMonthlyRub, planPeriodPriceRub, type BillingCycle, type PaidTier, type PlanRates } from "@/lib/tariff-plans";

import {
  CLIENT_SEND_HOURS,
  DAY_MS,
  TASK_DUE_HOUR,
  addDays,
  addWorkingDays,
  atMsk,
  diffDays,
  isClientSendTime,
  isWorkingDay,
  lastDayOf,
  mskDay,
  mskHour,
  workingDayOnOrAfter,
  workingDayOnOrBefore,
  workingDaysBetween,
  type DayKey,
  type WorkCalendar,
} from "./calendar";
import { needsApproval, recommendOffer, type OfferSnapshot, type Segment, type UsageSnapshot } from "./offer";
import type { LifecycleSettings } from "./settings";
import { advanceStage, isOpenStage, type DealKind, type DealStage } from "./stages";

export type BillingKind = "exempt" | "paid" | "legacy" | "free_period" | "free" | "needs_decision";

export type PendingInvoice = {
  id: number;
  createdAt: Date;
  dueAt: Date | null;
  amountRub: number;
  /** Выставила автоворонка (о таком счёте задачу не ставим — есть задачи ступеней). */
  auto: boolean;
};

export type UnitSnapshot = {
  /** Единица биллинга: id аккаунта или `org:<id>`. */
  unitKey: string;
  organizationId: string;
  organizationName: string;
  accountCreatedAt: Date;
  /** Переход на оплату включён: после пробного действуют лимиты бесплатного. */
  enforcement: boolean;
  billing: {
    kind: BillingKind;
    inactive: boolean;
    paidTier: PaidTier | "legacy" | null;
    planCycle: BillingCycle;
    planPoints: number;
    /** До какого числа оплачено (только у оплаченных). */
    paidUntil: Date | null;
    /** Последний оплаченный срок, в том числе истёкший. */
    subscriptionEnd: Date | null;
    trialEndsAt: Date | null;
    graceEndsAt: Date | null;
    reason: "trial_ended" | "subscription_expired" | null;
  };
  usage: UsageSnapshot;
  owner: { phone: boolean; telegram: boolean; email: boolean };
  hasInn: boolean;
  /** Договор подписан (ЭДО Saby). */
  contractSignedAt: Date | null;
  /** Неоплаченные счета на подписку. */
  invoices: PendingInvoice[];
  /** Начатая и брошенная оплата картой (2–72 часа назад, без оплаты после). */
  abandonedCard: { id: number; createdAt: Date; amountRub: number } | null;
};

export type DealView = {
  id: string;
  dedupeKey: string;
  kind: DealKind;
  stage: string;
  stageManual: boolean;
  periodEnd: Date | null;
  offer: OfferSnapshot | null;
  contractSignedAt: Date | null;
};

export type PlanInput = {
  unit: UnitSnapshot;
  /** Сделки этой единицы биллинга (открытые и закрытые). */
  deals: readonly DealView[];
  /** Ключи уже сделанных действий (письма и задачи автоворонки). */
  done: ReadonlySet<string>;
  now: Date;
  settings: LifecycleSettings;
  rates: PlanRates;
  /** Лимит скидки того, кто будет ответственным, %. */
  assigneeLimit: number;
};

export type Scenario =
  | "welcome"
  | "activation"
  | "trial"
  | "grace_start"
  | "grace_last"
  | "renewal"
  | "invoice_unpaid"
  | "invoice_expired"
  | "card_abandoned"
  | "winback";

/** Сценарии ступеней: новая задача ступени закрывает прежнюю открытую («Заменена новой»). */
export const STAGE_SCENARIOS: ReadonlySet<string> = new Set(["welcome", "activation", "trial", "grace_start", "grace_last", "renewal"]);

export const SCENARIO_LABELS: Record<Scenario, string> = {
  welcome: "Знакомство",
  activation: "Помочь запустить",
  trial: "Конец пробного",
  grace_start: "Пробный кончился, не оплачено",
  grace_last: "Последний шанс перед отключением",
  renewal: "Продление",
  invoice_unpaid: "Счёт не оплачен",
  invoice_expired: "Счёт истёк",
  card_abandoned: "Брошенная оплата картой",
  winback: "Вернуть клиента",
};

export type InvoiceTarget = { tier: PaidTier; cycle: BillingCycle; points: number };

export type MessagePlan = {
  key: string;
  dealKey: string;
  scenario: "trial" | "grace_last" | "renewal";
  /** За сколько дней до конца (ступень). */
  stage: number;
  segment: Segment;
  /** Последний день срока (пробного / оплаченного). */
  lastDay: DayKey;
  /** Дней от сегодня до последнего дня. */
  daysLeft: number;
  /** Последний день грейса — у «последнего шанса». */
  graceLastDay: DayKey | null;
  attachInvoice: boolean;
  invoiceTarget: InvoiceTarget | null;
  offer: OfferSnapshot;
  /** Новый клиент или продление — для текста. */
  dealKind: DealKind;
  /** Переход на оплату включён: можно писать, что отключится. */
  enforcement: boolean;
  /** Счёт хотели бы приложить, но у организации нет ИНН — подсказать указать. */
  innHint: boolean;
  /** Дублировать в Telegram (ступени ≤ 4 дней и «последний шанс»). */
  telegram: boolean;
  /** Что оплачено сейчас (продление): тариф, период, точки и цена продления. */
  paidPlan: PaidPlan | null;
};

export type PaidPlan = { tier: PaidTier | "legacy"; cycle: BillingCycle; points: number; amountRub: number | null; monthlyRub: number | null };

export type TaskPlan = {
  key: string;
  dealKey: string | null;
  scenario: Scenario;
  stage: number | null;
  kind: "call" | "message" | "invoice";
  dueAt: Date;
  /** Закрыть прежние открытые задачи ступеней этой сделки. */
  supersede: boolean;
  offer: OfferSnapshot | null;
  segment: Segment;
  lastDay: DayKey | null;
  daysLeft: number | null;
  graceLastDay: DayKey | null;
  invoice: PendingInvoice | null;
  card: UnitSnapshot["abandonedCard"];
  approval: { needed: boolean; limit: number };
  /** Письмо клиенту той же ступени (если запланировано). */
  messageKey: string | null;
  /** Новый клиент или продление — для текста. */
  dealKind: DealKind | null;
};

export type DealPlan = { key: string; kind: DealKind; periodEnd: Date | null; offer: OfferSnapshot; exists: boolean };

export type LifecyclePlan = {
  deal: DealPlan | null;
  stageChanges: { dealKey: string; to: DealStage; reason: string }[];
  won: { dealKey: string; reason: string }[];
  lost: { dealKey: string; reason: string }[];
  /** Сделки, закрытые автоматикой, снова в работе (ROOT продлил пробный, возврат оплаты). */
  reopened: { dealKey: string; reason: string }[];
  messages: MessagePlan[];
  tasks: TaskPlan[];
};

export function emptyPlan(): LifecyclePlan {
  return { deal: null, stageChanges: [], won: [], lost: [], reopened: [], messages: [], tasks: [] };
}

export function messageKey(scenario: string, stage: number, unitKey: string, lastDay: DayKey): string {
  return `lc:msg:${scenario}${stage ? `_t${stage}` : ""}:${unitKey}:${lastDay}`;
}

export function taskKey(scenario: string, stage: number | null, ref: string): string {
  return `lc:task:${scenario}${stage ? `_t${stage}` : ""}:${ref}`;
}

export type StageDay = { stage: number; day: DayKey; fireAt: Date };

/**
 * Дни ступеней для срока с последним днём `lastDay`: «за N дней» → рабочий
 * день раньше; совпал с прошлой ступенью или раньше её — рабочий день после
 * неё; позже последнего дня — ступени нет.
 */
export function stageDays(stages: readonly number[], lastDay: DayKey, calendar: WorkCalendar): StageDay[] {
  const result: StageDay[] = [];
  let previous: DayKey | null = null;
  for (const stage of [...new Set(stages)].sort((a, b) => b - a)) {
    let day = workingDayOnOrBefore(addDays(lastDay, -stage), calendar);
    if (previous && day <= previous) day = workingDayOnOrAfter(addDays(previous, 1), calendar);
    if (day > lastDay) continue;
    result.push({ stage, day, fireAt: atMsk(day, CLIENT_SEND_HOURS.start) });
    previous = day;
  }
  return result;
}

/** Последняя наступившая ступень (или null). */
export function latestStage(stages: readonly number[], lastDay: DayKey, now: Date, calendar: WorkCalendar): StageDay | null {
  if (mskDay(now) > lastDay) return null;
  let best: StageDay | null = null;
  for (const item of stageDays(stages, lastDay, calendar)) {
    if (item.fireAt.getTime() <= now.getTime()) best = item;
  }
  return best;
}

/**
 * Срок задачи: день ступени в 11:00. Уже прошло — «сейчас», если идёт рабочий
 * день, иначе 11:00 ближайшего рабочего дня (ночью и в выходные не дёргаем).
 */
function dueOn(day: DayKey, now: Date, calendar: WorkCalendar = {}): Date {
  const due = atMsk(day, TASK_DUE_HOUR);
  if (due.getTime() >= now.getTime()) return due;
  const today = mskDay(now);
  const hour = mskHour(now);
  if (isWorkingDay(today, calendar) && hour >= 9 && hour < CLIENT_SEND_HOURS.end) return now;
  const next = isWorkingDay(today, calendar) && hour < 9 ? today : addWorkingDays(today, 1, calendar);
  return atMsk(next, TASK_DUE_HOUR);
}

type CurrentDeal = { key: string; kind: DealKind; periodEnd: Date | null };

/** Какая сделка сейчас в работе у единицы биллинга (или никакая). */
export function currentDealFor(unit: UnitSnapshot, now: Date, settings: LifecycleSettings, calendar: WorkCalendar): CurrentDeal | null {
  const b = unit.billing;
  if (b.kind === "free_period") {
    return b.trialEndsAt ? { key: `trial:${unit.unitKey}`, kind: "trial", periodEnd: b.trialEndsAt } : null;
  }
  if (b.kind === "needs_decision") {
    if (b.reason === "subscription_expired" && b.subscriptionEnd) {
      return { key: `renewal:${unit.unitKey}:${lastDayOf(b.subscriptionEnd)}`, kind: "renewal", periodEnd: b.subscriptionEnd };
    }
    return { key: `trial:${unit.unitKey}`, kind: "trial", periodEnd: b.trialEndsAt };
  }
  if (b.kind === "paid" && b.paidUntil) {
    const lastDay = lastDayOf(b.paidUntil);
    const stages = b.planCycle === "year" ? settings.renewalYearStages : settings.renewalMonthStages;
    const first = stageDays(stages, lastDay, calendar)[0];
    if (!first || mskDay(now) < first.day) return null;
    return { key: `renewal:${unit.unitKey}:${lastDay}`, kind: "renewal", periodEnd: b.paidUntil };
  }
  return null;
}

export function planLifecycle(input: PlanInput): LifecyclePlan {
  const { unit, now, settings, done } = input;
  const plan = emptyPlan();
  if (!settings.enabled) return plan;
  const b = unit.billing;
  if (b.kind === "exempt" || b.inactive) return plan;
  const calendar: WorkCalendar = { holidays: settings.holidays };
  const today = mskDay(now);
  let current = currentDealFor(unit, now, settings, calendar);
  // Срок продления сдвинули на день-два (правка ROOT) — это та же сделка, а не новая.
  if (current?.kind === "renewal" && current.periodEnd) {
    const end = current.periodEnd.getTime();
    const near = input.deals.find(
      (deal) => deal.kind === "renewal" && deal.dedupeKey !== current?.key && isOpenStage(deal.stage) && deal.periodEnd !== null && Math.abs(deal.periodEnd.getTime() - end) <= 3 * DAY_MS,
    );
    if (near) current = { ...current, key: near.dedupeKey };
  }

  // 1. Закрыть сделки прошлых периодов: оплатили — «Оплачено», ушли на бесплатный — «Отказ».
  for (const deal of input.deals) {
    if (current && deal.dedupeKey === current.key) continue;
    if (b.kind === "paid") {
      const paidOn =
        deal.kind === "trial" ||
        (b.paidUntil !== null && deal.periodEnd !== null && b.paidUntil.getTime() > deal.periodEnd.getTime() + DAY_MS);
      if (paidOn && deal.stage !== "won") {
        plan.won.push({ dealKey: deal.dedupeKey, reason: deal.stage === "lost" ? "Оплатили после отказа" : deal.kind === "trial" ? "Оплатили тариф" : "Продлили" });
      }
      continue;
    }
    // Срок сделки прошёл без оплаты, а у аккаунта уже другой период (пробный
    // после истёкшей оплаты, грейс по другому сроку) — сделка закрыта отказом.
    if (
      (b.kind === "free_period" || b.kind === "needs_decision") &&
      isOpenStage(deal.stage) &&
      deal.periodEnd !== null &&
      deal.periodEnd.getTime() <= now.getTime()
    ) {
      plan.lost.push({ dealKey: deal.dedupeKey, reason: "Срок прошёл без оплаты" });
      continue;
    }
    if (b.kind === "free" && isOpenStage(deal.stage) && (!deal.periodEnd || deal.periodEnd.getTime() <= now.getTime())) {
      const fitsFree = deal.offer?.segment === "fits_free";
      plan.lost.push({ dealKey: deal.dedupeKey, reason: fitsFree ? "Остался на бесплатном (1 сотрудник и 1 журнал)" : "Перешёл на бесплатный тариф" });
      const segment = deal.offer?.segment;
      if (segment === "team" || segment === "solo") {
        plan.tasks.push({
          key: taskKey("winback", null, deal.dedupeKey),
          dealKey: deal.dedupeKey,
          scenario: "winback",
          stage: null,
          kind: "call",
          dueAt: dueOn(addWorkingDays(today, settings.winbackAfterWorkingDays, calendar), now, calendar),
          supersede: true,
          offer: deal.offer,
          segment,
          lastDay: deal.periodEnd ? lastDayOf(deal.periodEnd) : null,
          daysLeft: null,
          graceLastDay: null,
          invoice: null,
          card: null,
          approval: { needed: needsApproval(deal.offer?.discountPercent ?? 0, input.assigneeLimit), limit: input.assigneeLimit },
          messageKey: null,
          dealKind: deal.kind,
        });
      }
    }
  }

  // 2. Текущая сделка: завести, обновить рекомендацию, отметить договор.
  const offer = recommendOffer({
    kind: current?.kind ?? "trial",
    usage: unit.usage,
    paidTier: b.paidTier,
    planCycle: b.planCycle,
    planPoints: b.planPoints,
    newClientCycle: settings.invoiceCycle,
    ladder: settings.discountLadder,
    rates: input.rates,
  });
  if (!current) {
    attachLooseTasks(plan, input, null, offer, today);
    return plan;
  }
  const existing = input.deals.find((deal) => deal.dedupeKey === current.key) ?? null;
  plan.deal = { key: current.key, kind: current.kind, periodEnd: current.periodEnd, offer, exists: Boolean(existing) };
  let dealState: { stage: string; stageManual: boolean } = existing ?? { stage: "registered", stageManual: false };
  // Закрыла автоматика, а период снова в работе (ROOT продлил пробный, вернули оплату) —
  // сделка открывается заново. Закрытое руками («Отказ» клиента) остаётся закрытым.
  if (existing && !isOpenStage(existing.stage) && !existing.stageManual) {
    plan.reopened.push({ dealKey: existing.dedupeKey, reason: existing.stage === "won" ? "Оплата больше не действует" : "Период снова в работе" });
    dealState = { stage: "registered", stageManual: false };
  }
  if (unit.contractSignedAt) {
    const to = advanceStage(dealState, "contract_signed");
    if (to) plan.stageChanges.push({ dealKey: current.key, to, reason: "Договор подписан в ЭДО" });
  }
  attachLooseTasks(plan, input, current.key, offer, today);
  // Отказ или «оплачено», отмеченные руками, автоматику по сделке останавливают.
  if (!isOpenStage(dealState.stage)) return plan;

  const segment = offer.segment;
  const approval = { needed: needsApproval(offer.discountPercent, input.assigneeLimit), limit: input.assigneeLimit };
  const canSend = settings.clientMessages && (unit.owner.email || unit.owner.telegram) && isClientSendTime(now, calendar);
  const base = { dealKey: current.key, offer, segment, invoice: null, card: null, approval, dealKind: current.kind };
  const noApproval = { needed: false, limit: input.assigneeLimit };
  const pushTask = (task: Omit<TaskPlan, keyof typeof base> & Partial<typeof base>) => {
    if (done.has(task.key)) return;
    plan.tasks.push({ ...base, ...task });
  };
  const invoiceWanted = (seg: Segment) => seg === "team" || seg === "solo" || current.kind === "renewal";
  const pushMessage = (message: Omit<MessagePlan, "enforcement" | "innHint" | "telegram" | "paidPlan"> & { paidPlan?: PaidPlan | null }) => {
    if (!canSend || done.has(message.key)) return;
    plan.messages.push({
      ...message,
      paidPlan: message.paidPlan ?? null,
      enforcement: unit.enforcement,
      innHint: settings.attachInvoice && !unit.hasInn && invoiceWanted(message.segment),
      telegram: message.scenario === "grace_last" || message.stage <= 4,
    });
  };
  const invoiceTarget: InvoiceTarget = { tier: offer.tier, cycle: offer.cycle, points: offer.points };
  const wantsInvoice = (seg: Segment) => settings.attachInvoice && unit.hasInn && invoiceWanted(seg);

  // 3. Пробный период.
  if (b.kind === "free_period" && b.trialEndsAt) {
    const lastDay = lastDayOf(b.trialEndsAt);
    const regDay = mskDay(unit.accountCreatedAt);
    if (unit.owner.phone && diffDays(regDay, today) <= 3 && segment !== "fits_free") {
      pushTask({
        key: taskKey("welcome", null, unit.unitKey),
        scenario: "welcome",
        stage: null,
        kind: "call",
        approval: noApproval,
        dueAt: dueOn(workingDayOnOrAfter(addDays(regDay, 1), calendar), now, calendar),
        supersede: false,
        lastDay,
        daysLeft: diffDays(today, lastDay),
        graceLastDay: null,
        messageKey: null,
      });
    }
    const firstTrialStage = stageDays(settings.trialStages, lastDay, calendar)[0];
    // «Помочь запустить» — тем, с кем можно поговорить (телефон или Telegram):
    // по почте их и так ведёт приветственная цепочка, а пустые регистрации
    // не должны заваливать менеджера задачами.
    if (
      segment === "idle" &&
      (unit.owner.phone || unit.owner.telegram) &&
      now.getTime() >= unit.accountCreatedAt.getTime() + 3 * DAY_MS &&
      (!firstTrialStage || today < firstTrialStage.day)
    ) {
      pushTask({
        key: taskKey("activation", null, unit.unitKey),
        scenario: "activation",
        stage: null,
        kind: unit.owner.phone ? "call" : "message",
        approval: noApproval,
        dueAt: dueOn(workingDayOnOrAfter(today, calendar), now, calendar),
        supersede: true,
        lastDay,
        daysLeft: diffDays(today, lastDay),
        graceLastDay: null,
        messageKey: null,
      });
    }
    const stage = latestStage(settings.trialStages, lastDay, now, calendar);
    if (stage && unit.enforcement) {
      const daysLeft = diffDays(today, lastDay);
      const mKey = messageKey("trial", stage.stage, unit.unitKey, lastDay);
      const firstStage = stageDays(settings.trialStages, lastDay, calendar)[0]?.stage;
      if (segment !== "fits_free" || stage.stage === firstStage) pushMessage({
        key: mKey,
        dealKey: current.key,
        scenario: "trial",
        stage: stage.stage,
        segment,
        lastDay,
        daysLeft,
        graceLastDay: null,
        attachInvoice: wantsInvoice(segment),
        invoiceTarget: wantsInvoice(segment) ? invoiceTarget : null,
        offer,
        dealKind: current.kind,
      });
      const taskStages = settings.trialStages.filter((n) => n <= settings.taskStageMax);
      const firstTaskStage = taskStages.length ? Math.max(...taskStages) : null;
      // Работающим (команда или один человек) — задача на каждой ступени; «не начал» —
      // одна задача на период: ключ первой ступени, поэтому пропущенная «за 4 дня»
      // ставится на следующей ступени, а сделанная не повторяется.
      const taskHere = stage.stage <= settings.taskStageMax && segment !== "fits_free";
      if (taskHere) {
        pushTask({
          key: taskKey("trial", segment === "idle" ? (firstTaskStage ?? stage.stage) : stage.stage, `${unit.unitKey}:${lastDay}`),
          scenario: "trial",
          stage: stage.stage,
          kind: unit.owner.phone ? "call" : "message",
          dueAt: dueOn(stage.day, now, calendar),
          supersede: true,
          lastDay,
          daysLeft,
          graceLastDay: null,
          messageKey: mKey,
        });
      }
    }
  }

  // 4. Грейс: пробный или оплата кончились, тариф не выбран.
  if (b.kind === "needs_decision" && b.graceEndsAt && current.periodEnd) {
    const lastDay = lastDayOf(current.periodEnd);
    const graceLastDay = lastDayOf(b.graceEndsAt);
    const graceEnd = b.graceEndsAt;
    const startDay = workingDayOnOrAfter(addDays(lastDay, 1), calendar);
    // «Последний шанс» — не раньше начала грейса (самого момента конца срока), иначе
    // грейс через праздники (31 декабря → 11 января) прошёл бы без предупреждения.
    const endDay = mskDay(current.periodEnd);
    let lastStageDay = workingDayOnOrBefore(addDays(graceLastDay, -settings.graceLastStage), calendar);
    if (lastStageDay < endDay) lastStageDay = endDay;
    const lastFire = new Date(Math.max(atMsk(lastStageDay, CLIENT_SEND_HOURS.start).getTime(), current.periodEnd.getTime()));
    // Срок задачи — не позже автоперехода.
    const graceDue = (day: DayKey) => {
      const due = dueOn(day, now, calendar);
      return due.getTime() > graceEnd.getTime() ? now : due;
    };
    const worthCalling = segment === "team" || segment === "solo" || current.kind === "renewal";
    const ref = `${unit.unitKey}:${lastDay}`;
    if (today <= graceLastDay && now.getTime() >= lastFire.getTime()) {
      const mKey = messageKey("grace_last", 0, unit.unitKey, lastDay);
      if (unit.enforcement) {
        pushMessage({
          key: mKey,
          dealKey: current.key,
          scenario: "grace_last",
          stage: settings.graceLastStage,
          segment,
          lastDay,
          daysLeft: diffDays(today, graceLastDay),
          graceLastDay,
          attachInvoice: wantsInvoice(segment),
          invoiceTarget: wantsInvoice(segment) ? invoiceTarget : null,
          offer,
          dealKind: current.kind,
        });
      }
      if (worthCalling) {
        pushTask({
          key: taskKey("grace_last", null, ref),
          scenario: "grace_last",
          stage: null,
          kind: unit.owner.phone ? "call" : "message",
          dueAt: graceDue(lastStageDay),
          supersede: true,
          lastDay,
          daysLeft: diffDays(today, graceLastDay),
          graceLastDay,
          messageKey: mKey,
        });
      }
    } else if (today <= graceLastDay && worthCalling && !done.has(taskKey("grace_last", null, ref))) {
      pushTask({
        key: taskKey("grace_start", null, ref),
        scenario: "grace_start",
        stage: null,
        kind: unit.owner.phone ? "call" : "message",
        dueAt: graceDue(startDay),
        supersede: true,
        lastDay,
        daysLeft: diffDays(today, graceLastDay),
        graceLastDay,
        messageKey: null,
      });
    }
  }

  // 5. Продление оплаченного срока.
  if (b.kind === "paid" && b.paidUntil && current.kind === "renewal") {
    const lastDay = lastDayOf(b.paidUntil);
    const stages = b.planCycle === "year" ? settings.renewalYearStages : settings.renewalMonthStages;
    const stage = latestStage(stages, lastDay, now, calendar);
    if (stage) {
      const daysLeft = diffDays(today, lastDay);
      const mKey = messageKey("renewal", stage.stage, unit.unitKey, lastDay);
      // Счёт на продление — ровно на оплаченный тариф, период и точки: иначе касса
      // посчитает его доплатой за переход и срок не продлится. Точек в работе больше
      // оплаченных или прежняя «Подписка» — без счёта, решает менеджер.
      const renewTier = isPaidTier(b.paidTier) && unit.usage.pointsInUse <= b.planPoints ? b.paidTier : null;
      const renewTarget: InvoiceTarget | null = renewTier ? { tier: renewTier, cycle: b.planCycle, points: b.planPoints } : null;
      const attach = wantsInvoice(segment) && renewTarget !== null;
      pushMessage({
        key: mKey,
        dealKey: current.key,
        scenario: "renewal",
        stage: stage.stage,
        segment,
        lastDay,
        daysLeft,
        graceLastDay: null,
        attachInvoice: attach,
        invoiceTarget: attach ? renewTarget : null,
        offer,
        dealKind: current.kind,
        paidPlan: {
          tier: isPaidTier(b.paidTier) ? b.paidTier : "legacy",
          cycle: b.planCycle,
          points: b.planPoints,
          amountRub: renewTier ? planPeriodPriceRub(input.rates, renewTier, b.planCycle, b.planPoints) : null,
          monthlyRub: renewTier ? planMonthlyRub(input.rates, renewTier, b.planCycle, b.planPoints) : null,
        },
      });
      if (stage.stage <= settings.taskStageMax && stage.stage > 1) {
        pushTask({
          key: taskKey("renewal", stage.stage, `${unit.unitKey}:${lastDay}`),
          scenario: "renewal",
          stage: stage.stage,
          kind: unit.owner.phone ? "call" : "message",
          dueAt: dueOn(stage.day, now, calendar),
          supersede: true,
          lastDay,
          daysLeft,
          graceLastDay: null,
          messageKey: mKey,
        });
      }
    }
  }
  return plan;
}

/** Задачи не по ступеням: счёт не оплачен или истёк, брошенная оплата картой. */
function attachLooseTasks(plan: LifecyclePlan, input: PlanInput, dealKey: string | null, offer: OfferSnapshot, today: DayKey): void {
  const { unit, now, done, settings } = input;
  const calendar: WorkCalendar = { holidays: settings.holidays };
  const fallbackDeal = dealKey ?? input.deals.find((deal) => isOpenStage(deal.stage))?.dedupeKey ?? null;
  const base = {
    dealKey: fallbackDeal,
    stage: null,
    offer,
    segment: offer.segment,
    lastDay: null,
    daysLeft: null,
    graceLastDay: null,
    invoice: null,
    card: null,
    approval: { needed: false, limit: input.assigneeLimit },
    messageKey: null,
    supersede: false,
    dealKind: (dealKey ? dealKey.split(":")[0] : null) as DealKind | null,
  } as const;
  const valid = unit.invoices.filter((invoice) => !invoice.dueAt || invoice.dueAt.getTime() > now.getTime());
  for (const invoice of unit.invoices) {
    if (invoice.auto) continue;
    const expired = invoice.dueAt !== null && invoice.dueAt.getTime() <= now.getTime();
    if (expired) {
      const recent = now.getTime() - (invoice.dueAt?.getTime() ?? 0) <= 7 * DAY_MS;
      const key = taskKey("invoice_expired", null, String(invoice.id));
      if (recent && valid.length === 0 && unit.billing.kind !== "paid" && !done.has(key)) {
        plan.tasks.push({ ...base, key, scenario: "invoice_expired", kind: "invoice", dueAt: dueOn(workingDayOnOrAfter(today, calendar), now, calendar), invoice });
      }
      continue;
    }
    const waited = workingDaysBetween(mskDay(invoice.createdAt), today, calendar);
    const key = taskKey("invoice_unpaid", null, String(invoice.id));
    if (waited >= 2 && !done.has(key)) {
      plan.tasks.push({ ...base, key, scenario: "invoice_unpaid", kind: "invoice", dueAt: dueOn(workingDayOnOrAfter(today, calendar), now, calendar), invoice });
    }
  }
  const card = unit.abandonedCard;
  if (card) {
    const age = now.getTime() - card.createdAt.getTime();
    const key = taskKey("card_abandoned", null, String(card.id));
    if (age >= 2 * 60 * 60 * 1000 && age <= 72 * 60 * 60 * 1000 && !done.has(key)) {
      plan.tasks.push({ ...base, key, scenario: "card_abandoned", kind: "call", dueAt: dueOn(workingDayOnOrAfter(today, calendar), now, calendar), card });
    }
  }
}
