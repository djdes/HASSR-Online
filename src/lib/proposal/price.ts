import { computeCheckoutAmounts, promotionEndLabel, type AppliedPromotion } from "@/lib/promo/promotions";
import { computeDiscountRub } from "@/lib/promo/rules";

import type { ProposalPromo } from "./types";

/**
 * Цена подписки в КП — тем же порядком, что на оплате
 * (`computeCheckoutAmounts`): база тарифа → действующая акция → промокод
 * от цены с акцией. Чистая функция: тариф и акцию читает сервер на момент
 * отрисовки (`context.server.ts`), здесь только арифметика и подписи.
 */

export type ProposalPrice = {
  /** Цена тарифа без скидок, ₽/мес. */
  baseRub: number;
  /** Цена к оплате за месяц: акция и промокод учтены. */
  priceRub: number;
  /** Зачёркнутая цена — база, если к оплате меньше; иначе null. */
  oldRub: number | null;
  /** Действующая акция, которая реально уменьшила цену. */
  promotion: AppliedPromotion | null;
  /** Промокод, который применён (не истёк, скидка больше нуля). */
  promo: ProposalPromo | null;
  /** Промокод передан, но срок уже прошёл — цена без него. */
  promoExpired: boolean;
  /** «−10 %» / «−500 ₽» — размер скидки промокода. */
  discountLabel: string | null;
  /** «навсегда» / «до 10 октября» / null — срок скидки промокода. */
  promoTerm: string | null;
  /**
   * Скидка навсегда поверх акции: сколько будет стоить месяц, когда акция
   * кончится (база минус та же скидка). null — не нужно пояснять.
   */
  afterPromotionRub: number | null;
};

const NBSP = "\u00a0";

/** «1 990 ₽» — с неразрывными пробелами (шрифт PDF и письма их знает). */
export function formatProposalRub(value: number): string {
  const digits = new Intl.NumberFormat("ru-RU").format(Math.round(value)).replace(/\s/g, NBSP);
  return `${digits}${NBSP}₽`;
}

export function promoDiscountLabel(promo: Pick<ProposalPromo, "kind" | "value">): string {
  return promo.kind === "percent"
    ? `−${promo.value}${NBSP}%`
    : `−${formatProposalRub(promo.value)}`;
}

/** Промокод истёк к моменту `now` — та же граница, что у `validatePromo` («позже endsAt»). */
export function isProposalPromoExpired(promo: Pick<ProposalPromo, "endsAt">, now: Date): boolean {
  return promo.endsAt !== null && now.getTime() > promo.endsAt.getTime();
}

export function computeProposalPrice(input: {
  baseRub: number;
  promotion: AppliedPromotion | null;
  promo: ProposalPromo | null | undefined;
  now: Date;
}): ProposalPrice {
  const promo = input.promo ?? null;
  const expired = promo ? isProposalPromoExpired(promo, input.now) : false;
  const usable = promo && !expired && Number.isFinite(promo.value) && promo.value > 0 ? promo : null;

  const amounts = computeCheckoutAmounts({
    baseRub: input.baseRub,
    promotion: input.promotion,
    promo: usable ? { kind: usable.kind, value: usable.value } : null,
  });
  const promotion = amounts.promotionDiscountRub > 0 ? input.promotion : null;
  const applied = usable && amounts.promoDiscountRub > 0 ? usable : null;
  const priceRub = amounts.subscriptionRub;

  let afterPromotionRub: number | null = null;
  if (promotion && applied?.lifetime) {
    afterPromotionRub = Math.max(0, amounts.baseRub - computeDiscountRub(applied, amounts.baseRub));
  }

  return {
    baseRub: amounts.baseRub,
    priceRub,
    oldRub: priceRub < amounts.baseRub ? amounts.baseRub : null,
    promotion,
    promo: applied,
    promoExpired: Boolean(promo && expired),
    discountLabel: applied ? promoDiscountLabel(applied) : null,
    promoTerm: applied ? (applied.lifetime ? "навсегда" : applied.endsAt ? promotionEndLabel(applied.endsAt) : null) : null,
    afterPromotionRub,
  };
}
