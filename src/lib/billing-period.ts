import { FREE_MAX_USERS, isFreePlan, isInactivePlan } from "@/lib/plan-limits";
import { employeesGenitiveLabel, employeesLabel } from "@/lib/plan-catalog";
import {
  FREE_MAX_JOURNALS,
  SEATS_PER_POINT,
  TRIAL_DAYS,
  entitlementsFor,
  isBillingCycle,
  normalizePoints,
  paidTierFromPlan,
  seatUpgradeTarget,
  withoutFeatures,
  type BillingCycle,
  type EntitlementTier,
  type Entitlements,
  type PaidTier,
  type PlanFeature,
} from "@/lib/tariff-plans";
import type { PriceWithPromotion } from "@/lib/promo/promotions";

/**
 * Состояние тарифа аккаунта и честный переход на оплату (тарифы 2026-10,
 * spec `.agent/tasks/tariffs-v3-2026-10/spec.md`). Чистые функции без `db`:
 * их читают серверные guard'ы, клиентские окна и тесты.
 *
 * Модель:
 *   • 14 дней с создания аккаунта — пробный период (`free_period`): всё
 *     открыто, лимитов нет, карта не нужна. Аккаунтам, созданным до запуска
 *     новых тарифов, пробный считается от даты запуска (`launchedAt`);
 *     ROOT может продлить пробный конкретному аккаунту (`trialEndsAt`);
 *   • оплачено (`subscriptionEnd` в будущем) — `paid`: Стандарт, Премиум или
 *     прежняя «Подписка» (до конца срока как раньше);
 *   • после пробного без оплаты — бесплатный тариф: 1 сотрудник и 1 журнал.
 *     Больше — «нужно решение» до конца грейса, потом автопереход (остаётся
 *     владелец и самый заполняемый журнал, остальное — в архив/выключено).
 *
 * Маркера «решение принято» нет намеренно: после перехода на бесплатный
 * активных ≤ 1 и журналов ≤ 1 — состояние `free`, после оплаты — `paid`.
 * Состояние всегда выводится из данных и не может «застрять».
 */

/** Ключ `PlatformSetting` с настройками пробного периода (JSON). */
export const TRIAL_SETTING_KEY = "billing.trial";
/** Прежние настройки «бесплатного периода для всех» — источник грейса и флага при первом чтении. */
export const LEGACY_FREE_PERIOD_SETTING_KEY = "billing.free-period";

export type TrialSettings = {
  /** Сколько дней длится пробный период. */
  trialDays: number;
  /** Запуск тарифов 2026-10: аккаунтам старше пробный считается от этой даты. */
  launchedAt: Date;
  /** Сколько дней после конца пробного даётся на решение до автоперехода. */
  graceDays: number;
  /** «Переход на оплату включён»: выключен — после пробного ничего не блокируем. */
  transitionEnabled: boolean;
};

/** Москва без перехода на летнее время с 2014 года — фиксированный сдвиг. */
const MSK_OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export const GRACE_DAYS_MIN = 0;
export const GRACE_DAYS_MAX = 60;
/** За сколько дней до конца пробного напоминаем владельцу. */
export const TRIAL_REMINDER_DAYS = 3;

export const DEFAULT_TRIAL_SETTINGS: TrialSettings = {
  trialDays: TRIAL_DAYS,
  // 2026-10-26 00:00 МСК — запасная дата; при первом чтении после деплоя
  // сервер записывает фактический момент запуска.
  launchedAt: new Date("2026-10-25T21:00:00.000Z"),
  graceDays: 7,
  transitionEnabled: true,
};

function parseDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null;
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function intInRange(value: unknown, min: number, max: number): number | null {
  const n = Number(value);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}

/**
 * Настройки из `PlatformSetting` → значения с дефолтами. Битое поле
 * заменяется дефолтом, а не ломает весь кабинет: состояние тарифа читается
 * на каждой странице.
 */
