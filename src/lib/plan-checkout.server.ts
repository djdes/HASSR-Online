import { formatMskDay, lastDayBefore } from "@/lib/billing-period";
import { loadAccountBilling } from "@/lib/billing.server";
import { pointsLabel } from "@/lib/cabinet-plan";
import { planOrderTitle } from "@/lib/plan-payment";
import { readActivePromotion } from "@/lib/promo/offer";
import { applyPromotion, type SubscriptionOffer } from "@/lib/promo/promotions";
import {
  CYCLE_DAYS,
  isBillingCycle,
  isPaidTier,
  normalizePoints,
  parsePlanTariffKey,
  planTariffKey,
  quotePlanChange,
  resolvePlanTariffKey,
  type CurrentSubscription,
  type PlanChangeQuote,
  type PlanTarget,
} from "@/lib/tariff-plans";
import { readPlanPricing } from "@/lib/tariffs";

/**
 * Сумма к оплате тарифа 2026-10 — ОДНА функция на страницу заказа,
 * создание платежа в Робокассе, проверку промокода и счёт по безналу.
 * Браузер сумму не считает и не присылает: только тариф, период и точки.
 *
 * Порядок: цена тарифа × точки (от трёх −5 % на каждую) → вид перехода
 * от текущей подписки аккаунта (`quotePlanChange`: новая, продление,
 * доплата за остаток, переход на год с зачётом) → действующая акция.
 * Промокод/скидка навсегда и баллы считает вызывающий код поверх
 * `offer.priceRub`, как и раньше.
 */

export type CheckoutTarget = PlanTarget;

export type CheckoutQuote =
  | {
      ok: true;
      target: CheckoutTarget;
      tariffKey: string;
      /** «Тариф «Премиум» за год, 2 точки». */
      title: string;
      periodDays: number;
      change: PlanChangeQuote;
      /** База = сумма к оплате по виду перехода; цена с акцией — `priceRub`. */
      offer: SubscriptionOffer;
      /** Точек сейчас в работе (у аккаунта). */
      pointsInUse: number;
    }
  | {
      ok: false;
      status: number;
      error: string;
      code: "unavailable" | "scheduled" | "points";
      /** Для scheduled — с какого дня можно перейти. */
      effectiveAt?: string;
    };

/**
 * Тариф из адреса/тела запроса: `plan=standard&cycle=year&points=2` или
 * ключ тарифа (`tariffKey=premium_month`, старые `monthly`/`bundle`).
 */
export function parseCheckoutTarget(input: {
  plan?: unknown;
  cycle?: unknown;
  points?: unknown;
  tariffKey?: unknown;
}): CheckoutTarget | null {
  const fromKey = parsePlanTariffKey(resolvePlanTariffKey(typeof input.tariffKey === "string" ? input.tariffKey : ""));
  const planRaw = typeof input.plan === "string" ? input.plan.trim() : "";
  const fromPlanKey = parsePlanTariffKey(resolvePlanTariffKey(planRaw));
  const tier = isPaidTier(planRaw) ? planRaw : (fromPlanKey?.tier ?? fromKey?.tier ?? null);
  if (!tier) return null;
  const cycle = isBillingCycle(input.cycle) ? input.cycle : (fromPlanKey?.cycle ?? fromKey?.cycle ?? "year");
  return { tier, cycle, points: normalizePoints(input.points ?? 1) };
}

export async function quoteCheckout(args: {
  organizationId: string | null;
  target: CheckoutTarget;
  now: Date;
}): Promise<CheckoutQuote> {
  const { now } = args;
  const target = { ...args.target, points: normalizePoints(args.target.points) };
  const pricing = await readPlanPricing();
  if (!pricing.available[target.tier][target.cycle]) {
    return { ok: false, status: 400, error: "Тариф недоступен", code: "unavailable" };
  }

  let current: CurrentSubscription | null = null;
  let pointsInUse = 1;
  if (args.organizationId) {
    const loaded = await loadAccountBilling(args.organizationId, now);
    if (loaded) {
      pointsInUse = loaded.state.pointsInUse;
      if (loaded.state.kind === "paid" && loaded.state.paidTier) {
        current = {
          paidUntil: loaded.state.paidUntil,
          tier: loaded.state.paidTier,
          cycle: loaded.state.planCycle,
          points: loaded.state.planPoints,
        };
      }
    }
  }
  if (target.points < pointsInUse) {
    return {
      ok: false,
      status: 409,
      code: "points",
      error: `Сейчас в работе ${pointsLabel(pointsInUse)} — выберите не меньше или сначала удалите лишние точки.`,
    };
  }

  const change = quotePlanChange({ rates: pricing.rates, legacyMonthlyRub: pricing.legacyMonthlyRub, current, target, now });
  if (change.kind === "scheduled") {
    return {
      ok: false,
      status: 409,
      code: "scheduled",
      error: `Переход на этот тариф — с ${formatMskDay(change.periodStart)}: до ${formatMskDay(lastDayBefore(change.periodStart))} включительно действует оплаченный тариф. Сейчас платить не нужно — переход можно запланировать на странице тарифа.`,
      effectiveAt: change.periodStart.toISOString(),
    };
  }

  const promotion = await readActivePromotion(now).catch((error) => {
    console.error("[billing] active promotion read failed — quote without it", error);
    return null;
  });
  const price = applyPromotion(change.amountRub, promotion);
  const tariffKey = planTariffKey(target.tier, target.cycle);
  const title = planOrderTitle(target.tier, target.cycle, target.points);
  return {
    ok: true,
    target,
    tariffKey,
    title,
    periodDays: CYCLE_DAYS[target.cycle],
    change,
    offer: {
      ...price,
      tariffKey,
      tariffTitle: title,
      periodDays: CYCLE_DAYS[target.cycle],
      promotionEndsAt: price.promotion?.endsAt ?? null,
    },
    pointsInUse,
  };
}
