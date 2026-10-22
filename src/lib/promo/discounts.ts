import { computeDiscountRub } from "./rules";
import { pricingTranslator } from "@/i18n/pricing-messages";
import type { Locale } from "@/i18n/locales";

/**
 * Персональные скидки на подписку — чистые правила без `db`: их
 * импортируют и сервер (сумма заказа), и клиентские компоненты (плашки,
 * пояснения), как `promotions.ts`.
 *
 * Скидок две: введённый промокод и скидка навсегда, привязанная к
 * аккаунту (AccountLifetimeDiscount). Обе считаются от цены подписки С
 * АКЦИЕЙ и НЕ складываются — применяется выгоднейшая из двух. При равной
 * выгоде — скидка навсегда: она и так положена, а использование кода
 * (лимит `maxUses`) не тратится.
 */

export type DiscountKind = "percent" | "fixed";

/** Скидка навсегда аккаунта — для показа (сериализуется в клиент). */
export type LifetimeDiscountView = {
  id: string;
  code: string;
  kind: DiscountKind;
  value: number;
  /** ISO — когда привязана. */
  boundAt: string;
  /** ISO — до какого момента действует (срочная скидка); null — бессрочно. */
  expiresAt?: string | null;
};

/**
 * То, что реально применится к оплате подписки поверх акции. Считает
 * только сервер (`resolveCheckoutDiscount`), клиент показывает.
 */
export type AppliedDiscount = {
  /** code — введённый промокод; lifetime — скидка навсегда аккаунта сама. */
  source: "code" | "lifetime";
  code: string;
  kind: DiscountKind;
  value: number;
  /** Скидка навсегда: привязанная или lifetime-код (привяжется после оплаты). */
  lifetime: boolean;
  /** Скидка в рублях от цены подписки с акцией. */
  discountRub: number;
  /** id AccountLifetimeDiscount — только у source = "lifetime". */
  lifetimeDiscountId: string | null;
  /** Срок lifetime-кода в месяцах (source = "code"); null/нет — бессрочно. */
  durationMonths?: number | null;
  /** ISO — до какого момента действует привязанная скидка (source = "lifetime"). */
  expiresAt?: string | null;
};

/** «22.10.2027» по Москве — срок срочной скидки на плашках. */
export function formatDiscountUntil(iso: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "Europe/Moscow",
  }).format(new Date(iso));
}

/** «−10 %» / «−500 ₽» с неразрывным пробелом — для плашек. */
function amountLabel(d: { kind: DiscountKind; value: number }, locale: Locale): string {
  const t = pricingTranslator(locale);
  return d.kind === "percent"
    ? t("discount.percent", { value: d.value })
    : t("discount.fixed", { value: d.value });
}

/**
 * Подпись плашки: «Ваша скидка −10 % навсегда», «Ваша скидка −50 % до
 * 22.10.2027», «Промокод ROMASHKA10: −10 % навсегда», «Промокод YEAR50:
 * −50 % на 12 месяцев», «Промокод START30: −30 %».
 */
export function discountLabel(
  d: Pick<AppliedDiscount, "source" | "code" | "kind" | "value" | "lifetime"> &
    Partial<Pick<AppliedDiscount, "durationMonths" | "expiresAt">>,
  locale: Locale = "ru",
): string {
  const t = pricingTranslator(locale);
  const amount = amountLabel(d, locale);
  if (d.source === "lifetime") {
    return d.expiresAt
      ? t("discount.lifetimeUntil", { amount, date: formatDiscountUntil(d.expiresAt) })
      : t("discount.lifetime", { amount });
  }
  if (d.lifetime && d.durationMonths) {
    return t("discount.promoCodeMonths", { code: d.code, amount, months: d.durationMonths });
  }
  return t("discount.promoCode", { code: d.code, amount, lifetime: d.lifetime ? "yes" : "no" });
}

/** Скидка в рублях от другой цены (доплата за сотрудников, цена без акции). */
export function discountForPrice(d: Pick<AppliedDiscount, "kind" | "value">, priceRub: number): number {
  return computeDiscountRub(d, priceRub);
}

