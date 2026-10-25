import { pluralRu } from "@/lib/plural-ru";
import {
  CYCLE_DAYS,
  isBillingCycle,
  isChangeKind,
  isPaidTier,
  normalizePoints,
  parsePlanTariffKey,
  type BillingCycle,
  type ChangeKind,
  type CurrentSubscription,
  type PaidTier,
} from "@/lib/tariff-plans";

/**
 * Что делает подтверждённая оплата заказа тарифа 2026-10 с подпиской
 * аккаунта (чистая функция: её зовёт `payment-fulfillment.ts`, проверяют
 * тесты). Вид перехода и сроки посчитаны при оформлении заказа
 * (`quotePlanChange`) и лежат в заказе: `changeKind`, `points`,
 * `periodEndsAt`. Между оформлением и оплатой проходят минуты (карта) или
 * дни (счёт по безналу). Сначала оплата проверяет, что подписка с тех пор не
 * изменилась (`planOrderStillMatches`; не подходит — ручной разбор), затем
 * сроки пересчитываются от момента оплаты:
 *
 *   • new / switch — срок с момента оплаты на ту же длину, что при
 *     оформлении (у switch туда входят дни из зачёта остатка); если к
 *     оплате «новой» подписки у аккаунта уже идёт оплаченный срок (он
 *     начался между оформлением и оплатой), новый период добавляется к
 *     его концу — оплаченные дни не сгорают;
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
  } else if (kind === "new" && currentEnd) {
    subscriptionEnd = new Date(currentEnd.getTime() + (quotedMs ?? periodMs));
  } else {
    subscriptionEnd = new Date(now.getTime() + (quotedMs ?? periodMs));
  }
  return { tier: plan.tier, cycle: plan.cycle, points, kind, subscriptionEnd };
}

/** Снимок подписки, от которой посчитан заказ (`PaymentOrder.basePlanJson`). */
export type BasePlanSnapshot = {
  current: { tier: CurrentSubscription["tier"]; cycle: BillingCycle; points: number; paidUntil: string | null } | null;
};

export function basePlanSnapshot(current: CurrentSubscription | null): BasePlanSnapshot {
  return {
    current: current
      ? { tier: current.tier, cycle: current.cycle, points: normalizePoints(current.points), paidUntil: current.paidUntil?.toISOString() ?? null }
      : null,
  };
}

/** Снимок из заказа; undefined — снимка нет (заказ оформлен до сверки). */
export function parseBasePlan(raw: unknown): CurrentSubscription | null | undefined {
  if (!raw || typeof raw !== "object" || !("current" in raw)) return undefined;
  const current = (raw as { current: unknown }).current;
  if (current === null) return null;
  if (!current || typeof current !== "object") return undefined;
  const c = current as Record<string, unknown>;
  const tier = c.tier === "legacy" || isPaidTier(c.tier) ? c.tier : null;
  if (!tier || !isBillingCycle(c.cycle)) return undefined;
  const paidUntil = typeof c.paidUntil === "string" ? new Date(c.paidUntil) : null;
  return {
    tier,
    cycle: c.cycle,
    points: normalizePoints(c.points),
    paidUntil: paidUntil && Number.isFinite(paidUntil.getTime()) ? paidUntil : null,
  };
}

/** Сдвиг срока, который ещё считается «тем же» (округление дат в ROOT). */
const END_TOLERANCE_MS = 60 * 1000;

/**
 * Подходит ли оплаченный заказ к подписке аккаунта. Сумма заказа посчитана
 * от подписки на момент оформления (снимок в заказе); если с тех пор она
 * изменилась — оплачен другой заказ, ROOT поменял тариф или срок, — применять
 * заказ как есть нельзя: старая «доплата за остаток» дала бы годовой Премиум
 * за тысячу рублей, старая «новая подписка» понизила бы тариф.
 *
 * Сравнивается снимок с подпиской аккаунта, какой она выглядит сейчас, но на
 * момент оформления (`subscriptionThen`): срок, истёкший после оформления,
 * подписку не меняет — продление по счёту, оплаченному после конца срока,
 * применяется. Цены не участвуют: смена цен ROOT заказы не задерживает.
 * Продления складываются (срок мог уйти вперёд другим продлением); доплата
 * и переход на год — только пока идёт срок, от остатка которого считались.
 * Не подошёл — заказ разбирают вручную (payment-fulfillment.ts).
 */
export function planOrderStillMatches(args: {
  order: { tariffKey: string; changeKind?: string | null; basePlan?: unknown };
  subscriptionThen: CurrentSubscription | null;
  now: Date;
}): boolean {
  const kind = args.order.changeKind;
  const base = parseBasePlan(args.order.basePlan);
  if (!parsePlanTariffKey(args.order.tariffKey) || !isChangeKind(kind) || base === undefined) return true;
  const then = args.subscriptionThen;
  if (!base || !then) return !base && !then;
  const samePlan =
    base.tier === then.tier && base.cycle === then.cycle && normalizePoints(base.points) === normalizePoints(then.points);
  if (!samePlan || !base.paidUntil || !then.paidUntil) return false;
  const endShift = then.paidUntil.getTime() - base.paidUntil.getTime();
  if (kind === "renew") return endShift > -END_TOLERANCE_MS;
  if (Math.abs(endShift) > END_TOLERANCE_MS) return false;
  if (kind === "upgrade" || kind === "switch") return then.paidUntil.getTime() > args.now.getTime();
  return true;
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
