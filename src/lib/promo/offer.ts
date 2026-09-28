import { db } from "@/lib/db";
import { readTariff, TARIFF_MONTHLY, type Tariff } from "@/lib/tariffs";

import {
  applyPromotion,
  pickActivePromotion,
  toAppliedPromotion,
  type AppliedPromotion,
  type SubscriptionOffer,
} from "./promotions";

/**
 * Цена подписки на сервере — одна точка для витрин и оплаты.
 *
 * `getSubscriptionOffer` — «сколько стоит тариф сейчас»: база из
 * `PlatformTariff`, действующая акция и цена со скидкой в целых рублях.
 * Её зовут создание заказа, проверка промокода и счёт по безналу; витрины
 * берут то же самое через `getDisplayOffer` (тариф у них уже прочитан) и
 * отдают результат пропсами в компонент `PromoPrice`. Браузер сумму не
 * считает и не присылает — только показывает то, что посчитал сервер.
 */

/** Действующая акция (или null). Окна пересекаются — берём наибольший процент. */
export async function readActivePromotion(now: Date = new Date()): Promise<AppliedPromotion | null> {
  const rows = await db.pricePromotion.findMany({
    where: { active: true, startsAt: { lte: now }, endsAt: { gt: now } },
    select: { id: true, title: true, percent: true, startsAt: true, endsAt: true, active: true },
  });
  const best = pickActivePromotion(rows, now);
  return best ? toAppliedPromotion(best) : null;
}

function toOffer(
  tariff: Pick<Tariff, "key" | "title" | "priceRub" | "periodDays">,
  promotion: AppliedPromotion | null
): SubscriptionOffer {
  const price = applyPromotion(tariff.priceRub, promotion);
  return {
    ...price,
    tariffKey: tariff.key,
    tariffTitle: tariff.title,
    periodDays: tariff.periodDays,
    promotionEndsAt: price.promotion?.endsAt ?? null,
  };
}

/**
 * Цена тарифа на момент `now` с учётом акции. null — тариф неизвестен или
 * снят с продажи (оплата по нему невозможна). Ошибки БД не глотает: сумму
 * к оплате нельзя «угадывать».
 */
export async function getSubscriptionOffer(
  now: Date = new Date(),
  tariffKey: string = TARIFF_MONTHLY
): Promise<SubscriptionOffer | null> {
  const [tariff, promotion] = await Promise.all([readTariff(tariffKey), readActivePromotion(now)]);
  if (!tariff) return null;
  return toOffer(tariff, promotion);
}

/**
 * Для витрин (лендинг, /pricing, кабинет, /order до оплаты): цена уже
 * прочитанного тарифа с действующей акцией. Сбой чтения акций не должен
 * ронять страницу — покажем без акции, а сумму к оплате всё равно
 * пересчитает `getSubscriptionOffer` при создании заказа.
 */
export async function getDisplayOffer(
  tariff: Pick<Tariff, "key" | "title" | "priceRub" | "periodDays">,
  now: Date = new Date()
): Promise<SubscriptionOffer> {
  const promotion = await readActivePromotion(now).catch((error) => {
    console.error("[promo] active promotion read failed", error);
    return null;
  });
  return toOffer(tariff, promotion);
}
