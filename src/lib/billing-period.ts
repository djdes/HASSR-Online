import { FREE_MAX_USERS, isFreePlan, isInactivePlan, isPaidPlan } from "@/lib/plan-limits";
import {
  EXTRA_USER_PRICE_RUB,
  SUBSCRIPTION_MAX_USERS,
  employeesGenitiveLabel,
  employeesLabel,
} from "@/lib/plan-catalog";
import type { PriceWithPromotion } from "@/lib/promo/promotions";

/**
 * Бесплатный период «подписка для всех» и честный переход на оплату
 * (2026-10). Чистые функции без `db`: их читают и серверные guard'ы, и
 * клиентские окна, и тесты.
 *
 * Модель (spec `.agent/tasks/billing-cutover-2026-09/spec.md`):
 *   • до начала периода — как раньше: тестовый автоперевод на «платный»;
 *   • в периоде — у всех подписка до `SUBSCRIPTION_MAX_USERS` без оплаты;
 *   • после конца (если «Переход на оплату включён») — у аккаунта без
 *     реально оплаченной подписки бесплатный тариф на `FREE_MAX_USERS`.
 *     Больше одного активного — «нужно решение» до конца грейса, потом
 *     автопереход (остаётся владелец, остальные в архив).
 *
 * Маркера «решение принято» нет намеренно: после перехода на бесплатный
 * активных ≤ 1 — состояние `free`, после оплаты `subscriptionEnd` в
 * будущем — `paid`. Состояние всегда выводится из данных и не может
 * «застрять».
 */

/** Ключ `PlatformSetting` с настройками периода (JSON). */
export const FREE_PERIOD_SETTING_KEY = "billing.free-period";

export type FreePeriodSettings = {
  /** Начало «подписка бесплатно для всех» (включительно). */
  startsAt: Date;
  /** Конец (не включительно): с этого момента — переход на оплату. */
  endsAt: Date;
  /** Сколько дней после конца даётся на решение до автоперехода. */
  graceDays: number;
  /** «Переход на оплату включён»: выключен — после периода всё как раньше. */
  transitionEnabled: boolean;
};

/** Москва без перехода на летнее время с 2014 года — фиксированный сдвиг. */
const MSK_OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export const GRACE_DAYS_MIN = 0;
export const GRACE_DAYS_MAX = 60;

export const DEFAULT_FREE_PERIOD: FreePeriodSettings = {
  // 2026-10-01 00:00 МСК
  startsAt: new Date("2026-09-30T21:00:00.000Z"),
  // 2026-10-11 00:00 МСК: 10 октября — последний бесплатный день
  endsAt: new Date("2026-10-10T21:00:00.000Z"),
  graceDays: 7,
  transitionEnabled: true,
};

function parseDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null;
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

/**
 * Настройки из `PlatformSetting` → значения с дефолтами. Битое поле
 * заменяется дефолтом, а не ломает весь кабинет: окно перехода читается
 * на каждой странице.
 */
export function normalizeFreePeriodSettings(raw: unknown): FreePeriodSettings {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const startsAt = parseDate(r.startsAt) ?? DEFAULT_FREE_PERIOD.startsAt;
  let endsAt = parseDate(r.endsAt) ?? DEFAULT_FREE_PERIOD.endsAt;
  if (endsAt.getTime() <= startsAt.getTime()) {
    // Конец раньше начала — период пустой: переход сразу с «начала».
    endsAt = startsAt;
  }
  const graceRaw = Number(r.graceDays);
  const graceDays = Number.isInteger(graceRaw)
    ? Math.min(GRACE_DAYS_MAX, Math.max(GRACE_DAYS_MIN, graceRaw))
    : DEFAULT_FREE_PERIOD.graceDays;
  const transitionEnabled =
    typeof r.transitionEnabled === "boolean"
      ? r.transitionEnabled
      : DEFAULT_FREE_PERIOD.transitionEnabled;
  return { startsAt, endsAt, graceDays, transitionEnabled };
}

