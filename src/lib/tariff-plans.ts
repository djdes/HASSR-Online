import { FREE_MAX_USERS } from "@/lib/plan-limits";

/**
 * Тарифы 2026-10: «Бесплатный», «Стандарт», «Премиум»
 * (spec `.agent/tasks/tariffs-v3-2026-10/spec.md`).
 *
 *   • Бесплатный — 14 дней без ограничений с момента активации, без карты.
 *     После — 1 сотрудник, 1 журнал, 1 точка, загрузка файлов закрыта.
 *   • Стандарт — 25 сотрудников на точку, все журналы, 10 МБ на приказы к
 *     журналам и свои документы.
 *   • Премиум — 100 сотрудников на точку (больше — по согласованию), всё из
 *     Стандарта, 1 ГБ на все документы, автоввод показаний с фото, подключение
 *     оборудования, доставка подключённого оборудования, типовой пакет
 *     документов, «Меркурий» (spec `.agent/tasks/tariffs-limits-ui-2026-10/`).
 *
 * Точка — отдельный адрес со своими журналами и сотрудниками; каждая точка
 * сверх первой стоит как ещё один тариф, от трёх точек — минус 5 % на каждую.
 * Не хватает мест — следующий тариф, а не новая точка (`seatUpgradeTarget`).
 * Цена за месяц живёт в `PlatformTariff` (правит ROOT), сюда
 * её приносит вызывающий код (`PlanRates`), поэтому модуль чистый: его
 * читают сервер (сумма заказа), клиентские витрины и тесты.
 */

export type PaidTier = "standard" | "premium";
export type TierId = "free" | PaidTier;
export type BillingCycle = "month" | "year";

export const PAID_TIERS: readonly PaidTier[] = ["standard", "premium"];
export const TIER_IDS: readonly TierId[] = ["free", "standard", "premium"];
export const BILLING_CYCLES: readonly BillingCycle[] = ["month", "year"];

/** Сколько дней длится бесплатный тариф без ограничений. */
export const TRIAL_DAYS = 14;
/** После пробного периода: один журнал и одна точка (сотрудник — `FREE_MAX_USERS`). */
export const FREE_MAX_JOURNALS = 1;
export const FREE_MAX_POINTS = 1;
/** Сотрудников на одну оплаченную точку; у «Премиума» больше — по согласованию. */
export const SEATS_PER_POINT: Readonly<Record<PaidTier, number>> = { standard: 25, premium: 100 };
/**
 * Верхняя граница выбора точек на витрине и в заказе — от опечаток, с
 * запасом на крупные сети: заказ не может быть меньше точек в работе.
 */
export const MAX_POINTS = 500;
/** С какого числа точек действует скидка и какая. */
export const POINTS_DISCOUNT_FROM = 3;
export const POINTS_DISCOUNT_PERCENT = 5;

const MB = 1024 * 1024;
/** Хранилище документов тарифа. */
export const STORAGE_BYTES: Record<PaidTier, number> = {
  standard: 10 * MB,
  premium: 1024 * MB,
};

/** «Заказать индивидуально» в разделе ППК — цена «от». */
export const PPK_INDIVIDUAL_FROM_RUB = 10_000;

export const CYCLE_MONTHS: Record<BillingCycle, number> = { month: 1, year: 12 };
/** На сколько дней продлевает оплата периода. */
export const CYCLE_DAYS: Record<BillingCycle, number> = { month: 30, year: 365 };

const DAY_MS = 24 * 60 * 60 * 1000;

/** Цена тарифа за месяц: помесячно и при оплате за год. */
export type PlanRates = Record<PaidTier, Record<BillingCycle, number>>;

/** Цены владельца (2026-10). ROOT правит их в `PlatformTariff`. */
export const DEFAULT_PLAN_RATES: PlanRates = {
  standard: { month: 3000, year: 1990 },
  premium: { month: 5000, year: 3990 },
};

/** Ключ `PlatformTariff` и `PaymentOrder.tariffKey`: `standard_year`. */
export function planTariffKey(tier: PaidTier, cycle: BillingCycle): string {
  return `${tier}_${cycle}`;
}

