import { formatMskDate, type AccountBillingState } from "@/lib/billing-period";
import { loadAccountBilling } from "@/lib/billing.server";
import { db } from "@/lib/db";
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
      /** Подписка, от которой посчитан переход, — снимок в заказ (`basePlanJson`). */
      base: CurrentSubscription | null;
    }
  | {
      ok: false;
      status: number;
      error: string;
      code: "unavailable" | "scheduled" | "points" | "account";
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

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Без кабинета организации (гость или сотрудник) заказ считается новой
 * подпиской, а вебхук применяет его к аккаунту, найденному по почте заказа
 * (`payment-fulfillment.ts`). Сотруднику аккаунта с идущим оплаченным сроком
 * отказываем: новая подписка заменила бы тариф и точки и начала бы срок
 * заново — продлевает и меняет тариф руководитель в кабинете, где сумма
 * считается от текущей подписки (продление, доплата, зачёт остатка).
 */
const PAID_ACCOUNT_ERROR =
  "У вашей организации уже оплачен тариф. Продлить или сменить его может руководитель в кабинете — «Настройки → Тариф и оплата»: там сумма посчитается с учётом оплаченных дней.";
/**
 * Гостю (без входа) по почте существующего аккаунта — вход, без подробностей:
 * ответ не должен выдавать, платит ли владелец этой почты.
 */
const GUEST_ACCOUNT_ERROR =
  "Для этой почты уже есть аккаунт WeSetup. Войдите в кабинет и оплатите тариф там — сумма посчитается с учётом вашей подписки.";

/**
 * ROOT в «войти как» за клиента не платит: заказ ушёл бы с почтой ROOT без
 * организации, и вебхук применил бы тариф к платформе, а не к клиенту.
 */
export const IMPERSONATION_CHECKOUT_ERROR =
  "В режиме «войти как» оплатить нельзя — тариф оплачивает руководитель клиента в своём кабинете.";

/** Оплаченная подписка из состояния тарифа — так её видит расчёт перехода. */
export function subscriptionFromState(state: AccountBillingState): CurrentSubscription | null {
  return state.kind === "paid" && state.paidTier
    ? { paidUntil: state.paidUntil, tier: state.paidTier, cycle: state.planCycle, points: state.planPoints }
    : null;
}

/** Текущая оплаченная подписка аккаунта организации и точки в работе. */
export async function accountSubscription(
  organizationId: string,
  now: Date
): Promise<{ current: CurrentSubscription | null; pointsInUse: number }> {
  const loaded = await loadAccountBilling(organizationId, now);
  if (!loaded) return { current: null, pointsInUse: 1 };
  return { pointsInUse: loaded.state.pointsInUse, current: subscriptionFromState(loaded.state) };
}

export async function quoteCheckout(args: {
  organizationId: string | null;
  target: CheckoutTarget;
  now: Date;
  /** Плательщик без кабинета организации (гость или сотрудник) — проверка выше. */
  payer?: { email: string; guest: boolean } | null;
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
    ({ current, pointsInUse } = await accountSubscription(args.organizationId, now));
  } else if (args.payer?.email) {
    const user = await db.user.findUnique({ where: { email: args.payer.email }, select: { organizationId: true } });
    if (user && args.payer.guest) {
      return { ok: false, status: 409, code: "account", error: GUEST_ACCOUNT_ERROR };
    }
    const payerAccount = user ? await accountSubscription(user.organizationId, now) : null;
    const paidUntil = payerAccount?.current?.paidUntil;
    if (paidUntil && paidUntil.getTime() - now.getTime() >= DAY_MS) {
      return { ok: false, status: 409, code: "account", error: PAID_ACCOUNT_ERROR };
    }
    // Точки в работе — как у руководителя: меньше, чем работает, не оплатить.
    // Срок на исходе (меньше суток) — расчёт и снимок в заказе от настоящей
    // подписки, иначе оплата сочла бы заказ устаревшим.
    if (payerAccount) {
      pointsInUse = payerAccount.pointsInUse;
      current = payerAccount.current;
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
      error: `Переход на этот тариф — с окончания оплаченного срока, ${formatMskDate(change.periodStart)}. Сейчас платить не нужно — переход можно запланировать на странице тарифа.`,
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
    base: current,
  };
}
