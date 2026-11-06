import { COMPANY_EMAIL, COMPANY_MOBILE, COMPANY_PHONE } from "@/lib/company-contacts";
import { applyPromotion, type AppliedPromotion } from "./promotions";
import { discountForPrice } from "./discounts";
import {
  CYCLE_MONTHS,
  planPeriodPriceRub,
  type BillingCycle,
  type PaidTier,
  type PlanRates,
} from "@/lib/tariff-plans";

/**
 * Акция по визитке (04.11.2026): QR на обороте ведёт на `/vizitka`, там код
 * уже применён — человек видит цену «Стандарта» и «Премиума» со скидкой и
 * сразу идёт на оплату (`/order?…&promo=VIZITKA10`, код подставит сама
 * страница оформления). Код живёт в `PromoCode` (scripts/seed-card-promo.ts):
 * −10 % на первую оплату, только новым клиентам, без срока и лимита.
 */
export const CARD_PROMO_CODE = "VIZITKA10";
export const CARD_PROMO_PATH = "/vizitka";
export const CARD_PROMO_URL = `https://wesetup.ru${CARD_PROMO_PATH}`;

/** Запись кода для скрипта — одна на всю акцию. */
export const CARD_PROMO_RECORD = {
  code: CARD_PROMO_CODE,
  kind: "percent" as const,
  value: 10,
  startsAt: null,
  endsAt: null,
  maxUses: null,
  newClientsOnly: true,
  lifetime: false,
  note: "Акция по визитке: QR на обороте → wesetup.ru/vizitka, −10 % на первую оплату новым клиентам, без срока.",
};

export type CardDiscount = { kind: "percent" | "fixed"; value: number };

export type CardTierPrice = {
  tier: PaidTier;
  cycle: BillingCycle;
  /** Цена периода без кода (с действующей ценовой акцией, если она идёт). */
  periodBaseRub: number;
  /** Цена периода с кодом — столько возьмёт оплата. */
  periodFinalRub: number;
  /** То же в пересчёте на месяц — крупная цифра карточки. */
  monthlyBaseRub: number;
  monthlyFinalRub: number;
  /** Сколько экономит код за период. */
  savingRub: number;
};

/**
 * Цена тарифа на странице акции: база из `PlatformTariff` → действующая
 * ценовая акция → код (коды считаются от цены по акции — как на оплате,
 * `discountForPrice`). Сумму к оплате всё равно пересчитает `/order`.
 * Нет кода (`discount = null`) — цены без скидки, экономия 0.
 */
export function cardTierPrice(
  rates: PlanRates,
  tier: PaidTier,
  cycle: BillingCycle,
  promotion: AppliedPromotion | null,
  discount: CardDiscount | null,
): CardTierPrice {
  const periodBaseRub = applyPromotion(planPeriodPriceRub(rates, tier, cycle), promotion).priceRub;
  const savingRub = discount ? discountForPrice(discount, periodBaseRub) : 0;
  const periodFinalRub = Math.max(0, periodBaseRub - savingRub);
  const months = CYCLE_MONTHS[cycle];
  return {
    tier,
    cycle,
    periodBaseRub,
    periodFinalRub,
    monthlyBaseRub: Math.round(periodBaseRub / months),
    monthlyFinalRub: Math.round(periodFinalRub / months),
    savingRub,
  };
}

/** Куда ведёт кнопка оплаты: оформление с тарифом, периодом и кодом. */
export function cardOrderHref(tier: PaidTier, cycle: BillingCycle, withCode: boolean): string {
  const params = new URLSearchParams({ plan: tier, cycle });
  if (withCode) params.set("promo", CARD_PROMO_CODE);
  return `/order?${params.toString()}`;
}

/** vCard для кнопки «Сохранить контакт» (латиницей в имени — читается любым телефоном). */
export function cardVcard(): string {
  return [
    "BEGIN:VCARD",
    "VERSION:3.0",
    "N:;WeSetup;;;",
    "FN:WeSetup — сетап",
    "ORG:WeSetup",
    `TEL;TYPE=WORK:${COMPANY_PHONE.tel}`,
    `TEL;TYPE=CELL:${COMPANY_MOBILE.tel}`,
    `EMAIL:${COMPANY_EMAIL}`,
    `URL:${CARD_PROMO_URL}`,
    "END:VCARD",
    "",
  ].join("\r\n");
}
