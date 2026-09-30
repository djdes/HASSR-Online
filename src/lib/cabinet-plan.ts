import {
  formatMskDay,
  formatPriceRub,
  lastFreeDay,
  type AccountBillingState,
  type FreePeriodSettings,
} from "@/lib/billing-period";
import {
  EXTRA_USER_PRICE_RUB,
  SUBSCRIPTION_MAX_USERS,
  employeesGenitiveLabel,
  employeesLabel,
} from "@/lib/plan-catalog";
import { isFreePlan, planLabel } from "@/lib/plan-limits";
import { pluralRu } from "@/lib/plural-ru";
import { discountForPrice, type DiscountKind } from "@/lib/promo/discounts";
import {
  applyPromotion,
  type AppliedPromotion,
  type PriceWithPromotion,
} from "@/lib/promo/promotions";
import { quoteSubscription, type SubscriptionQuote } from "@/lib/subscription-pricing";

/**
 * «Мой кабинет» в меню профиля и «Ваш план» на странице тарифа — чистые
 * функции без `db` (их читают сервер, клиент и тесты).
 *
 * Своего счёта здесь нет: сумма — `quoteSubscription` (подписка + доплата
 * сверх 10), поверх неё акция (`applyPromotion`, как на странице тарифа и в
 * заказе) и скидка навсегда / промокод (`discountForPrice` от цены с акцией,
 * как `PromoPrice`). Число сотрудников и организаций приходит из
 * `loadBillingUnit` — там же мастер-кабинет даёт +1 в каждом пищеблоке.
 */

export type PersonalDiscountInput = { kind: DiscountKind; value: number } | null;

export type SubscriptionTotal = {
  quote: SubscriptionQuote;
  /** Подписка + доплата с акцией — вход `PromoPrice`. */
  withPromotion: PriceWithPromotion;
  /** Скидка навсегда или промокод поверх акции, ₽. */
  personalRub: number;
  /** Итого в месяц после акции и скидки. */
  finalRub: number;
  /** Итог меньше суммы по тарифу (действует акция или скидка). */
  discounted: boolean;
};

export function subscriptionTotal(args: {
  employees: number;
  /** Цена подписки из `PlatformTariff` (без акции). */
  tariffRub: number;
  promotion: AppliedPromotion | null;
  personal: PersonalDiscountInput;
}): SubscriptionTotal {
  const quote = quoteSubscription(args.employees, args.tariffRub);
  const withPromotion = applyPromotion(quote.monthlyRub, args.promotion);
  const personalRub =
    args.personal && !quote.isFree ? discountForPrice(args.personal, withPromotion.priceRub) : 0;
  const finalRub = Math.max(0, withPromotion.priceRub - personalRub);
  return { quote, withPromotion, personalRub, finalRub, discounted: finalRub < quote.monthlyRub };
}

/** «1 990 ₽ + 28 × 100 ₽ сверх 10»; без превышения — null. */
export function overageBreakdown(quote: SubscriptionQuote): string | null {
  if (quote.isFree || quote.extraEmployees === 0) return null;
  return `${formatPriceRub(quote.baseRub)} + ${quote.extraEmployees} × ${formatPriceRub(EXTRA_USER_PRICE_RUB)} сверх ${SUBSCRIPTION_MAX_USERS}`;
}

/** Строки расчёта «Ваш план»: подписка и (если есть) превышение. */
export function planBreakdownRows(quote: SubscriptionQuote): Array<{ label: string; amountRub: number }> {
  if (quote.isFree) return [];
  const rows = [
    { label: `Подписка до ${employeesGenitiveLabel(SUBSCRIPTION_MAX_USERS)}`, amountRub: quote.baseRub },
  ];
  if (quote.extraEmployees > 0) {
    rows.push({
      label: `Сверх ${SUBSCRIPTION_MAX_USERS}: ${quote.extraEmployees} × ${formatPriceRub(EXTRA_USER_PRICE_RUB)}`,
      amountRub: quote.extraRub,
    });
  }
  return rows;
}