export function normalizeTrialSettings(raw: unknown): TrialSettings {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    // Длина пробного — та, что обещают витрина, письма и SEO-страницы
    // (`TRIAL_DAYS`); сохранённое число не читаем, чтобы срок и тексты не
    // разошлись. Отдельному аккаунту ROOT продлевает его `Account.trialEndsAt`.
    trialDays: TRIAL_DAYS,
    launchedAt: parseDate(r.launchedAt) ?? DEFAULT_TRIAL_SETTINGS.launchedAt,
    graceDays: intInRange(r.graceDays, GRACE_DAYS_MIN, GRACE_DAYS_MAX) ?? DEFAULT_TRIAL_SETTINGS.graceDays,
    transitionEnabled:
      typeof r.transitionEnabled === "boolean" ? r.transitionEnabled : DEFAULT_TRIAL_SETTINGS.transitionEnabled,
  };
}

export function serializeTrialSettings(settings: TrialSettings): string {
  return JSON.stringify({
    trialDays: settings.trialDays,
    launchedAt: settings.launchedAt.toISOString(),
    graceDays: settings.graceDays,
    transitionEnabled: settings.transitionEnabled,
  });
}

export type TrialSettingsInput = {
  launchedAt: unknown;
  graceDays: unknown;
  transitionEnabled: unknown;
};

/** Проверка формы ROOT: в отличие от normalize, ошибки не прячем. */
export function validateTrialInput(
  input: TrialSettingsInput
): { ok: true; value: TrialSettings } | { ok: false; error: string } {
  const launchedAt = parseDate(input.launchedAt);
  if (!launchedAt) return { ok: false, error: "Укажите дату запуска тарифов" };
  const graceDays = intInRange(input.graceDays, GRACE_DAYS_MIN, GRACE_DAYS_MAX);
  if (graceDays === null) {
    return { ok: false, error: `Грейс — целое число дней от ${GRACE_DAYS_MIN} до ${GRACE_DAYS_MAX}` };
  }
  if (typeof input.transitionEnabled !== "boolean") {
    return { ok: false, error: "Не указано, включён ли переход на оплату" };
  }
  return { ok: true, value: { trialDays: TRIAL_DAYS, launchedAt, graceDays, transitionEnabled: input.transitionEnabled } };
}

/**
 * Конец пробного периода: ROOT продлил — его дата; иначе 14 дней от
 * создания аккаунта, но не раньше запуска новых тарифов.
 */
export function trialEndFor(
  createdAt: Date,
  settings: TrialSettings,
  override?: Date | null
): Date {
  if (override && Number.isFinite(override.getTime())) return override;
  const start = Math.max(createdAt.getTime(), settings.launchedAt.getTime());
  return new Date(start + settings.trialDays * DAY_MS);
}

/**
 * Реально оплачено: срок подписки в будущем (оплата картой, счёт или
 * ROOT). Тариф с пустым сроком — тестовый автоперевод прошлых лет, не
 * оплата. Приостановленная организация не считается оплаченной.
 */
export function isReallyPaid(
  plan: string | null | undefined,
  subscriptionEnd: Date | null | undefined,
  now: Date
): boolean {
  if (isInactivePlan(plan)) return false;
  return Boolean(subscriptionEnd && subscriptionEnd.getTime() > now.getTime());
}

export type AccountBillingKind =
  /** Платформа, демо, мастер-кабинет — тарифа нет. */
  | "exempt"
  /** Реально оплачено (Стандарт, Премиум или прежняя «Подписка»). */
  | "paid"
  /** Переход на оплату выключен в ROOT — после пробного ничего не блокируем. */
  | "legacy"
  /** Пробный период: 14 дней без ограничений. */
  | "free_period"
  /** После пробного: бесплатный тариф, в пределах 1 сотрудника и 1 журнала. */
  | "free"
  /** После пробного: не оплачено и больше 1 сотрудника или журнала — нужно решение. */
  | "needs_decision";

export type TransitionReason = "trial_ended" | "subscription_expired";

