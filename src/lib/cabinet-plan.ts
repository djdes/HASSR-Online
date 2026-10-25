import {
  formatMskDay,
  lastDayBefore,
  type AccountBillingState,
} from "@/lib/billing-period";
import { employeesLabel } from "@/lib/plan-catalog";
import { isFreePlan, planLabel } from "@/lib/plan-limits";
import { pluralRu } from "@/lib/plural-ru";
import { discountForPrice, type DiscountKind } from "@/lib/promo/discounts";
import { applyPromotion, type AppliedPromotion, type PriceWithPromotion } from "@/lib/promo/promotions";
import {
  CYCLE_MONTHS,
  planMonthlyRub,
  planPeriodPriceRub,
  type BillingCycle,
  type PaidTier,
  type PlanRates,
} from "@/lib/tariff-plans";

/**
 * «Мой кабинет» в меню профиля и «Ваш план» на странице тарифа — чистые
 * функции без `db` (их читают сервер, клиент и тесты).
 *
 * Своего счёта здесь нет: цена периода — `planPeriodPriceRub` (тариф ×
 * точки, от трёх точек −5 % на каждую), поверх неё акция (`applyPromotion`,
 * как на странице тарифа и в заказе) и скидка навсегда / промокод
 * (`discountForPrice` от цены с акцией, как `PromoPrice`).
 */

export type PersonalDiscountInput = { kind: DiscountKind; value: number } | null;

export type PlanTotal = {
  /** Цена периода по прайсу. */
  periodRub: number;
  /** Цена периода с акцией — вход `PromoPrice`. */
  withPromotion: PriceWithPromotion;
  /** Скидка навсегда или промокод поверх акции, ₽. */
  personalRub: number;
  /** Итого за период после акции и скидки. */
  finalRub: number;
  /** То же в пересчёте на месяц. */
  monthlyFinalRub: number;
  monthlyFullRub: number;
  /** Итог меньше суммы по тарифу (действует акция или скидка). */
  discounted: boolean;
};

export function planTotal(args: {
  rates: PlanRates;
  tier: PaidTier;
  cycle: BillingCycle;
  points: number;
  promotion: AppliedPromotion | null;
  personal: PersonalDiscountInput;
}): PlanTotal {
  const periodRub = planPeriodPriceRub(args.rates, args.tier, args.cycle, args.points);
  const withPromotion = applyPromotion(periodRub, args.promotion);
  const personalRub = args.personal ? discountForPrice(args.personal, withPromotion.priceRub) : 0;
  const finalRub = Math.max(0, withPromotion.priceRub - personalRub);
  const months = CYCLE_MONTHS[args.cycle];
  return {
    periodRub,
    withPromotion,
    personalRub,
    finalRub,
    monthlyFinalRub: Math.round(finalRub / months),
    monthlyFullRub: planMonthlyRub(args.rates, args.tier, args.cycle, args.points),
    discounted: finalRub < periodRub,
  };
}

/** Название тарифа по полю `subscriptionPlan`: «Стандарт», «Премиум», «Бесплатный». */
export function tariffName(plan: string | null | undefined): string {
  return planLabel(isFreePlan(plan) ? "free" : plan);
}

const PAID_TITLES: Record<PaidTier | "legacy", string> = {
  standard: "Стандарт",
  premium: "Премиум",
  legacy: "Подписка (прежний тариф)",
};

/** Название тарифа для карточки «Мой кабинет». */
export function cabinetPlanTitle(state: AccountBillingState | null, plan: string): string {
  switch (state?.kind) {
    case "free_period":
      return state.trialEndsAt
        ? `Пробный период — по ${formatMskDay(lastDayBefore(state.trialEndsAt))}`
        : "Пробный период";
    case "needs_decision":
      return "Нужно выбрать тариф";
    case "free":
      return "Бесплатный";
    case "paid": {
      const name = PAID_TITLES[state.paidTier ?? "legacy"];
      return state.paidUntil ? `${name} до ${formatMskDay(state.paidUntil)}` : name;
    }
    default:
      return tariffName(plan);
  }
}

/** Тариф не оплачен — ссылка «Выбрать тариф» вместо «Изменить тариф». */
export function isOnFreeTariff(state: AccountBillingState | null, plan: string): boolean {
  if (state?.kind === "free" || state?.kind === "needs_decision" || state?.kind === "free_period") return true;
  if (state?.kind === "paid") return false;
  return isFreePlan(plan);
}

/**
 * Что показывать в карточке. Сотрудник без права на тариф и приложение
 * WeSetup (правила сторов: ни цены, ни ссылки на оплату) — только название.
 */
export function cabinetPlanAccess(args: { canManagePlan: boolean; inMobileApp: boolean }): {
  details: boolean;
} {
  return { details: args.canManagePlan && !args.inMobileApp };
}

export function organizationsLabel(count: number): string {
  return `${count} ${pluralRu(count, "организация", "организации", "организаций")}`;
}

export function pointsLabel(count: number): string {
  return `${count} ${pluralRu(count, "точка", "точки", "точек")}`;
}

/** Данные карточки «Мой кабинет» — сериализуются из layout'а в шапку. */
export type CabinetPlanCard = {
  title: string;
  /** «2 точки · 38 сотрудников из 50»; null — не показывать. */
  counts: string | null;
  price: {
    /** Итого в месяц после акции и скидки. */
    finalRub: number;
    /** Сумма по тарифу — зачёркнута, если больше итога. */
    fullRub: number;
    /** «за год», «помесячно». */
    breakdown: string | null;
    /** «тестовый режим — оплата не списывается». */
    note: string | null;
  } | null;
  link: { href: string; label: string } | null;
};

export const CABINET_PLAN_HREF = "/settings/subscription";

export function buildCabinetPlanCard(args: {
  state: AccountBillingState | null;
  plan: string;
  exempt: boolean;
  employees: number;
  rates: PlanRates;
  promotion: AppliedPromotion | null;
  personal: PersonalDiscountInput;
  canManagePlan: boolean;
  inMobileApp: boolean;
  testMode: boolean;
}): CabinetPlanCard {
  const title = cabinetPlanTitle(args.state, args.plan);
  if (!cabinetPlanAccess(args).details) {
    return { title, counts: null, price: null, link: null };
  }
  const onFree = isOnFreeTariff(args.state, args.plan);
  const link = {
    href: CABINET_PLAN_HREF,
    label: onFree ? "Выбрать тариф" : "Изменить тариф",
  };
  if (args.exempt || !args.state) return { title, counts: null, price: null, link };

  const state = args.state;
  const seats = state.seatLimit !== null ? `${employeesLabel(args.employees)} из ${state.seatLimit}` : employeesLabel(args.employees);
  const counts = `${pointsLabel(state.pointsInUse)} · ${seats}`;
  // Не оплачено или прежняя «Подписка» — суммы по новым тарифам нет.
  if (state.kind !== "paid" || !state.paidTier || state.paidTier === "legacy") return { title, counts, price: null, link };

  const total = planTotal({
    rates: args.rates,
    tier: state.paidTier,
    cycle: state.planCycle,
    points: state.planPoints,
    promotion: args.promotion,
    personal: args.personal,
  });
  return {
    title,
    counts,
    price: {
      finalRub: total.monthlyFinalRub,
      fullRub: total.monthlyFullRub,
      breakdown: state.planCycle === "year" ? "оплата за год" : "помесячно",
      note: args.testMode ? "тестовый режим — оплата не списывается" : null,
    },
    link,
  };
}