/** Название тарифа по полю `subscriptionPlan`: «Подписка», а не «Платный». */
export function tariffName(plan: string | null | undefined): string {
  if (isFreePlan(plan)) return "Бесплатный";
  if ((plan ?? "").trim() === "paid") return "Подписка";
  return planLabel(plan);
}

/** Название тарифа для карточки «Мой кабинет». */
export function cabinetPlanTitle(
  state: AccountBillingState | null,
  settings: FreePeriodSettings | null,
  plan: string
): string {
  switch (state?.kind) {
    case "free_period":
      return settings ? `Подписка — бесплатно по ${formatMskDay(lastFreeDay(settings))}` : "Подписка";
    case "needs_decision":
      return "Нужно выбрать тариф";
    case "free":
      return "Бесплатный";
    case "paid":
      return state.paidUntil ? `Подписка до ${formatMskDay(state.paidUntil)}` : "Подписка";
    default:
      return tariffName(plan);
  }
}

/** Бесплатный тариф сейчас — ссылка «Подключить подписку» вместо «Изменить тариф». */
export function isOnFreeTariff(state: AccountBillingState | null, plan: string): boolean {
  if (state?.kind === "free" || state?.kind === "needs_decision") return true;
  if (state?.kind === "paid" || state?.kind === "free_period") return false;
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

/** Данные карточки «Мой кабинет» — сериализуются из layout'а в шапку. */
export type CabinetPlanCard = {
  title: string;
  /** «5 организаций · 38 сотрудников»; null — не показывать. */
  counts: string | null;
  price: {
    /** Итого в месяц после акции и скидки. */
    finalRub: number;
    /** Сумма по тарифу — зачёркнута, если больше итога. */
    fullRub: number;
    /** «1 990 ₽ + 28 × 100 ₽ сверх 10». */
    breakdown: string | null;
    /** «с 11 октября», «тестовый режим — оплата не списывается». */
    note: string | null;
  } | null;
  link: { href: string; label: string } | null;
};

export const CABINET_PLAN_HREF = "/settings/subscription";

export function buildCabinetPlanCard(args: {
  state: AccountBillingState | null;
  settings: FreePeriodSettings | null;
  plan: string;
  exempt: boolean;
  organizationsCount: number;
  employees: number;
  tariffRub: number;
  promotion: AppliedPromotion | null;
  personal: PersonalDiscountInput;
  canManagePlan: boolean;
  inMobileApp: boolean;
  testMode: boolean;
}): CabinetPlanCard {
  const title = cabinetPlanTitle(args.state, args.settings, args.plan);
  if (!cabinetPlanAccess(args).details) {
    return { title, counts: null, price: null, link: null };
  }
  const onFree = isOnFreeTariff(args.state, args.plan);
  const link = {
    href: CABINET_PLAN_HREF,
    label: onFree ? "Подключить подписку" : "Изменить тариф",
  };
  if (args.exempt) return { title, counts: null, price: null, link };

  const counts = `${organizationsLabel(args.organizationsCount)} · ${employeesLabel(args.employees)}`;
  const total = subscriptionTotal({
    employees: args.employees,
    tariffRub: args.tariffRub,
    promotion: args.promotion,
    personal: args.personal,
  });
  // Бесплатный тариф и численность в его пределах — платить не за что.
  if (onFree || total.quote.isFree) return { title, counts, price: null, link };

  const note =
    args.state?.kind === "free_period" && args.settings
      ? `с ${formatMskDay(args.settings.endsAt)}`
      : args.testMode
        ? "тестовый режим — оплата не списывается"
        : null;
  return {
    title,
    counts,
    price: {
      finalRub: total.finalRub,
      fullRub: total.quote.monthlyRub,
      breakdown: overageBreakdown(total.quote),
      note,
    },
    link,
  };
}