export type AccountBillingInput = {
  /** Тариф аккаунта (или legacy-зеркало организации). */
  plan: string | null | undefined;
  /** Самый поздний срок подписки по аккаунту и его организациям. */
  subscriptionEnd: Date | null;
  /** Период оплаченного тарифа: month | year (нет — month). */
  planCycle?: string | null;
  /** Оплачено точек (нет — 1). */
  planPoints?: number | null;
  /** Создание аккаунта (организации без аккаунта) — начало пробного. */
  createdAt?: Date | null;
  /** Пробный до — ROOT продлил. */
  trialEndsAt?: Date | null;
  /** Активные сотрудники аккаунта (без архива, комиссии, ROOT). */
  activeUsers: number;
  /** Включённых журналов — наибольшее по организациям аккаунта. */
  enabledJournals?: number;
  /** Точек в работе (`countPointsInUse`). */
  pointsInUse?: number;
  /** Платформа / демо / мастер-кабинет. */
  exempt?: boolean;
  /** Организация на паузе или отменена. */
  inactive?: boolean;
};

export type AccountBillingState = {
  kind: AccountBillingKind;
  /** Что действует: пробный, бесплатный, стандарт, премиум, прежняя подписка… */
  tier: EntitlementTier;
  entitlements: Entitlements;
  /** Пробный закончился, переход включён — лимиты бесплатного действуют. */
  enforcement: boolean;
  inactive: boolean;
  activeUsers: number;
  enabledJournals: number;
  pointsInUse: number;
  /** До какого числа реально оплачено; null — не оплачено. */
  paidUntil: Date | null;
  /** Оплаченный тариф; null — не оплачено. */
  paidTier: PaidTier | "legacy" | null;
  planCycle: BillingCycle;
  planPoints: number;
  /** Конец пробного периода (null — у тех, у кого тарифа нет). */
  trialEndsAt: Date | null;
  /** Сколько дней пробного осталось (только в пробном). */
  trialDaysLeft: number | null;
  /** Почему нужно решение (для заголовка окна и уведомлений). */
  reason: TransitionReason | null;
  /** До какого момента руководитель решает сам. */
  graceEndsAt: Date | null;
  graceExpired: boolean;
  /** Сколько активных можно держать; null — без блокировки. */
  seatLimit: number | null;
  /** Автоввод показаний с фото (прежнее «платные возможности»). */
  paidFeatures: boolean;
};

/** Оставшиеся дни (округление вверх): «осталось 3 дня» до конца суток последнего дня. */
export function daysLeft(until: Date, now: Date): number {
  return Math.max(0, Math.ceil((until.getTime() - now.getTime()) / DAY_MS));
}

export function computeAccountBilling(
  input: AccountBillingInput,
  settings: TrialSettings,
  now: Date
): AccountBillingState {
  const inactive = input.inactive === true || isInactivePlan(input.plan);
  const activeUsers = Number.isFinite(input.activeUsers) ? Math.max(0, Math.floor(input.activeUsers)) : 0;
  const enabledJournals = Math.max(0, Math.floor(Number(input.enabledJournals) || 0));
  const pointsInUse = Math.max(1, Math.floor(Number(input.pointsInUse) || 1));
  const planCycle: BillingCycle = isBillingCycle(input.planCycle) ? input.planCycle : "month";
  const planPoints = normalizePoints(input.planPoints ?? 1);
  const trialEndsAt = input.createdAt
    ? trialEndFor(input.createdAt, settings, input.trialEndsAt)
    : (input.trialEndsAt ?? null);

  const make = (
    kind: AccountBillingKind,
    tier: EntitlementTier,
    extra: Partial<AccountBillingState> = {}
  ): AccountBillingState => {
    const base = entitlementsFor(tier, planPoints);
    const entitlements = inactive ? withoutFeatures(base) : base;
    return {
      kind,
      tier,
      entitlements,
      enforcement: false,
      inactive,
      activeUsers,
      enabledJournals,
      pointsInUse,
      paidUntil: null,
      paidTier: null,
      planCycle,
      planPoints,
      trialEndsAt: kind === "exempt" ? null : trialEndsAt,
      trialDaysLeft: null,
      reason: null,
      graceEndsAt: null,
      graceExpired: false,
      seatLimit: entitlements.seatLimit,
      paidFeatures: entitlements.features.photoAutofill,
      ...extra,
    };
  };

  if (input.exempt) return make("exempt", "exempt");

  if (isReallyPaid(input.plan, input.subscriptionEnd, now)) {
    // Оплаченная, но приостановленная за неактивность организация остаётся
    // оплаченной (лимиты тарифа, отказ «оплатите» был бы неправдой), а
    // платные возможности на паузе выключены — как и раньше.
    const paidTier = paidTierFromPlan(input.plan);
    return make("paid", paidTier === "legacy" ? "legacy_paid" : paidTier, {
      paidUntil: input.subscriptionEnd,
      paidTier,
    });
  }

  if (trialEndsAt && now.getTime() < trialEndsAt.getTime()) {
    return make("free_period", "trial", { trialDaysLeft: daysLeft(trialEndsAt, now) });
  }

  if (!settings.transitionEnabled) return make("legacy", "unrestricted");

  // Оплаченный срок кончился ПОСЛЕ пробного — честно пишем «подписка
  // закончилась». Кончился раньше (или оплаты не было) — последним
  // закончился пробный период, про него и говорим.
  const end = input.subscriptionEnd;
  const trialEnd = trialEndsAt ?? now;
  const expiredPaid = end !== null && end.getTime() > trialEnd.getTime();
  const reason: TransitionReason = expiredPaid ? "subscription_expired" : "trial_ended";
  const graceBase = expiredPaid && end ? end : trialEnd;
  const graceEndsAt = new Date(graceBase.getTime() + settings.graceDays * DAY_MS);

  if (activeUsers <= FREE_MAX_USERS && enabledJournals <= FREE_MAX_JOURNALS) {
    return make("free", "free", { enforcement: true, reason });
  }
  return make("needs_decision", "free", {
    enforcement: true,
    reason,
    graceEndsAt,
    graceExpired: now.getTime() >= graceEndsAt.getTime(),
  });
}