export function serializeFreePeriodSettings(settings: FreePeriodSettings): string {
  return JSON.stringify({
    startsAt: settings.startsAt.toISOString(),
    endsAt: settings.endsAt.toISOString(),
    graceDays: settings.graceDays,
    transitionEnabled: settings.transitionEnabled,
  });
}

export type FreePeriodInput = {
  startsAt: unknown;
  endsAt: unknown;
  graceDays: unknown;
  transitionEnabled: unknown;
};

/** Проверка формы ROOT: в отличие от normalize, ошибки не прячем. */
export function validateFreePeriodInput(
  input: FreePeriodInput
): { ok: true; value: FreePeriodSettings } | { ok: false; error: string } {
  const startsAt = parseDate(input.startsAt);
  const endsAt = parseDate(input.endsAt);
  if (!startsAt) return { ok: false, error: "Укажите начало периода" };
  if (!endsAt) return { ok: false, error: "Укажите конец периода" };
  if (endsAt.getTime() <= startsAt.getTime()) {
    return { ok: false, error: "Конец периода должен быть позже начала" };
  }
  const graceDays = Number(input.graceDays);
  if (!Number.isInteger(graceDays) || graceDays < GRACE_DAYS_MIN || graceDays > GRACE_DAYS_MAX) {
    return {
      ok: false,
      error: `Грейс — целое число дней от ${GRACE_DAYS_MIN} до ${GRACE_DAYS_MAX}`,
    };
  }
  if (typeof input.transitionEnabled !== "boolean") {
    return { ok: false, error: "Не указано, включён ли переход на оплату" };
  }
  return {
    ok: true,
    value: { startsAt, endsAt, graceDays, transitionEnabled: input.transitionEnabled },
  };
}

export type BillingPhase = "before" | "free_period" | "after";

export function billingPhase(settings: FreePeriodSettings, now: Date): BillingPhase {
  const t = now.getTime();
  if (t < settings.startsAt.getTime()) return "before";
  if (t < settings.endsAt.getTime()) return "free_period";
  return "after";
}

/** Действует ли бесплатный тариф на 1 сотрудника для неоплативших. */
export function isBillingEnforced(settings: FreePeriodSettings, now: Date): boolean {
  return settings.transitionEnabled && now.getTime() >= settings.endsAt.getTime();
}

/**
 * Тихий автоперевод на «платный» (`ensurePlanForHeadcount`) разрешён,
 * пока переход на оплату не начался.
 */
export function isAutoUpgradeAllowed(settings: FreePeriodSettings, now: Date): boolean {
  return !isBillingEnforced(settings, now);
}

/**
 * Реально оплачено: срок подписки в будущем (оплата картой, счёт или
 * ROOT). `paid` с пустым сроком — тестовый автоперевод, не оплата.
 * Приостановленная организация не считается оплаченной.
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
  /** Реально оплачено. */
  | "paid"
  /** До периода или переход выключен — как раньше (тестовый режим). */
  | "legacy"
  /** Идёт бесплатный период: подписка до 10 без оплаты. */
  | "free_period"
  /** После периода: бесплатный тариф, активных ≤ 1. */
  | "free"
  /** После периода: не оплачено и активных > 1 — нужно решение. */
  | "needs_decision";

export type TransitionReason = "free_period_ended" | "subscription_expired";

export type AccountBillingInput = {
  /** Тариф аккаунта (или legacy-зеркало организации). */
  plan: string | null | undefined;
  /** Самый поздний срок подписки по аккаунту и его организациям. */
  subscriptionEnd: Date | null;
  /** Активные сотрудники аккаунта (без архива, комиссии, ROOT). */
  activeUsers: number;
  /** Платформа / демо / мастер-кабинет. */
  exempt?: boolean;
  /** Организация на паузе или отменена. */
  inactive?: boolean;
};