export type BestDiscount = {
  source: "code" | "lifetime" | null;
  /** Скидка выбранного источника, ₽. */
  discountRub: number;
  /** Сколько дал бы каждый — для пояснения человеку. */
  codeRub: number;
  lifetimeRub: number;
};

/**
 * Выгоднейшая из двух: введённый код или скидка навсегда. Не складываются.
 * Равны — скидка навсегда. Ноль рублей (цена 0) — скидки нет.
 */
export function pickBestDiscount(input: {
  offerRub: number;
  code: { kind: DiscountKind; value: number } | null;
  lifetime: { kind: DiscountKind; value: number } | null;
}): BestDiscount {
  const codeRub = input.code ? computeDiscountRub(input.code, input.offerRub) : 0;
  const lifetimeRub = input.lifetime ? computeDiscountRub(input.lifetime, input.offerRub) : 0;
  if (input.lifetime && lifetimeRub > 0 && lifetimeRub >= codeRub) {
    return { source: "lifetime", discountRub: lifetimeRub, codeRub, lifetimeRub };
  }
  if (input.code && codeRub > 0) {
    return { source: "code", discountRub: codeRub, codeRub, lifetimeRub };
  }
  return { source: null, discountRub: 0, codeRub, lifetimeRub };
}

/**
 * Пояснение человеку, что применено и почему. null — пояснять нечего
 * (одна скидка без выбора и без «навсегда»).
 */
export function appliedDiscountNotice(input: {
  applied: AppliedDiscount | null;
  lifetime: Pick<LifetimeDiscountView, "code" | "kind" | "value" | "expiresAt"> | null;
  /** Введённый код (нормализованный) или null. */
  typedCode: string | null;
}): string | null {
  const { applied, lifetime, typedCode } = input;
  if (!applied) return null;
  const lifetimeText = lifetime ? amountLabel(lifetime, "ru") : "";
  // Срочная закреплённая скидка — «до 22.10.2027», обычная — «навсегда».
  const lifetimeWord = lifetime?.expiresAt ? `до ${formatDiscountUntil(lifetime.expiresAt)}` : "навсегда";
  if (applied.source === "lifetime") {
    if (!typedCode) return null;
    if (lifetime && typedCode === lifetime.code) {
      return `Промокод ${typedCode} уже работает у вас как скидка ${lifetimeWord} — вводить его не нужно.`;
    }
    return `Ваша скидка ${lifetimeWord} (${lifetimeText}) выгоднее промокода ${typedCode} — применили её. Скидки не складываются.`;
  }
  if (lifetime) {
    return applied.lifetime
      ? `Промокод ${applied.code} выгоднее вашей скидки ${lifetimeWord} (${lifetimeText}) — применили его. Он тоже закрепляется за аккаунтом: после оплаты заменит прежнюю скидку.`
      : `Промокод ${applied.code} выгоднее вашей скидки ${lifetimeWord} (${lifetimeText}) — применили его к этой оплате. Скидки не складываются: следующие оплаты — снова со скидкой ${lifetimeWord}.`;
  }
  if (applied.lifetime && applied.durationMonths) {
    return `Скидка на ${monthsRu(applied.durationMonths)}: после оплаты она закрепится за аккаунтом и сама применится к каждой оплате подписки в течение этого срока.`;
  }
  if (applied.lifetime) {
    return "Скидка навсегда: после оплаты она закрепится за аккаунтом и будет применяться к каждой следующей оплате подписки сама.";
  }
  return null;
}

/**
 * Срок закрепляемой скидки для текстов (описание заказа, чек): «навсегда»,
 * «на 12 месяцев» (код со сроком) или «до 22.10.2027» (уже закреплённая).
 */
export function lifetimeTerm(d: Pick<AppliedDiscount, "source"> & Partial<Pick<AppliedDiscount, "durationMonths" | "expiresAt">>): string {
  if (d.source === "lifetime") return d.expiresAt ? `до ${formatDiscountUntil(d.expiresAt)}` : "навсегда";
  return d.durationMonths ? `на ${monthsRu(d.durationMonths)}` : "навсегда";
}

/** «1 месяц», «3 месяца», «12 месяцев». */
export function monthsRu(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  const word =
    mod10 === 1 && mod100 !== 11 ? "месяц" : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? "месяца" : "месяцев";
  return `${n} ${word}`;
}