export function isPaidTier(value: unknown): value is PaidTier {
  return value === "standard" || value === "premium";
}

export function isBillingCycle(value: unknown): value is BillingCycle {
  return value === "month" || value === "year";
}

/** `premium_year` → { tier, cycle }; чужой ключ — null. */
export function parsePlanTariffKey(key: string | null | undefined): { tier: PaidTier; cycle: BillingCycle } | null {
  const [tier, cycle, rest] = String(key ?? "").trim().split("_");
  if (rest !== undefined || !isPaidTier(tier) || !isBillingCycle(cycle)) return null;
  return { tier, cycle };
}

/**
 * Старые ключи «Подписки» (до 2026-10). По ним больше не продаём: ссылки из
 * писем и промокодов ведут на ближайший новый тариф.
 */
export const LEGACY_TARIFF_KEYS: Readonly<Record<string, string>> = {
  monthly: "standard_month",
  bundle: "premium_month",
};

/** Ключ тарифа для оплаты: старый — на новый, новый — как есть. */
export function resolvePlanTariffKey(key: string | null | undefined): string {
  const value = String(key ?? "").trim();
  return LEGACY_TARIFF_KEYS[value] ?? value;
}

/** Число точек из формы/адреса: целое от 1 до `MAX_POINTS`, по умолчанию 1. */
export function normalizePoints(value: unknown): number {
  const n = typeof value === "string" ? Number(value) : typeof value === "number" ? value : NaN;
  if (!Number.isFinite(n)) return 1;
  return Math.min(MAX_POINTS, Math.max(1, Math.floor(n)));
}

/** Скидка за точки действует (3 точки и больше). */
export function hasPointsDiscount(points: number): boolean {
  return normalizePoints(points) >= POINTS_DISCOUNT_FROM;
}

/** Множитель цены: 1 → 1, 2 → 2, N ≥ 3 → N × 0,95. */
export function pointsFactor(points: number): number {
  const n = normalizePoints(points);
  return hasPointsDiscount(n) ? (n * (100 - POINTS_DISCOUNT_PERCENT)) / 100 : n;
}

/** Цена полного периода (месяц или год) за N точек, целые рубли. */
export function planPeriodPriceRub(rates: PlanRates, tier: PaidTier, cycle: BillingCycle, points = 1): number {
  return Math.round(rates[tier][cycle] * CYCLE_MONTHS[cycle] * pointsFactor(points));
}

/** Та же цена без скидки за точки — для зачёркнутой «было». */
export function planPeriodFullRub(rates: PlanRates, tier: PaidTier, cycle: BillingCycle, points = 1): number {
  return Math.round(rates[tier][cycle] * CYCLE_MONTHS[cycle] * normalizePoints(points));
}

/** Цена в пересчёте на месяц — «1 990 ₽/мес». */
export function planMonthlyRub(rates: PlanRates, tier: PaidTier, cycle: BillingCycle, points = 1): number {
  return Math.round(planPeriodPriceRub(rates, tier, cycle, points) / CYCLE_MONTHS[cycle]);
}

/**
 * Цена одной точки в месяц со скидкой за точки — крупная цена витрины
 * («2 850 ₽/мес за точку» при 14 точках помесячно). Целочисленно: 1 990 × 0,95
 * через дроби дало бы 1 890,4999… вместо 1 890,5.
 */
export function planPointMonthlyRub(rates: PlanRates, tier: PaidTier, cycle: BillingCycle, points = 1): number {
  const rate = rates[tier][cycle];
  return hasPointsDiscount(points) ? Math.round((rate * (100 - POINTS_DISCOUNT_PERCENT)) / 100) : rate;
}

/** Выгода годовой оплаты в процентах (Стандарт 3 000 → 1 990 — 34 %). */
export function yearlySavingsPercent(rates: PlanRates, tier: PaidTier): number {
  const month = rates[tier].month;
  if (!(month > 0)) return 0;
  return Math.max(0, Math.round((1 - rates[tier].year / month) * 100));
}

/** Сколько рублей за год экономит годовая оплата. */
export function yearlySavingsRub(rates: PlanRates, tier: PaidTier, points = 1): number {
  return Math.max(0, planPeriodPriceRub(rates, tier, "month", points) * 12 - planPeriodPriceRub(rates, tier, "year", points));
}