export type AccountBillingState = {
  kind: AccountBillingKind;
  phase: BillingPhase;
  /** Действует ли переход (после конца периода и флаг включён). */
  enforcement: boolean;
  inactive: boolean;
  activeUsers: number;
  /** До какого числа реально оплачено; null — не оплачено. */
  paidUntil: Date | null;
  /** Почему нужно решение (для заголовка окна и уведомлений). */
  reason: TransitionReason | null;
  /** До какого момента руководитель решает сам. */
  graceEndsAt: Date | null;
  graceExpired: boolean;
  /** Сколько активных можно держать; null — без блокировки. */
  seatLimit: number | null;
  /** Платные возможности (автоввод с фото и т. п.). */
  paidFeatures: boolean;
};

export function computeAccountBilling(
  input: AccountBillingInput,
  settings: FreePeriodSettings,
  now: Date
): AccountBillingState {
  const phase = billingPhase(settings, now);
  const enforcement = isBillingEnforced(settings, now);
  const inactive = input.inactive === true || isInactivePlan(input.plan);
  const activeUsers = Number.isFinite(input.activeUsers)
    ? Math.max(0, Math.floor(input.activeUsers))
    : 0;
  const base = {
    phase,
    enforcement,
    inactive,
    activeUsers,
    paidUntil: null,
    reason: null,
    graceEndsAt: null,
    graceExpired: false,
  } satisfies Partial<AccountBillingState>;

  if (input.exempt) {
    return {
      ...base,
      kind: "exempt",
      seatLimit: null,
      paidFeatures: !inactive && isPaidPlan(input.plan),
    };
  }

  if (isReallyPaid(input.plan, input.subscriptionEnd, now)) {
    // Оплаченная, но приостановленная за неактивность организация
    // остаётся оплаченной (лимита нет, отказ «оплатите» был бы неправдой),
    // а платные возможности на паузе выключены — как и раньше.
    return {
      ...base,
      kind: "paid",
      paidUntil: input.subscriptionEnd,
      seatLimit: null,
      paidFeatures: !inactive,
    };
  }

  if (phase === "free_period") {
    return { ...base, kind: "free_period", seatLimit: null, paidFeatures: !inactive };
  }

  if (!enforcement) {
    return {
      ...base,
      kind: "legacy",
      seatLimit: null,
      paidFeatures: !inactive && isPaidPlan(input.plan),
    };
  }

  // Оплаченный срок кончился ПОСЛЕ бесплатного периода — честно пишем
  // «подписка закончилась». Кончился раньше — последним закончился
  // бесплатный период, про него и говорим.
  const end = input.subscriptionEnd;
  const expiredPaid = end !== null && end.getTime() > settings.endsAt.getTime();
  const reason: TransitionReason = expiredPaid ? "subscription_expired" : "free_period_ended";
  const graceBase = expiredPaid && end ? end : settings.endsAt;
  const graceEndsAt = new Date(graceBase.getTime() + settings.graceDays * DAY_MS);

  if (activeUsers <= FREE_MAX_USERS) {
    return { ...base, kind: "free", reason, seatLimit: FREE_MAX_USERS, paidFeatures: false };
  }
  return {
    ...base,
    kind: "needs_decision",
    reason,
    graceEndsAt,
    graceExpired: now.getTime() >= graceEndsAt.getTime(),
    seatLimit: FREE_MAX_USERS,
    paidFeatures: false,
  };
}

/** Код ошибки лимита: клиент по нему показывает кнопку «Оплатить». */
export const BILLING_LIMIT_CODE = "billing_free_limit";

/** Куда вести оплату из кабинета: там и карта, и счёт по безналу. */
export const BILLING_PAY_HREF = "/settings/subscription";

/** Текст отказа руководителю. */
export const FREE_LIMIT_MESSAGE =
  `Бесплатный тариф — ${employeesLabel(FREE_MAX_USERS)}. ` +
  "Оплатите подписку, чтобы добавить сотрудников или вернуть их из архива.";