/** Есть ли у аккаунта возможность тарифа (Премиум, пробный…). */
export function hasFeature(state: Pick<AccountBillingState, "entitlements"> | null | undefined, feature: PlanFeature): boolean {
  return state?.entitlements.features[feature] === true;
}

/** Код ошибки лимита сотрудников: клиент по нему показывает кнопку «Оплатить». */
export const BILLING_LIMIT_CODE = "billing_free_limit";
/** Лимит точек, журналов, хранилища и закрытая возможность тарифа. */
export const POINT_LIMIT_CODE = "billing_point_limit";
export const JOURNAL_LIMIT_CODE = "billing_journal_limit";
export const STORAGE_LIMIT_CODE = "billing_storage_limit";
export const FEATURE_LOCKED_CODE = "billing_feature_locked";

/** Куда вести оплату из кабинета: там и карта, и счёт по безналу. */
export const BILLING_PAY_HREF = "/settings/subscription";

const TIER_TITLE: Record<PaidTier, string> = { standard: "«Стандарт»", premium: "«Премиум»" };

/** «Перейдите на «Премиум» — до 100 сотрудников на точку». */
function upgradeOffer(target: PaidTier): string {
  return `Перейдите на ${TIER_TITLE[target]} — до ${employeesGenitiveLabel(SEATS_PER_POINT[target])} на точку`;
}

/** У «Премиума» следующего тарифа нет: больше — по согласованию. */
const PREMIUM_MORE_SEATS =
  `Больше ${employeesGenitiveLabel(SEATS_PER_POINT.premium)} на точку — по согласованию: ` +
  "напишите нам в чат поддержки или на support@wesetup.ru";

/** Текст отказа руководителю на бесплатном тарифе. */
export const FREE_LIMIT_MESSAGE =
  `Бесплатный тариф — ${employeesLabel(FREE_MAX_USERS)}. ` +
  `${upgradeOffer("standard")}, чтобы добавить сотрудников или вернуть их из архива.`;

/** Текст отказа тому, кто принимает приглашение: платить не ему. */
export const FREE_LIMIT_INVITEE_MESSAGE =
  `На бесплатном тарифе организации — ${employeesLabel(FREE_MAX_USERS)}. ` +
  "Попросите руководителя подключить «Стандарт» и повторите.";

/**
 * Отказ по лимиту сотрудников оплаченного тарифа (25 или 100 на точку):
 * лимит и следующий тариф — не «добавьте точку» (spec tariffs-limits-ui Р2, Р3).
 */