/** Наибольшая выгода по тарифам — для плашки на переключателе. */
export function maxYearlySavingsPercent(rates: PlanRates): number {
  return Math.max(...PAID_TIERS.map((tier) => yearlySavingsPercent(rates, tier)));
}

/** Лимит сотрудников оплаченного тарифа на `points` точек. */
export function seatLimitFor(tier: PaidTier, points: number): number {
  return SEATS_PER_POINT[tier] * normalizePoints(points);
}

/**
 * Куда звать, когда места тарифа заняты: бесплатный → «Стандарт»,
 * «Стандарт» → «Премиум»; у «Премиума» следующего нет — больше по
 * согласованию (null). Тарифы без лимита мест сюда не попадают.
 */
export function seatUpgradeTarget(tier: EntitlementTier): PaidTier | null {
  if (tier === "free") return "standard";
  if (tier === "standard") return "premium";
  return null;
}

/** Какой тариф нужен команде на одной точке: до 25 — «Стандарт», больше — «Премиум». */
export function tierForHeadcount(employees: number): PaidTier {
  return employees <= SEATS_PER_POINT.standard ? "standard" : "premium";
}

/**
 * Точки в работе: организация без зданий — одна точка, со зданиями —
 * по числу зданий (`Building` = точка).
 */
export function countPointsInUse(buildingsPerOrganization: readonly number[]): number {
  return buildingsPerOrganization.reduce((sum, n) => sum + Math.max(1, Math.floor(Number(n) || 0)), 0);
}

// -------------------------------------------------------------- возможности

export type PlanFeature = "photoAutofill" | "equipmentConnect" | "equipmentDelivery" | "typicalPackage" | "mercury";

export const PLAN_FEATURES: readonly PlanFeature[] = [
  "photoAutofill",
  "equipmentConnect",
  "equipmentDelivery",
  "typicalPackage",
  "mercury",
];

/**
 * Что действует у аккаунта сейчас.
 *   • trial — 14 дней без ограничений;
 *   • free — бесплатный после пробного периода;
 *   • standard / premium — оплачено;
 *   • legacy_paid — оплаченная «Подписка» прежнего тарифа: до конца срока как
 *     раньше (без новых лимитов, с возможностями Премиума);
 *   • exempt — платформа, демо, мастер-кабинет: тарифа нет;
 *   • unrestricted — переход на оплату выключен в ROOT: ничего не блокируем.
 */
export type EntitlementTier = "trial" | "free" | PaidTier | "legacy_paid" | "exempt" | "unrestricted";

export type Entitlements = {
  tier: EntitlementTier;
  /** null — без ограничения. */
  seatLimit: number | null;
  pointLimit: number | null;
  journalLimit: number | null;
  /** Байт на документы; null — без ограничения, 0 — загрузка закрыта. */
  storageBytes: number | null;
  features: Record<PlanFeature, boolean>;
};

const ALL_FEATURES: Record<PlanFeature, boolean> = {
  photoAutofill: true,
  equipmentConnect: true,
  equipmentDelivery: true,
  typicalPackage: true,
  mercury: true,
};

const NO_FEATURES: Record<PlanFeature, boolean> = {
  photoAutofill: false,
  equipmentConnect: false,
  equipmentDelivery: false,
  typicalPackage: false,
  mercury: false,
};

export function entitlementsFor(tier: EntitlementTier, points = 1): Entitlements {
  const n = normalizePoints(points);
  switch (tier) {
    case "trial":
      return { tier, seatLimit: null, pointLimit: null, journalLimit: null, storageBytes: STORAGE_BYTES.premium, features: { ...ALL_FEATURES } };
    case "free":
      return {
        tier,
        seatLimit: FREE_MAX_USERS,
        pointLimit: FREE_MAX_POINTS,
        journalLimit: FREE_MAX_JOURNALS,
        storageBytes: 0,
        features: { ...NO_FEATURES },
      };
    case "standard":
      return { tier, seatLimit: seatLimitFor("standard", n), pointLimit: n, journalLimit: null, storageBytes: STORAGE_BYTES.standard, features: { ...NO_FEATURES } };
    case "premium":
      return { tier, seatLimit: seatLimitFor("premium", n), pointLimit: n, journalLimit: null, storageBytes: STORAGE_BYTES.premium, features: { ...ALL_FEATURES } };
    case "legacy_paid":
      return { tier, seatLimit: null, pointLimit: null, journalLimit: null, storageBytes: STORAGE_BYTES.premium, features: { ...ALL_FEATURES } };
    case "exempt":
    case "unrestricted":
      return { tier, seatLimit: null, pointLimit: null, journalLimit: null, storageBytes: null, features: { ...ALL_FEATURES } };
  }
}