/** Текст отказа тому, кто принимает приглашение: платить не ему. */
export const FREE_LIMIT_INVITEE_MESSAGE =
  `На бесплатном тарифе организации — ${employeesLabel(FREE_MAX_USERS)}. ` +
  "Попросите руководителя оплатить подписку и повторите.";

export type SeatCheck =
  | { ok: true }
  | { ok: false; limit: number; activeUsers: number; message: string };

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
    message: FREE_LIMIT_MESSAGE,
  };
}

export type TransitionAction =
  /** Ничего не делать. */
  | "none"
  /** ≤ 1 активного, тариф ещё «платный» без оплаты — молча `free` + одно уведомление. */
  | "silent_free"
  /** > 1 и грейс идёт — ждём решения руководителя (одно предупреждение). */
  | "await_decision"
  /** > 1 и грейс истёк — автопереход: владелец остаётся, остальные в архив. */
  | "auto_free";

/** Что ежедневная задача делает с аккаунтом. */
export function decideTransitionAction(
  state: AccountBillingState,
  plan: string | null | undefined
): TransitionAction {
  if (!state.enforcement || state.inactive) return "none";
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

/** Ключ дня по Москве «2026-10-01» — для «скрыть на сегодня». */
export function mskDayKey(date: Date): string {
  const { day, month, year } = mskParts(date);
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Последний бесплатный день: конец периода не включительно. */
export function lastFreeDay(settings: FreePeriodSettings): Date {
  return new Date(settings.endsAt.getTime() - 1);
}

/** «С 1 по 10 октября» / «С 28 сентября по 3 октября». */
export function freePeriodRangeLabel(settings: FreePeriodSettings): string {
  const from = mskParts(settings.startsAt);
  const to = mskParts(lastFreeDay(settings));
  if (from.month === to.month && from.year === to.year) {
    return `С ${from.day} по ${to.day} ${MONTHS_GENITIVE[to.month]}`;
  }
  return `С ${formatMskDay(settings.startsAt)} по ${formatMskDay(lastFreeDay(settings))}`;
}

/** «1 990 ₽» — неразрывный пробел, как в `formatRub`. */
export function formatPriceRub(value: number): string {
  return `${new Intl.NumberFormat("ru-RU").format(value)} ₽`;
}

/** Цена подписки для анонса и окна: база, цена с акцией и сама акция. */
export type BillingPrice = Pick<PriceWithPromotion, "baseRub" | "priceRub" | "promotion">;

function asBillingPrice(price: number | BillingPrice): BillingPrice {
  return typeof price === "number" ? { baseRub: price, priceRub: price, promotion: null } : price;
}

/** «1 990 ₽/мес» или «1 592 ₽/мес по акции (без акции 1 990 ₽)» — текстом, без зачёркивания. */
export function billingPriceText(price: BillingPrice): string {
  const promo = price.promotion && price.priceRub < price.baseRub;
  return promo
    ? `${formatPriceRub(price.priceRub)}/мес по акции (без акции ${formatPriceRub(price.baseRub)})`
    : `${formatPriceRub(price.priceRub)}/мес`;
}

/** Подписка «до 10 сотрудников» — как её называем в анонсе и окне. */
export const SUBSCRIPTION_QUOTED_NAME = `«до ${employeesGenitiveLabel(SUBSCRIPTION_MAX_USERS)}»`;

export type BillingAnnouncement = {
  /** «С 1 по 10 октября подписка «до 10 сотрудников» бесплатна для всех.» */
  lead: string;
  /** «С 11 октября — 1 990 ₽/мес или бесплатный тариф на 1 сотрудника.» Нет — если переход выключен. */
  tail: string | null;
  /**
   * То же, что `tail`, по частям: окно рисует цену компонентом
   * `PromoPrice` (в акцию старая цена зачёркнута).
   */
  tailParts: { before: string; price: BillingPrice; after: string } | null;
};

/**
 * Анонс периода. Показывается от выкладки до конца периода, кроме
 * организаций с оплаченной подпиской. Даты и цена — из настроек и тарифа.
 */
export function announcementText(
  settings: FreePeriodSettings,
  priceArg: number | BillingPrice
): BillingAnnouncement {
  const lead = `${freePeriodRangeLabel(settings)} подписка ${SUBSCRIPTION_QUOTED_NAME} бесплатна для всех.`;
  if (!settings.transitionEnabled) return { lead, tail: null, tailParts: null };
  const price = asBillingPrice(priceArg);
  const before = `С ${formatMskDay(settings.endsAt)} — `;
  const after = ` или бесплатный тариф на ${employeesGenitiveLabel(FREE_MAX_USERS)}.`;
  return { lead, tail: `${before}${billingPriceText(price)}${after}`, tailParts: { before, price, after } };
}

/** Показывать ли анонс аккаунту в этом состоянии. */
export function shouldShowAnnouncement(state: AccountBillingState): boolean {
  if (state.kind === "paid" || state.kind === "exempt") return false;
  return state.phase === "before" || state.phase === "free_period";
}

export type TransitionCopy = {
  title: string;
  lead: string;
  graceLine: string | null;
  payTitle: string;
  payHint: string;
  /** Цена для окна (`PromoPrice`) и условия после неё — `payHint` по частям. */
  payPrice: BillingPrice;
  payTerms: string;
  freeTitle: string;
  freeHint: string;
};

/**
 * Тексты окна перехода. Правило честности: тем, кто не платил, НЕ пишем
 * «оплаченный тариф закончился» — пишем, что закончился бесплатный период
 * подписки (он и был бесплатным). «Подписка закончилась» — только если
 * последним закончился реально оплаченный срок.
 */
export function transitionCopy(args: {
  state: AccountBillingState;
  settings: FreePeriodSettings;
  /** Число — цена без акции; объект — цена с действующей акцией. */
  priceRub: number | BillingPrice;
}): TransitionCopy {
  const { state, settings } = args;
  const payPrice = asBillingPrice(args.priceRub);
  const who = employeesLabel(state.activeUsers);
  const free = employeesLabel(FREE_MAX_USERS);
  const expired = state.reason === "subscription_expired";
  const title = expired ? "Подписка закончилась" : "Бесплатный период подписки закончился";
  const lead = expired
    ? `Оплаченный срок подписки ${SUBSCRIPTION_QUOTED_NAME} закончился. Сейчас в кабинете ${who}, а бесплатный тариф — ${free}.`
    : `${freePeriodRangeLabel(settings)} подписка ${SUBSCRIPTION_QUOTED_NAME} была бесплатной для всех. Сейчас в кабинете ${who}, а бесплатный тариф — ${free}.`;
  const graceLine = state.graceEndsAt
    ? state.graceExpired
      ? "Срок выбора прошёл: скоро в работе останется только владелец аккаунта, остальные перейдут в архив. Вернуть их можно после оплаты."
      : `Выберите до ${formatMskDay(new Date(state.graceEndsAt.getTime() - 1))} включительно. Если ничего не выбрать, в работе останется только владелец аккаунта, остальные перейдут в архив — вернуть их можно после оплаты.`
    : null;
  const payTerms = `до ${employeesGenitiveLabel(SUBSCRIPTION_MAX_USERS)}, все остаются в работе. Каждый сверх ${SUBSCRIPTION_MAX_USERS} — +${EXTRA_USER_PRICE_RUB} ₽/мес.`;
  return {
    title,
    lead,
    graceLine,
    payTitle: "Оплатить подписку",
    payHint: `${billingPriceText(payPrice)} · ${payTerms}`,
    payPrice,
    payTerms,
    freeTitle: "Перейти на бесплатный",
    freeHint: `0 ₽ · ${free}. Остальные перейдут в архив, их записи в журналах сохранятся.`,
  };
}
