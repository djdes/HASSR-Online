/**
 * Сегмент аккаунта и рекомендованное предложение автоворонки — по тому, как
 * аккаунт ведётся: сотрудники, журналы, точки, записи, датчики. Чистый модуль.
 */

import {
  SEATS_PER_POINT,
  isPaidTier,
  normalizePoints,
  planMonthlyRub,
  planPeriodPriceRub,
  seatLimitFor,
  type BillingCycle,
  type PaidTier,
  type PlanRates,
} from "@/lib/tariff-plans";

import { pluralRu } from "@/lib/plural-ru";

import { ladderDiscount, type DiscountStep } from "./settings";

/**
 * - `fits_free` — в пределах бесплатного (≤ 1 сотрудника и ≤ 1 журнала): ничего не потеряет;
 * - `idle` — записей в журналах за 14 дней нет: не начали или бросили;
 * - `solo` — ведёт один человек;
 * - `team` — ведёт команда.
 */
export type Segment = "fits_free" | "idle" | "solo" | "team";

export const SEGMENT_LABELS: Record<Segment, string> = {
  fits_free: "в пределах бесплатного",
  idle: "не ведут журналы",
  solo: "ведёт один человек",
  team: "ведёт команда",
};

export type UsageSnapshot = {
  /** Активные сотрудники (места тарифа). */
  activeUsers: number;
  /** Включённых журналов (наибольшее по организациям). */
  enabledJournals: number;
  /** Точек в работе. */
  pointsInUse: number;
  /** Записей в журналах за 7 и 14 дней. */
  entries7d: number;
  entries14d: number;
  /** Журналов, в которые писали за 14 дней. */
  journalsUsed14d: number;
  lastEntryAt: Date | null;
  /** Подключённых датчиков. */
  devices: number;
};

export function segmentOf(usage: UsageSnapshot): Segment {
  if (usage.activeUsers <= 1 && usage.enabledJournals <= 1) return "fits_free";
  if (usage.entries14d <= 0) return "idle";
  if (usage.activeUsers <= 1) return "solo";
  return "team";
}

export type OfferSnapshot = {
  tier: PaidTier;
  cycle: BillingCycle;
  points: number;
  segment: Segment;
  users: number;
  journals: number;
  entries7d: number;
  /** Скидка спец-КП по лестнице (0 — без скидки). */
  discountPercent: number;
  /** Цена периода без скидки спец-КП, ₽ (со скидкой за точки). */
  amountRub: number;
  /** Цена периода со скидкой спец-КП, ₽. */
  discountedRub: number;
  /** В пересчёте на месяц. */
  monthlyRub: number;
  /** Помесячная оплата того же тарифа — за месяц. */
  monthOnlyRub: number;
  /** Экономия при оплате за год против 12 помесячных оплат. */
  yearSavingRub: number;
  /** Почему такой тариф и столько точек. */
  reasons: string[];
};

export type OfferInput = {
  kind: "trial" | "renewal";
  usage: UsageSnapshot;
  /** Оплаченный тариф и период (продление). */
  paidTier?: PaidTier | "legacy" | null;
  planCycle?: BillingCycle | null;
  planPoints?: number | null;
  /** Период счёта новому клиенту (настройка). */
  newClientCycle: BillingCycle;
  ladder: readonly DiscountStep[];
  rates: PlanRates;
};

export function recommendOffer(input: OfferInput): OfferSnapshot {
  const { usage } = input;
  const reasons: string[] = [];
  const renewal = input.kind === "renewal";
  let points = normalizePoints(Math.max(usage.pointsInUse, renewal ? (input.planPoints ?? 1) : 1));
  let tier: PaidTier = renewal && isPaidTier(input.paidTier) ? input.paidTier : "standard";
  const cycle: BillingCycle = renewal ? (input.planCycle ?? "month") : input.newClientCycle;

  if (tier === "standard" && usage.activeUsers > seatLimitFor("standard", points)) {
    tier = "premium";
    reasons.push(`сотрудников ${usage.activeUsers} — больше ${SEATS_PER_POINT.standard} на точку «Стандарта»`);
  }
  if (tier === "standard" && usage.devices > 0) {
    tier = "premium";
    reasons.push("подключены датчики температуры — они на «Премиуме»");
  }
  if (usage.activeUsers > seatLimitFor(tier, points)) {
    const needed = normalizePoints(Math.ceil(usage.activeUsers / SEATS_PER_POINT[tier]));
    reasons.push(`для ${usage.activeUsers} сотрудников нужно ${needed} точек (по ${SEATS_PER_POINT[tier]} мест)`);
    points = needed;
  }
  if (usage.pointsInUse > 1) reasons.push(`в работе ${usage.pointsInUse} ${pluralRu(usage.pointsInUse, "точка", "точки", "точек")}`);

  const segment = segmentOf(usage);
  // Лестница — для новых клиентов: продление постоянных без скидки, помесячным —
  // предложение перейти на год (менеджер может дать скидку руками).
  const discountPercent = segment === "team" && !renewal ? ladderDiscount(input.ladder, usage.activeUsers) : 0;
  const amountRub = planPeriodPriceRub(input.rates, tier, cycle, points);
  const discountedRub = Math.round((amountRub * (100 - discountPercent)) / 100);
  const monthOnlyRub = planPeriodPriceRub(input.rates, tier, "month", points);
  const yearRub = planPeriodPriceRub(input.rates, tier, "year", points);
  return {
    tier,
    cycle,
    points,
    segment,
    users: usage.activeUsers,
    journals: usage.enabledJournals,
    entries7d: usage.entries7d,
    discountPercent,
    amountRub,
    discountedRub,
    monthlyRub: planMonthlyRub(input.rates, tier, cycle, points),
    monthOnlyRub,
    yearSavingRub: Math.max(0, monthOnlyRub * 12 - yearRub),
    reasons,
  };
}

/** Нужна ли скидке подпись того, у кого лимит больше. */
export function needsApproval(discountPercent: number, limit: number): boolean {
  return discountPercent > Math.max(0, limit);
}

export const TIER_NAMES: Record<PaidTier, string> = { standard: "«Стандарт»", premium: "«Премиум»", vip: "«ВИП»" };
export const CYCLE_NAMES: Record<BillingCycle, string> = { year: "за год", month: "за месяц" };