/** Приостановленная организация: лимиты те же, платные возможности выключены. */
export function withoutFeatures(entitlements: Entitlements): Entitlements {
  return { ...entitlements, features: { ...NO_FEATURES } };
}

/** Какой тариф платный в `subscriptionPlan`: standard/premium, иначе прежняя «Подписка». */
export function paidTierFromPlan(plan: string | null | undefined): PaidTier | "legacy" {
  const key = String(plan ?? "").trim();
  return isPaidTier(key) ? key : "legacy";
}

// ------------------------------------------------------------ переходы

/** Действующая оплаченная подписка аккаунта (то, что меняем). */
export type CurrentSubscription = {
  /** Оплачено до; null или в прошлом — подписки нет. */
  paidUntil: Date | null;
  /** standard/premium; `legacy` — «Подписка» прежнего тарифа. */
  tier: PaidTier | "legacy";
  cycle: BillingCycle;
  points: number;
};

export type PlanTarget = { tier: PaidTier; cycle: BillingCycle; points: number };

/**
 *   • new — подписки нет: полная цена, срок с сегодня;
 *   • renew — тот же тариф, период и точки: полная цена, срок от текущего конца;
 *   • upgrade — тот же период, тариф не ниже и точек не меньше: доплата за
 *     оставшиеся дни, конец срока не меняется;
 *   • switch — помесячно → за год (или с прежней «Подписки»): цена нового
 *     периода минус неиспользованный остаток, срок с сегодня;
 *   • scheduled — понижение (тариф ниже, меньше точек, год → месяц): с конца
 *     оплаченного срока, сейчас платить нечего.
 */
export type ChangeKind = "new" | "renew" | "upgrade" | "switch" | "scheduled";

export const CHANGE_KINDS: readonly ChangeKind[] = ["new", "renew", "upgrade", "switch", "scheduled"];

export function isChangeKind(value: unknown): value is ChangeKind {
  return typeof value === "string" && (CHANGE_KINDS as readonly string[]).includes(value);
}

export type PlanChangeQuote = {
  kind: ChangeKind;
  target: PlanTarget;
  /** Цена полного нового периода по прайсу (без зачёта и скидок). */
  periodPriceRub: number;
  /** Сколько засчитано за неиспользованный остаток (switch). */
  creditRub: number;
  /** Разница цен за полный период (upgrade) — для подписи «(5 000 − 3 000) × 17/30». */
  differenceRub: number;
  /** К оплате до акции и промокода. У scheduled — 0. */
  amountRub: number;
  /** Срок после оплаты. У upgrade конец — прежний. */
  periodStart: Date;
  periodEnd: Date;
  /** Оставшиеся дни текущего срока (округление вверх). */
  remainingDays: number;
};

const TIER_RANK: Record<PaidTier, number> = { standard: 1, premium: 2 };

export function normalizePlanTarget(target: PlanTarget): PlanTarget {
  return { tier: target.tier, cycle: target.cycle, points: normalizePoints(target.points) };
}

/**
 * Сумма и сроки перехода на тариф `target`. `legacyMonthlyRub` — цена
 * прежней «Подписки» за 30 дней (для зачёта остатка при переходе с неё).
 */
