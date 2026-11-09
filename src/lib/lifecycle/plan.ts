/**
 * Сценарий «пробный и оплата» (2026-11-09) — чистые решения без БД: что
 * отправить клиенту и какую задачу поставить менеджеру сегодня. Исполняет
 * их `job.server.ts` (ежедневный крон биллинга), настройки — ROOT → CRM →
 * «Задачи».
 *
 *   Пробный, за 4 рабочих дня — письмо с тем, что изменится у этого
 *   аккаунта, подобранным тарифом и счётом; живому аккаунту — задача
 *   менеджеру «связаться», от 100 человек — сначала согласование скидки.
 *   Пробный, за 2 рабочих дня — повтор письма и задача «срочно».
 *   Пробный закончился без оплаты — задача «узнать причину».
 *   Платный по счёту — счёт на продление за 10 рабочих дней.
 *   Оплата просрочена — задача «позвонить в бухгалтерию».
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
  /** Счёт на продление тем, кто платит по счёту, — за столько рабочих дней. */
  invoiceAheadWorkdays: number;
  /** «Живой» аккаунт: столько сотрудников или записи в журналах за неделю. */
  activeMinUsers: number;
};

export const LIFECYCLE_SETTING_KEY = "crm.lifecycle";

/**
 * Запуск сценария. События раньше — не наши: у ~150 старых аккаунтов пробный
 * кончился одной датой при выкладке тарифов, и «узнать причину» по каждому
 * завалило бы менеджера задачами о давно решённом.
 */
export const LIFECYCLE_LAUNCHED_AT = new Date("2026-11-09T00:00:00+03:00");

export const DEFAULT_LIFECYCLE_SETTINGS: LifecycleSettings = {
  enabled: true,
  assigneeId: null,
  approverId: null,
  approvalSeats: 100,
  discounts: [
    { minSeats: 1, percent: 10 },
    { minSeats: 25, percent: 15 },
    { minSeats: 100, percent: 20 },
  ],
  trialFirstWorkdays: 4,
  trialSecondWorkdays: 2,
  invoiceAheadWorkdays: 10,
  activeMinUsers: 2,
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
    invoiceAheadWorkdays: int(r.invoiceAheadWorkdays, 3, 30, d.invoiceAheadWorkdays),
    activeMinUsers: int(r.activeMinUsers, 1, 1000, d.activeMinUsers),
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
  seats: number;
  /** Записи в журналах за последние 7 дней. */
  recentEntries: number;
  /** Прошлую оплату провели по счёту. */
  paysByInvoice: boolean;
  /** Неоплаченный счёт уже есть. */
  pendingInvoice: boolean;
  /** Клиент заблокирован, на паузе или отменён. */
  inactive: boolean;
};

export type LifecycleStage = "trial_first" | "trial_second" | "trial_lost" | "invoice_ahead" | "payment_overdue";

export type LifecyclePlan = {
  stage: LifecycleStage;
  /** Ключ события: один на срок и ступень. */
  key: string;
  /** Письмо клиенту (на ступенях пробного). */
  email: boolean;
  /** Выставить счёт на продление. */
  invoice: boolean;
  /** Задача менеджеру. */
  task: null | { kind: "call" | "payment_overdue" | "lost_reason"; urgent: boolean; discountPercent: number | null; needsApproval: boolean };
  workdaysLeft: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;

export function isActiveAccount(facts: Pick<LifecycleFacts, "seats" | "recentEntries">, settings: LifecycleSettings): boolean {
  return facts.seats >= settings.activeMinUsers || facts.recentEntries > 0;
}

/** Что сделать сегодня по единице биллинга; null — ничего. */
export function planLifecycle(facts: LifecycleFacts, settings: LifecycleSettings, now: Date): LifecyclePlan | null {
  if (!settings.enabled || facts.inactive || facts.kind === "exempt" || facts.kind === "legacy") return null;
  const active = isActiveAccount(facts, settings);
  const discount = suggestedDiscount(facts.seats, settings.discounts);
  const needsApproval = facts.seats >= settings.approvalSeats;

  if (facts.kind === "free_period" && facts.trialEndsAt) {
    const left = workdaysLeft(now, facts.trialEndsAt);
    if (left <= 0 || left > settings.trialFirstWorkdays) return null;
    const second = left <= settings.trialSecondWorkdays;
    const stage: LifecycleStage = second ? "trial_second" : "trial_first";
    return {
      stage,
      key: `lc:${facts.key}:trial:${facts.trialEndsAt.toISOString()}:${stage}`,
      email: true,
      invoice: true,
      task: active ? { kind: "call", urgent: second, discountPercent: discount || null, needsApproval } : null,
      workdaysLeft: left,
    };
  }

  // Пробный кончился без оплаты (3 дня после конца) — узнать причину у живых.
  if ((facts.kind === "needs_decision" || facts.kind === "free") && facts.reason !== "subscription_expired" && facts.trialEndsAt) {
    const since = now.getTime() - facts.trialEndsAt.getTime();
    if (since < 0 || since > 3 * DAY_MS || !active || facts.trialEndsAt < LIFECYCLE_LAUNCHED_AT) return null;
    return {
      stage: "trial_lost",
      key: `lc:${facts.key}:trial:${facts.trialEndsAt.toISOString()}:lost`,
      email: false,
      invoice: false,
      task: { kind: "lost_reason", urgent: false, discountPercent: discount || null, needsApproval: false },
      workdaysLeft: 0,
    };
  }

  // Оплата просрочена: срок прошёл, новой оплаты нет (14 дней после срока).
  if (facts.kind === "needs_decision" && facts.reason === "subscription_expired" && facts.subscriptionEnd) {
    const since = now.getTime() - facts.subscriptionEnd.getTime();
    if (since < 0 || since > 14 * DAY_MS || facts.subscriptionEnd < LIFECYCLE_LAUNCHED_AT) return null;
    return {
      stage: "payment_overdue",
      key: `lc:${facts.key}:paid:${facts.subscriptionEnd.toISOString()}:overdue`,
      email: false,
      invoice: false,
      task: { kind: "payment_overdue", urgent: true, discountPercent: null, needsApproval: false },
      workdaysLeft: 0,
    };
  }

  // Платит по счёту — счёт на продление заранее, чтобы прошёл через бухгалтерию.
  if (facts.kind === "paid" && facts.paidUntil && facts.paysByInvoice && !facts.pendingInvoice) {
    const left = workdaysLeft(now, facts.paidUntil);
    if (left <= 0 || left > settings.invoiceAheadWorkdays) return null;
    return {
      stage: "invoice_ahead",
      key: `lc:${facts.key}:paid:${facts.paidUntil.toISOString()}:invoice`,
      email: false,
      invoice: true,
      task: null,
      workdaysLeft: left,
    };
  }
  return null;
}

/** Ключ задачи этой ступени (у письма — сам `plan.key`). */
export function taskKey(plan: Pick<LifecyclePlan, "key">): string {
  return `${plan.key}:task`;
}