export function paidSeatLimitMessage(tier: PaidTier): string {
  const head = `На тарифе ${TIER_TITLE[tier]} — до ${employeesGenitiveLabel(SEATS_PER_POINT[tier])} на точку, все места заняты.`;
  const target = seatUpgradeTarget(tier);
  return target
    ? `${head} ${upgradeOffer(target)}, или переведите лишних в архив.`
    : `${head} ${PREMIUM_MORE_SEATS}. Или переведите лишних в архив.`;
}

/** Отказ тому, кто принимает приглашение, на оплаченном тарифе: решает руководитель. */
export function paidSeatLimitInviteeMessage(tier: PaidTier): string {
  return seatUpgradeTarget(tier)
    ? `Все места тарифа организации заняты. Попросите руководителя перейти на ${TIER_TITLE.premium} и повторите.`
    : "Все места тарифа организации заняты. Попросите руководителя связаться с поддержкой WeSetup и повторите.";
}

/** Текст отказа по местам для состояния аккаунта. */
export function seatLimitMessage(state: Pick<AccountBillingState, "tier">, audience: "manager" | "invitee" = "manager"): string {
  if (state.tier === "standard" || state.tier === "premium") {
    return audience === "invitee" ? paidSeatLimitInviteeMessage(state.tier) : paidSeatLimitMessage(state.tier);
  }
  return audience === "invitee" ? FREE_LIMIT_INVITEE_MESSAGE : FREE_LIMIT_MESSAGE;
}

export type SeatCheck =
  | { ok: true }
  | {
      ok: false;
      limit: number;
      activeUsers: number;
      message: string;
      /** Тариф, на котором кончились места, и куда звать (null — по согласованию). */
      tier: EntitlementTier;
      nextTier: PaidTier | null;
    };

/**
 * Можно ли сделать активными ещё `adding` сотрудников. Проверяется ДО
 * создания или возврата из архива — на всех путях.
 */
export function checkSeats(state: AccountBillingState, adding: number): SeatCheck {
  if (!(adding > 0)) return { ok: true };
  if (state.seatLimit === null) return { ok: true };
  if (state.activeUsers + adding <= state.seatLimit) return { ok: true };
  return {
    ok: false,
    limit: state.seatLimit,
    activeUsers: state.activeUsers,
    message: seatLimitMessage(state),
    tier: state.tier,
    nextTier: seatUpgradeTarget(state.tier),
  };
}

export type LimitCheck = { ok: true } | { ok: false; limit: number; current: number; message: string };

/** Можно ли завести ещё `adding` точек (здание или организацию). */
export function checkPoints(state: AccountBillingState, adding: number): LimitCheck {
  const limit = state.entitlements.pointLimit;
  if (!(adding > 0) || limit === null) return { ok: true };
  if (state.pointsInUse + adding <= limit) return { ok: true };
  const message =
    state.tier === "standard" || state.tier === "premium"
      ? `Оплачено точек: ${limit}. Каждая новая точка — как ещё один тариф; от трёх точек — скидка 5 % на каждую. ` +
        "Добавьте точку на странице тарифа."
      : "На бесплатном тарифе — 1 точка. Подключите «Стандарт» или «Премиум», чтобы добавить точки.";
  return { ok: false, limit, current: state.pointsInUse, message };
}

/** Можно ли включить журналы так, чтобы их стало `nextEnabled`. Выключать можно всегда. */
export function checkJournals(state: AccountBillingState, nextEnabled: number, currentEnabled: number): LimitCheck {
  const limit = state.entitlements.journalLimit;
  if (limit === null || nextEnabled <= limit || nextEnabled <= currentEnabled) return { ok: true };
  return {
    ok: false,
    limit,
    current: currentEnabled,
    message:
      `На бесплатном тарифе — ${limit} журнал. Подключите «Стандарт» или «Премиум», чтобы вести все журналы.`,
  };
}

/** «9,2 МБ», «1 ГБ», «512 КБ». */
export function formatBytes(bytes: number): string {
  const n = Math.max(0, bytes);
  const fmt = (v: number) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: v < 10 ? 1 : 0 }).format(v);
  if (n >= 1024 * 1024 * 1024) return `${fmt(n / (1024 * 1024 * 1024))} ГБ`;
  if (n >= 1024 * 1024) return `${fmt(n / (1024 * 1024))} МБ`;
  // Пусто — «0 КБ», а не «1 КБ»: иначе пустое хранилище выглядит занятым.
  if (n === 0) return "0 КБ";
  return `${fmt(Math.max(1, Math.round(n / 1024)))} КБ`;
}

