import { computeDiscountRub, describeDiscount } from "./rules";

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
};

const NBSP = " ";

/** «−10 %» / «−500 ₽» с неразрывным пробелом — для плашек. */
function amountLabel(d: { kind: DiscountKind; value: number }): string {
  return describeDiscount(d).replace(" ", NBSP);
}

/**
 * Подпись плашки: «Ваша скидка −10 % навсегда», «Промокод ROMASHKA10:
 * −10 % навсегда», «Промокод START30: −30 %».
 */
export function discountLabel(
  d: Pick<AppliedDiscount, "source" | "code" | "kind" | "value" | "lifetime">
): string {
  if (d.source === "lifetime") return `Ваша скидка ${amountLabel(d)} навсегда`;
  return `Промокод ${d.code}: ${amountLabel(d)}${d.lifetime ? " навсегда" : ""}`;
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
  lifetime: Pick<LifetimeDiscountView, "code" | "kind" | "value"> | null;
  /** Введённый код (нормализованный) или null. */
  typedCode: string | null;
}): string | null {
  const { applied, lifetime, typedCode } = input;
  if (!applied) return null;
  const lifetimeText = lifetime ? amountLabel(lifetime) : "";
  if (applied.source === "lifetime") {
    if (!typedCode) return null;
    if (lifetime && typedCode === lifetime.code) {
      return `Промокод ${typedCode} уже работает у вас как скидка навсегда — вводить его не нужно.`;
    }
    return `Ваша скидка навсегда (${lifetimeText}) выгоднее промокода ${typedCode} — применили её. Скидки не складываются.`;
  }
  if (lifetime) {
    return applied.lifetime
      ? `Промокод ${applied.code} выгоднее вашей скидки навсегда (${lifetimeText}) — применили его. Он тоже навсегда: после оплаты заменит прежнюю скидку.`
      : `Промокод ${applied.code} выгоднее вашей скидки навсегда (${lifetimeText}) — применили его к этой оплате. Скидки не складываются: следующие оплаты — снова со скидкой навсегда.`;
  }
  if (applied.lifetime) {
    return "Скидка навсегда: после оплаты она закрепится за аккаунтом и будет применяться к каждой следующей оплате подписки сама.";
  }
  return null;
}
