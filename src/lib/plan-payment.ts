import { pluralRu } from "@/lib/plural-ru";
import {
  CYCLE_DAYS,
  isChangeKind,
  normalizePoints,
  parsePlanTariffKey,
  type BillingCycle,
  type ChangeKind,
  type PaidTier,
} from "@/lib/tariff-plans";

/**
 * Что делает подтверждённая оплата заказа тарифа 2026-10 с подпиской
 * аккаунта (чистая функция: её зовёт `payment-fulfillment.ts`, проверяют
 * тесты). Вид перехода и сроки посчитаны при оформлении заказа
 * (`quotePlanChange`) и лежат в заказе: `changeKind`, `points`,
 * `periodEndsAt`. Между оформлением и оплатой проходят минуты (карта) или
 * дни (счёт по безналу), поэтому сроки пересчитываются от момента оплаты:
 *
 *   • new / switch — срок с момента оплаты на ту же длину, что при
 *     оформлении (у switch туда входят дни из зачёта остатка);
 *   • renew — от текущего конца (или с сегодня, если он прошёл);
 *   • upgrade — конец не меняется; если он успел пройти, — с сегодня на
 *     оставшиеся при оформлении дни, за которые и была доплата.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export type PlanPaymentOrder = {
  tariffKey: string;
  points?: number | null;
  changeKind?: string | null;
  periodEndsAt?: Date | null;
  createdAt?: Date | null;
};

export type PaidPlanUpdate = {
  tier: PaidTier;
  cycle: BillingCycle;
  points: number;
  kind: ChangeKind;
  subscriptionEnd: Date;
};

/**
 * Новый тариф аккаунта после оплаты. null — заказ не тарифа 2026-10
 * (прежняя «Подписка», пополнение баланса): его продлевают по-старому.
 */
export function planAfterPayment(args: {
  order: PlanPaymentOrder;
  /** Текущий конец оплаченного срока (самый поздний по аккаунту и организации). */
  currentEnd: Date | null;
  now: Date;
}): PaidPlanUpdate | null {
  const plan = parsePlanTariffKey(args.order.tariffKey);
  if (!plan) return null;
  const { now } = args;
  const points = normalizePoints(args.order.points ?? 1);
  const kind: ChangeKind = isChangeKind(args.order.changeKind) && args.order.changeKind !== "scheduled" ? args.order.changeKind : "renew";
  const periodMs = CYCLE_DAYS[plan.cycle] * DAY_MS;
  const quotedMs =
    args.order.periodEndsAt && args.order.createdAt
      ? Math.max(0, args.order.periodEndsAt.getTime() - args.order.createdAt.getTime())
      : null;
  const currentEnd = args.currentEnd && args.currentEnd.getTime() > now.getTime() ? args.currentEnd : null;

  let subscriptionEnd: Date;
  if (kind === "renew") {
    subscriptionEnd = new Date((currentEnd ?? now).getTime() + periodMs);
  } else if (kind === "upgrade") {
    subscriptionEnd = currentEnd ?? new Date(now.getTime() + (quotedMs ?? periodMs));
  } else {
    subscriptionEnd = new Date(now.getTime() + (quotedMs ?? periodMs));
  }
  return { tier: plan.tier, cycle: plan.cycle, points, kind, subscriptionEnd };
}

/** «Стандарт — за год, 2 точки» — в описание заказа, чек и УПД. */
export function planOrderTitle(tier: PaidTier, cycle: BillingCycle, points: number): string {
  const name = tier === "premium" ? "Премиум" : "Стандарт";
  const period = cycle === "year" ? "за год" : "на месяц";
  const n = normalizePoints(points);
  const pointsPart = n > 1 ? `, ${n} ${pluralRu(n, "точка", "точки", "точек")}` : "";
  return `Тариф «${name}» ${period}${pointsPart}`;
}

/**
 * Название тарифа заказа для счёта и УПД: «Премиум — за год, 2 точки».
 * null — заказ не тарифа 2026-10 (берут название из `PlatformTariff`).
 */
export function planTariffTitle(tariffKey: string, points?: number | null): string | null {
  const plan = parsePlanTariffKey(tariffKey);
  if (!plan) return null;
  const name = plan.tier === "premium" ? "Премиум" : "Стандарт";
  const period = plan.cycle === "year" ? "за год" : "помесячно";
  const n = normalizePoints(points ?? 1);
  const pointsPart = n > 1 ? `, ${n} ${pluralRu(n, "точка", "точки", "точек")}` : "";
  return `${name} — ${period}${pointsPart}`;
}

/** Пояснение вида перехода для описания заказа. */
export function changeKindNote(kind: ChangeKind, args: { remainingDays: number; creditRub: number }): string | null {
  switch (kind) {
    case "upgrade":
      return `доплата за ${args.remainingDays} дн. до конца оплаченного срока`;
    case "switch":
      return args.creditRub > 0 ? `зачтён остаток ${args.creditRub} ₽` : null;
    case "renew":
      return "продление";
    default:
      return null;
  }
}
