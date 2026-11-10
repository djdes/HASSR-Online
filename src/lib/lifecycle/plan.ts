/**
 * Сценарий «пробный и оплата» (2026-11-09, доработан 2026-11-10) — чистые
 * решения без БД: что отправить клиенту и какую задачу поставить менеджеру
 * сегодня. Исполняет их `job.server.ts` (ежедневный крон биллинга),
 * настройки — ROOT → CRM → «Автоворонка».
 *
 *   Пробный, за 4 рабочих дня — письмо с тем, что изменится у этого
 *   аккаунта, подобранным тарифом и счётом; живому аккаунту — задача
 *   менеджеру «связаться», от 100 человек — сначала согласование скидки.
 *   Не начали вести журналы — письмо «продлим пробный» без счёта.
 *   Пробный, за 2 рабочих дня — повтор письма и задача «срочно».
 *   Пробный закончился без оплаты — задача «узнать причину».
 *   Отсрочка кончается через 2 рабочих дня — «последний шанс»: письмо
 *   со счётом и срочная задача.
 *   Годовой тариф — за 30 дней письмо «оплатите заранее» со счётом.
 *   Платный по счёту — счёт на продление за 10 рабочих дней.
 *   Оплата просрочена — задача «позвонить в бухгалтерию».
 *   Через 30 дней на бесплатном, а журналы ведут — задача «вернуть».
 *
 * Стоп-правила: оплатили — всё закрывается (`closeLifecycleTasksOnPayment`);
 * одно событие — одно письмо и одна задача (ключ `dedupeKey`).
 */

import { workdaysLeft } from "./calendar";

export type DiscountBand = { minSeats: number; percent: number };

export type LifecycleSettings = {
  enabled: boolean;
  /** Менеджер по умолчанию (Алексей); у клиента с закреплённым менеджером — он. */
  assigneeId: string | null;
  /** Кто согласует особую скидку; нет — РОП, затем владелец платформы. */
  approverId: string | null;
  /** От скольких сотрудников скидка — только после согласования. */
  approvalSeats: number;
  /** Скидка КП по числу сотрудников (по возрастанию порога). */
  discounts: DiscountBand[];
  /** За сколько рабочих дней до конца пробного — первое и второе касание. */
  trialFirstWorkdays: number;
  trialSecondWorkdays: number;
  /** Счёт к письму пробного: на месяц или сразу на год. */
  invoiceCycle: "month" | "year";
  /** «Последний шанс» — за столько рабочих дней до конца отсрочки. */
  graceLastWorkdays: number;
  /** Годовым — письмо «оплатите заранее» за столько календарных дней. */
  renewalEarlyDays: number;
  /** Счёт на продление тем, кто платит по счёту, — за столько рабочих дней. */
  invoiceAheadWorkdays: number;
  /** «Вернуть»: через столько дней на бесплатном, если журналы ведут. */
  winbackDays: number;
};

export const LIFECYCLE_SETTING_KEY = "crm.lifecycle";

/**
 * Запуск сценария. События раньше — не наши: у ~150 старых аккаунтов пробный
 * кончился одной датой при выкладке тарифов, и «узнать причину» по каждому
 * завалило бы менеджера задачами о давно решённом.
 */
export const LIFECYCLE_LAUNCHED_AT = new Date("2026-11-09T00:00:00+03:00");

/**
 * Скидки по умолчанию: команде до 10 человек — без скидки (выгода — оплата
 * за год), от 10 — 10 %, от 30 — 15 %, от 100 — 20 % после согласования.
 */
export const DEFAULT_DISCOUNTS: readonly DiscountBand[] = [
  { minSeats: 10, percent: 10 },
  { minSeats: 30, percent: 15 },
  { minSeats: 100, percent: 20 },
];