/**
 * Хватит ли места тарифа на файл. `replacingBytes` — размер файла, который
 * заменяется (документ ППК на своём месте).
 */
export function checkStorage(
  entitlements: Pick<Entitlements, "storageBytes" | "tier">,
  usedBytes: number,
  addingBytes: number,
  replacingBytes = 0
): LimitCheck {
  const limit = entitlements.storageBytes;
  if (limit === null) return { ok: true };
  const next = Math.max(0, usedBytes - Math.max(0, replacingBytes)) + Math.max(0, addingBytes);
  if (next <= limit) return { ok: true };
  if (limit === 0) {
    return {
      ok: false,
      limit,
      current: usedBytes,
      message: "Загрузка документов — на тарифах «Стандарт» (10 МБ) и «Премиум» (1 ГБ). Загруженные раньше файлы остаются доступны.",
    };
  }
  const tier = entitlements.tier === "standard" ? "«Стандарт»" : "тарифа";
  return {
    ok: false,
    limit,
    current: usedBytes,
    message:
      `Хранилище ${tier} — ${formatBytes(limit)}, занято ${formatBytes(usedBytes)}. ` +
      (entitlements.tier === "standard"
        ? "Удалите лишние файлы или перейдите на «Премиум» — 1 ГБ на все документы."
        : "Удалите лишние файлы."),
  };
}

/** Отказ закрытой возможности тарифа (для API и подсказок). */
export const FEATURE_LOCKED_MESSAGE: Record<PlanFeature, string> = {
  photoAutofill: "Автоввод показаний с фото датчика — в тарифе «Премиум».",
  equipmentConnect: "Подключение оборудования и IoT-датчиков — в тарифе «Премиум».",
  equipmentDelivery: "Доставка подключённого оборудования — в тарифе «Премиум».",
  typicalPackage: "Типовой пакет документов — в тарифе «Премиум».",
  mercury: "Интеграция с «Меркурием» (ВетИС) — в тарифе «Премиум».",
};

export type TransitionAction =
  /** Ничего не делать. */
  | "none"
  /** Пробный кончается через ≤ 3 дня — одно напоминание. */
  | "remind_trial_end"
  /** В пределах бесплатного, но тариф ещё записан платным — молча `free` + одно уведомление. */
  | "silent_free"
  /** Сверх бесплатного и грейс идёт — ждём решения руководителя (одно предупреждение). */
  | "await_decision"
  /** Сверх бесплатного и грейс истёк — автопереход: владелец и один журнал остаются. */
  | "auto_free";

/** Что ежедневная задача делает с аккаунтом. */
export function decideTransitionAction(
  state: AccountBillingState,
  plan: string | null | undefined
): TransitionAction {
  if (state.inactive) return "none";
  if (state.kind === "free_period") {
    return state.trialDaysLeft !== null && state.trialDaysLeft <= TRIAL_REMINDER_DAYS ? "remind_trial_end" : "none";
  }
  if (!state.enforcement) return "none";
  if (state.kind === "free") return isFreePlan(plan) ? "none" : "silent_free";
  if (state.kind === "needs_decision") return state.graceExpired ? "auto_free" : "await_decision";
  return "none";
}

export type KeeperCandidate = {
  id: string;
  /** Руководитель (может открыть тариф и оплатить). */
  isManagement: boolean;
  createdAt: Date;
};

/**
 * Кто остаётся при автопереходе: владелец аккаунта; если его нет среди
 * активных — самый давний руководитель; если руководителей нет — самый
 * давний сотрудник.
 */
export function pickKeeper(
  candidates: KeeperCandidate[],
  ownerUserId: string | null | undefined
): string | null {
  if (candidates.length === 0) return null;
  if (ownerUserId && candidates.some((c) => c.id === ownerUserId)) return ownerUserId;
  const byAge = [...candidates].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id)
  );
  return (byAge.find((c) => c.isManagement) ?? byAge[0]).id;
}

/** Журнал по умолчанию, если записей нет ни в одном: гигиенический. */
export const DEFAULT_KEPT_JOURNAL = "hygiene";