export function quotePlanChange(args: {
  rates: PlanRates;
  legacyMonthlyRub: number;
  current: CurrentSubscription | null;
  target: PlanTarget;
  now: Date;
}): PlanChangeQuote {
  const { rates, now } = args;
  const target = normalizePlanTarget(args.target);
  const periodPriceRub = planPeriodPriceRub(rates, target.tier, target.cycle, target.points);
  const periodMs = CYCLE_DAYS[target.cycle] * DAY_MS;
  const paidUntil = args.current?.paidUntil ?? null;
  const remainingMs = paidUntil ? paidUntil.getTime() - now.getTime() : 0;

  const fresh = (): PlanChangeQuote => ({
    kind: "new",
    target,
    periodPriceRub,
    creditRub: 0,
    differenceRub: 0,
    amountRub: periodPriceRub,
    periodStart: now,
    periodEnd: new Date(now.getTime() + periodMs),
    remainingDays: 0,
  });

  // Меньше суток от срока — считать доплату не за что: новая подписка.
  if (!args.current || !paidUntil || remainingMs < DAY_MS) return fresh();
  const current = { ...args.current, points: normalizePoints(args.current.points) };
  const remainingDays = Math.ceil(remainingMs / DAY_MS);

  // Новый период с сегодняшнего дня, остаток текущего засчитывается.
  const switchWithCredit = (currentPeriodRub: number, currentPeriodMs: number): PlanChangeQuote => {
    const credit = Math.max(0, Math.round((currentPeriodRub * remainingMs) / currentPeriodMs));
    // Остаток дороже нового периода (оплачено далеко вперёд) — лишнее
    // продлевает новый срок, а не сгорает.
    const extraMs = credit > periodPriceRub && periodPriceRub > 0 ? ((credit - periodPriceRub) / periodPriceRub) * periodMs : 0;
    return {
      kind: "switch",
      target,
      periodPriceRub,
      creditRub: Math.min(credit, periodPriceRub),
      differenceRub: 0,
      amountRub: Math.max(0, periodPriceRub - credit),
      periodStart: now,
      periodEnd: new Date(now.getTime() + periodMs + Math.round(extraMs)),
      remainingDays,
    };
  };

  if (current.tier === "legacy") {
    return switchWithCredit(Math.max(0, args.legacyMonthlyRub), CYCLE_DAYS.month * DAY_MS);
  }

  const currentTier = current.tier;
  const currentPeriodRub = planPeriodPriceRub(rates, currentTier, current.cycle, current.points);
  const currentPeriodMs = CYCLE_DAYS[current.cycle] * DAY_MS;
  const same = currentTier === target.tier && current.cycle === target.cycle && current.points === target.points;
  if (same) {
    return {
      kind: "renew",
      target,
      periodPriceRub,
      creditRub: 0,
      differenceRub: 0,
      amountRub: periodPriceRub,
      periodStart: paidUntil,
      periodEnd: new Date(paidUntil.getTime() + periodMs),
      remainingDays,
    };
  }

  const dominates = TIER_RANK[target.tier] >= TIER_RANK[currentTier] && target.points >= current.points;
  if (dominates && target.cycle === current.cycle) {
    const differenceRub = Math.max(0, periodPriceRub - currentPeriodRub);
    return {
      kind: "upgrade",
      target,
      periodPriceRub,
      creditRub: 0,
      differenceRub,
      amountRub: Math.round((differenceRub * remainingMs) / periodMs),
      periodStart: now,
      periodEnd: paidUntil,
      remainingDays,
    };
  }
  if (dominates && current.cycle === "month" && target.cycle === "year") {
    return switchWithCredit(currentPeriodRub, currentPeriodMs);
  }
  return {
    kind: "scheduled",
    target,
    periodPriceRub,
    creditRub: 0,
    differenceRub: 0,
    amountRub: 0,
    periodStart: paidUntil,
    periodEnd: new Date(paidUntil.getTime() + periodMs),
    remainingDays,
  };
}

/** Запланированный переход на следующий период (`Account.scheduledPlanJson`). */
export type ScheduledPlan = PlanTarget & { at: string };

export function parseScheduledPlan(raw: unknown): ScheduledPlan | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!isPaidTier(r.tier) || !isBillingCycle(r.cycle)) return null;
  const at = typeof r.at === "string" && Number.isFinite(new Date(r.at).getTime()) ? r.at : null;
  if (!at) return null;
  return { tier: r.tier, cycle: r.cycle, points: normalizePoints(r.points), at };
}