export const DEFAULT_LIFECYCLE_SETTINGS: LifecycleSettings = {
  enabled: true,
  assigneeId: null,
  approverId: null,
  approvalSeats: 100,
  discounts: DEFAULT_DISCOUNTS.map((band) => ({ ...band })),
  trialFirstWorkdays: 4,
  trialSecondWorkdays: 2,
  invoiceCycle: "month",
  graceLastWorkdays: 2,
  renewalEarlyDays: 30,
  invoiceAheadWorkdays: 10,
  winbackDays: 30,
};

function int(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
}

function id(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function normalizeLifecycleSettings(raw: unknown): LifecycleSettings {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const d = DEFAULT_LIFECYCLE_SETTINGS;
  const bands = Array.isArray(r.discounts)
    ? r.discounts
        .map((band) => {
          const b = band && typeof band === "object" ? (band as Record<string, unknown>) : {};
          return { minSeats: int(b.minSeats, 1, 100000, 0), percent: int(b.percent, 0, 90, -1) };
        })
        .filter((band) => band.minSeats > 0 && band.percent >= 0)
        .sort((a, b) => a.minSeats - b.minSeats)
    : d.discounts;
  const first = int(r.trialFirstWorkdays, 2, 15, d.trialFirstWorkdays);
  return {
    enabled: typeof r.enabled === "boolean" ? r.enabled : d.enabled,
    assigneeId: id(r.assigneeId),
    approverId: id(r.approverId),
    approvalSeats: int(r.approvalSeats, 2, 100000, d.approvalSeats),
    discounts: bands.length ? bands : d.discounts,
    trialFirstWorkdays: first,
    trialSecondWorkdays: Math.min(first - 1, int(r.trialSecondWorkdays, 1, 10, d.trialSecondWorkdays)),
    invoiceCycle: r.invoiceCycle === "year" ? "year" : "month",
    graceLastWorkdays: int(r.graceLastWorkdays, 1, 5, d.graceLastWorkdays),
    renewalEarlyDays: int(r.renewalEarlyDays, 10, 60, d.renewalEarlyDays),
    invoiceAheadWorkdays: int(r.invoiceAheadWorkdays, 3, 30, d.invoiceAheadWorkdays),
    winbackDays: int(r.winbackDays, 7, 90, d.winbackDays),
  };
}

/** Скидка для КП по числу сотрудников: последняя полоса, порог которой пройден. */
export function suggestedDiscount(seats: number, bands: readonly DiscountBand[]): number {
  let percent = 0;
  for (const band of bands) if (seats >= band.minSeats) percent = band.percent;
  return percent;
}

export type LifecycleFacts = {
  /** Ключ единицы биллинга (аккаунт или организация). */
  key: string;
  kind: "exempt" | "paid" | "legacy" | "free_period" | "free" | "needs_decision";
  reason: "trial_ended" | "subscription_expired" | null;
  trialEndsAt: Date | null;
  /** До какого числа оплачено (у оплаченных). */
  paidUntil: Date | null;
  /** Последний срок оплаты по аккаунту (и после того, как он прошёл). */
  subscriptionEnd: Date | null;
  /** Конец отсрочки после пробного или оплаты (у тех, кому нужно решение). */
  graceEndsAt?: Date | null;
  /** Период оплаченного тарифа. */
  planCycle?: "month" | "year" | null;
  /**
   * Автопродление с баланса покроет продление (включено и денег хватает) —
   * напоминать «оплатите» не нужно. Просто включённое (так по умолчанию) — не в счёт.
   */
  autoRenew?: boolean;
  seats: number;
  /** Записи в журналах за последние 7 дней. */
  recentEntries: number;
  /** Записи в журналах за всё время (сколько-нибудь — значит, начали). */
  totalEntries?: number;
  /** Прошлую оплату провели по счёту. */
  paysByInvoice: boolean;
  /** Неоплаченный счёт уже есть (и тот, что выставил сценарий). */
  pendingInvoice: boolean;
  /** Клиент заблокирован, на паузе или отменён. */
  inactive: boolean;
};

export type LifecycleStage =
  | "trial_first"
  | "trial_second"
  | "trial_lost"
  | "grace_last"
  | "renewal_early"
  | "invoice_ahead"
  | "payment_overdue"
  | "winback";

export const LIFECYCLE_STAGE_LABELS: Record<LifecycleStage, string> = {
  trial_first: "Пробный: первое касание",
  trial_second: "Пробный: второе касание",
  trial_lost: "Пробный закончился без оплаты",
  grace_last: "Последний день отсрочки",
  renewal_early: "Годовой: оплатить заранее",
  invoice_ahead: "Счёт на продление",
  payment_overdue: "Оплата просрочена",
  winback: "Вернуть на платный",
};

/** Какое письмо уйдёт клиенту. */
export type LifecycleEmail = "trial" | "trial_idle" | "grace_last" | "renewal_early";

export type LifecycleTaskKind = "call" | "payment_overdue" | "lost_reason" | "last_chance" | "winback";

export type LifecyclePlan = {
  stage: LifecycleStage;
  /** Ключ события: один на срок и ступень. */
  key: string;
  /** Письмо клиенту; null — без письма. */
  email: LifecycleEmail | null;
  /** Выставить счёт (к письму или отдельной доставкой). */
  invoice: boolean;
  /** Задача менеджеру. */
  task: null | { kind: LifecycleTaskKind; urgent: boolean; discountPercent: number | null; needsApproval: boolean };
  workdaysLeft: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * «Живой» аккаунт — за неделю есть записи в журналах. Число сотрудников
 * само по себе ничего не значит: 30 приглашённых, которые ничего не
 * заполняют, — не повод звонить, один повар, который ведёт журналы, — повод.
 */
export function isActiveAccount(facts: Pick<LifecycleFacts, "recentEntries">): boolean {
  return facts.recentEntries > 0;
}

/** Ни одной записи за всё время — журналы не начали вести. */
export function neverStarted(facts: Pick<LifecycleFacts, "totalEntries" | "recentEntries">): boolean {
  return (facts.totalEntries ?? facts.recentEntries) <= 0;
}

/** Что сделать сегодня по единице биллинга; null — ничего. */
export function planLifecycle(facts: LifecycleFacts, settings: LifecycleSettings, now: Date): LifecyclePlan | null {
  if (!settings.enabled || facts.inactive || facts.kind === "exempt" || facts.kind === "legacy") return null;
  const active = isActiveAccount(facts);
  const discount = suggestedDiscount(facts.seats, settings.discounts);
  const needsApproval = facts.seats >= settings.approvalSeats && discount > 0;

  if (facts.kind === "free_period" && facts.trialEndsAt) {
    const left = workdaysLeft(now, facts.trialEndsAt);
    if (left <= 0 || left > settings.trialFirstWorkdays) return null;
    const second = left <= settings.trialSecondWorkdays;
    const stage: LifecycleStage = second ? "trial_second" : "trial_first";
    const idle = neverStarted(facts);
    return {
      stage,
      key: `lc:${facts.key}:trial:${facts.trialEndsAt.toISOString()}:${stage}`,
      // Не начали — счёт не к месту: предлагаем помочь и продлить пробный.
      email: idle ? "trial_idle" : "trial",
      invoice: !idle,
      task: active ? { kind: "call", urgent: second, discountPercent: discount || null, needsApproval } : null,
      workdaysLeft: left,
    };
  }

  // Отсрочка кончается — последний шанс сохранить команду и журналы.
  if (facts.kind === "needs_decision" && facts.graceEndsAt && facts.graceEndsAt >= LIFECYCLE_LAUNCHED_AT) {
    const left = workdaysLeft(now, facts.graceEndsAt);
    if (left > 0 && left <= settings.graceLastWorkdays) {
      const paidBefore = facts.reason === "subscription_expired";
      return {
        stage: "grace_last",
        key: `lc:${facts.key}:grace:${facts.graceEndsAt.toISOString()}:last`,
        email: "grace_last",
        invoice: true,
        // Платил раньше — звоним всегда; после пробного — только живым.
        task: paidBefore || active ? { kind: "last_chance", urgent: true, discountPercent: paidBefore ? null : discount || null, needsApproval: false } : null,
        workdaysLeft: left,
      };
    }
  }

  // Пробный кончился без оплаты (3 дня после конца) — узнать причину у живых.
  if ((facts.kind === "needs_decision" || facts.kind === "free") && facts.reason !== "subscription_expired" && facts.trialEndsAt) {
    const since = now.getTime() - facts.trialEndsAt.getTime();
    if (since >= 0 && since <= 3 * DAY_MS && active && facts.trialEndsAt >= LIFECYCLE_LAUNCHED_AT) {
      return {
        stage: "trial_lost",
        key: `lc:${facts.key}:trial:${facts.trialEndsAt.toISOString()}:lost`,
        email: null,
        invoice: false,
        task: { kind: "lost_reason", urgent: false, discountPercent: discount || null, needsApproval: false },
        workdaysLeft: 0,
      };
    }
  }

  // Оплата просрочена: срок прошёл, новой оплаты нет (14 дней после срока).
  if (facts.kind === "needs_decision" && facts.reason === "subscription_expired" && facts.subscriptionEnd) {
    const since = now.getTime() - facts.subscriptionEnd.getTime();
    if (since >= 0 && since <= 14 * DAY_MS && facts.subscriptionEnd >= LIFECYCLE_LAUNCHED_AT) {
      return {
        stage: "payment_overdue",
        key: `lc:${facts.key}:paid:${facts.subscriptionEnd.toISOString()}:overdue`,
        email: null,
        invoice: false,
        task: { kind: "payment_overdue", urgent: true, discountPercent: null, needsApproval: false },
        workdaysLeft: 0,
      };
    }
  }

  // Ушли на бесплатный, но журналы ведут — через месяц предложить вернуться.
  if (facts.kind === "free" && active) {
    const end = facts.reason === "subscription_expired" ? facts.subscriptionEnd : facts.trialEndsAt;
    if (end && end >= LIFECYCLE_LAUNCHED_AT) {
      const since = now.getTime() - end.getTime();
      if (since >= settings.winbackDays * DAY_MS && since < (settings.winbackDays + 3) * DAY_MS) {
        return {
          stage: "winback",
          key: `lc:${facts.key}:free:${end.toISOString()}:winback`,
          email: null,
          invoice: false,
          task: { kind: "winback", urgent: false, discountPercent: discount || null, needsApproval: false },
          workdaysLeft: 0,
        };
      }
    }
  }

  if (facts.kind === "paid" && facts.paidUntil && !facts.pendingInvoice) {
    // Годовой: за месяц — «оплатите заранее» со счётом (через бухгалтерию
    // годовой платёж идёт долго). Дальше напоминает биллинг (7, 3, 1 день).
    if (facts.planCycle === "year" && !facts.autoRenew) {
      const days = Math.ceil((facts.paidUntil.getTime() - now.getTime()) / DAY_MS);
      if (days > 7 && days <= settings.renewalEarlyDays) {
        return {
          stage: "renewal_early",
          key: `lc:${facts.key}:paid:${facts.paidUntil.toISOString()}:early`,
          email: "renewal_early",
          invoice: true,
          task: null,
          workdaysLeft: workdaysLeft(now, facts.paidUntil),
        };
      }
    }
    // Платит по счёту — счёт на продление заранее, чтобы прошёл через бухгалтерию.
    if (facts.paysByInvoice) {
      const left = workdaysLeft(now, facts.paidUntil);
      if (left > 0 && left <= settings.invoiceAheadWorkdays) {
        return {
          stage: "invoice_ahead",
          key: `lc:${facts.key}:paid:${facts.paidUntil.toISOString()}:invoice`,
          email: null,
          invoice: true,
          task: null,
          workdaysLeft: left,
        };
      }
    }
  }
  return null;
}

/** Ключ задачи этой ступени (у письма — сам `plan.key`). */
export function taskKey(plan: Pick<LifecyclePlan, "key">): string {
  return `${plan.key}:task`;
}