/**
 * Какой журнал остаётся при автопереходе: с наибольшим числом записей за
 * 30 дней; без записей — гигиенический, если включён; иначе первый
 * включённый по порядку.
 */
export function pickKeeperJournal(
  enabledCodes: readonly string[],
  usage: ReadonlyMap<string, number>
): string | null {
  if (enabledCodes.length === 0) return null;
  let best: string | null = null;
  let bestCount = 0;
  for (const code of enabledCodes) {
    const count = usage.get(code) ?? 0;
    if (count > bestCount) {
      best = code;
      bestCount = count;
    }
  }
  if (best) return best;
  return enabledCodes.includes(DEFAULT_KEPT_JOURNAL) ? DEFAULT_KEPT_JOURNAL : enabledCodes[0];
}

const MONTHS_GENITIVE = [
  "января",
  "февраля",
  "марта",
  "апреля",
  "мая",
  "июня",
  "июля",
  "августа",
  "сентября",
  "октября",
  "ноября",
  "декабря",
];

function mskParts(date: Date): { day: number; month: number; year: number } {
  const shifted = new Date(date.getTime() + MSK_OFFSET_MS);
  return {
    day: shifted.getUTCDate(),
    month: shifted.getUTCMonth(),
    year: shifted.getUTCFullYear(),
  };
}

/** «1 октября» по Москве. */
export function formatMskDay(date: Date): string {
  const { day, month } = mskParts(date);
  return `${day} ${MONTHS_GENITIVE[month]}`;
}

/** «13 мая 2027» — сроки оплаты, где год не очевиден (год вперёд, продление). */
export function formatMskDate(date: Date): string {
  const { day, month, year } = mskParts(date);
  return `${day} ${MONTHS_GENITIVE[month]} ${year}`;
}

/** «13 мая» в этом году, «13 мая 2027» — в другом (годовые сроки в кабинете). */
export function formatMskDayAuto(date: Date, now: Date = new Date()): string {
  return mskParts(date).year === mskParts(now).year ? formatMskDay(date) : formatMskDate(date);
}

/** Ключ дня по Москве «2026-10-01» — для «скрыть на сегодня». */
export function mskDayKey(date: Date): string {
  const { day, month, year } = mskParts(date);
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Последний день действия: конец не включительно. */
export function lastDayBefore(end: Date): Date {
  return new Date(end.getTime() - 1);
}

/** «1 990 ₽» — неразрывный пробел, как в `formatRub`. */
export function formatPriceRub(value: number): string {
  return `${new Intl.NumberFormat("ru-RU").format(value)} ₽`;
}

/** Цена подписки для окна: база, цена с акцией и сама акция. */
export type BillingPrice = Pick<PriceWithPromotion, "baseRub" | "priceRub" | "promotion">;

/** «1 990 ₽/мес» или «1 592 ₽/мес по акции (без акции 1 990 ₽)» — текстом, без зачёркивания. */
export function billingPriceText(price: BillingPrice): string {
  const promo = price.promotion && price.priceRub < price.baseRub;
  return promo
    ? `${formatPriceRub(price.priceRub)}/мес по акции (без акции ${formatPriceRub(price.baseRub)})`
    : `${formatPriceRub(price.priceRub)}/мес`;
}

function daysWord(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "день";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "дня";
  return "дней";
}

/** «3 дня», «14 дней». */
export function daysLabel(n: number): string {
  return `${n} ${daysWord(n)}`;
}

export type TrialBanner = {
  /** «Пробный период: осталось 5 дней — по 8 ноября включительно.» */
  lead: string;
  /** «Все возможности Премиума открыты. Выберите тариф, чтобы…» */
  tail: string;
  urgent: boolean;
};

/** Плашка пробного периода в кабинете. */
export function trialBannerText(state: Pick<AccountBillingState, "trialEndsAt" | "trialDaysLeft">): TrialBanner | null {
  if (!state.trialEndsAt || state.trialDaysLeft === null) return null;
  const left = state.trialDaysLeft;
  const lead = `Пробный период: осталось ${daysLabel(left)} — по ${formatMskDay(lastDayBefore(state.trialEndsAt))} включительно.`;
  const tail =
    "Все журналы и возможности «Премиума» открыты без ограничений. Выберите тариф, чтобы после пробного ничего не выключилось: " +
    "на бесплатном останутся 1 сотрудник и 1 журнал.";
  return { lead, tail, urgent: left <= TRIAL_REMINDER_DAYS };
}

/** Показывать ли плашку пробного периода. */
export function shouldShowTrialBanner(state: AccountBillingState): boolean {
  return state.kind === "free_period" && state.trialDaysLeft !== null;
}

export type TransitionCopy = {
  title: string;
  lead: string;
  graceLine: string | null;
  payTitle: string;
  payHint: string;
  freeTitle: string;
  freeHint: string;
};

/** «Стандарт — от 1 990 ₽/мес, Премиум — от 3 990 ₽/мес (при оплате за год)». */
export function paidPlansHint(prices: { standardFromRub: number; premiumFromRub: number }): string {
  return (
    `«Стандарт» — от ${formatPriceRub(prices.standardFromRub)}/мес, «Премиум» — от ${formatPriceRub(prices.premiumFromRub)}/мес ` +
    "при оплате за год. Все сотрудники и журналы остаются в работе."
  );
}

function journalsWord(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "журнал";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "журнала";
  return "журналов";
}

/** «1 журнал», «35 журналов». */
export function journalsLabel(n: number): string {
  return `${n} ${journalsWord(n)}`;
}

/**
 * Тексты окна после пробного. Правило честности: тем, кто не платил, НЕ
 * пишем «оплаченный тариф закончился» — пишем, что закончился пробный
 * период. «Подписка закончилась» — только если последним закончился
 * реально оплаченный срок.
 */
export function transitionCopy(args: {
  state: AccountBillingState;
  prices: { standardFromRub: number; premiumFromRub: number };
}): TransitionCopy {
  const { state } = args;
  const expired = state.reason === "subscription_expired";
  const title = expired ? "Подписка закончилась" : "Пробный период закончился";
  const now = `Сейчас в кабинете ${employeesLabel(state.activeUsers)} и ${journalsLabel(state.enabledJournals)}`;
  const freeLimits = `${employeesLabel(FREE_MAX_USERS)} и ${journalsLabel(FREE_MAX_JOURNALS)}`;
  const lead = expired
    ? `Оплаченный срок подписки закончился. ${now}, а на бесплатном тарифе — ${freeLimits}.`
    : `${daysLabel(TRIAL_DAYS)} всё было открыто бесплатно. ${now}, а на бесплатном тарифе — ${freeLimits}.`;
  const graceLine = state.graceEndsAt
    ? state.graceExpired
      ? "Срок выбора прошёл: скоро в работе останутся только владелец аккаунта и самый заполняемый журнал. Вернуть остальных можно после оплаты."
      : `Выберите до ${formatMskDay(lastDayBefore(state.graceEndsAt))} включительно. Если ничего не выбрать, в работе останутся владелец аккаунта и самый заполняемый журнал — остальное можно вернуть после оплаты.`
    : null;
  return {
    title,
    lead,
    graceLine,
    payTitle: "Подключить тариф",
    payHint: paidPlansHint(args.prices),
    freeTitle: "Остаться на бесплатном",
    freeHint: `0 ₽ · ${freeLimits}. Вы отметите, кто и что остаётся; остальные сотрудники перейдут в архив, остальные журналы выключатся — записи сохранятся.`,
  };
}

/**
 * Добровольный переход на бесплатный тариф (кнопка на странице тарифа) — в
 * любом состоянии, где тариф вообще есть. Нельзя: у платформы, демо и
 * мастер-кабинета тарифа нет; приостановленную организацию сначала
 * возобновляют.
 */
export function voluntaryDowngradeCheck(
  state: Pick<AccountBillingState, "kind" | "inactive">
): { ok: true } | { ok: false; status: number; error: string } {
  if (state.kind === "exempt") {
    return { ok: false, status: 409, error: "У этой организации нет тарифа" };
  }
  if (state.inactive) {
    return {
      ok: false,
      status: 409,
      error: "Организация приостановлена — сначала возобновите работу",
    };
  }
  return { ok: true };
}
