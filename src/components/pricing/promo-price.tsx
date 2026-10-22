import { BadgePercent, Infinity as InfinityIcon, Ticket } from "lucide-react";

import {
  discountForPrice,
  discountLabel,
  type AppliedDiscount,
} from "@/lib/promo/discounts";
import {
  promotionBadgeLabel,
  promotionEndHint,
  type AppliedPromotion,
  type PriceWithPromotion,
} from "@/lib/promo/promotions";
import { cn } from "@/lib/utils";
import type { SiteLocale } from "@/i18n/site-locale";
import { FORMAT_LOCALES } from "@/i18n/locales";
import { pricingTranslator } from "@/i18n/pricing-messages";

/**
 * Цена подписки с акцией — один компонент на все витрины: лендинг,
 * /pricing, кабинет, /order, калькуляторы. В период акции старая цена
 * зачёркнута, рядом новая и плашка «−N % до <дата>»; без акции — просто
 * цена, как раньше.
 *
 * Персональная скидка (`personal`: введённый промокод или скидка навсегда
 * аккаунта) — так же: считается от цены с акцией, старая цена зачёркнута,
 * плашка «Ваша скидка −10 % навсегда» / «Промокод X: −10 %».
 *
 * Намеренно без "use client" и без хуков (как `PlanCard`): остаётся
 * серверным на лендинге и попадает в клиентский бандл, когда его
 * импортирует клиентский компонент. Даты форматируются без Intl-часовых
 * поясов (lib/promo/promotions.ts) — сервер и браузер рисуют одно и то же.
 *
 * Цифры приходят с сервера (`getSubscriptionOffer` / `getDisplayOffer`
 * или `applyPromotion` от того же `promotion`; скидка — от
 * `resolveCheckoutDiscount`) — компонент ничего не решает, только показывает.
 */

/** text — как окружающий текст (цена внутри абзаца), sm — полужирная в строке. */
type Size = "text" | "sm" | "md" | "lg" | "xl";
/** inherit — цвет новой цены от родителя (абзац, строка-ссылка). */
type Tone = "light" | "dark" | "inherit";

/** Персональная скидка для показа: размер пересчитывается от цены компонента. */
export type PersonalDiscount = Pick<AppliedDiscount, "source" | "code" | "kind" | "value" | "lifetime"> &
  Partial<Pick<AppliedDiscount, "durationMonths" | "expiresAt">>;

const NEW_SIZE: Record<Size, string> = {
  text: "",
  sm: "font-semibold",
  md: "text-[22px] font-semibold leading-none tracking-[-0.01em]",
  lg: "text-[26px] font-semibold leading-none tracking-[-0.01em]",
  xl: "text-[34px] font-semibold leading-none tracking-[-0.02em]",
};
const OLD_SIZE: Record<Size, string> = {
  text: "",
  sm: "",
  md: "text-[14px]",
  lg: "text-[15px]",
  xl: "text-[18px]",
};

export function formatPriceRub(value: number, locale: SiteLocale = "ru"): string {
  return `${new Intl.NumberFormat(FORMAT_LOCALES[locale]).format(value)} ₽`;
}

export function PromoBadge({
  locale = "ru",
  promotion,
  tone = "light",
  className,
}: {
  promotion: Pick<AppliedPromotion, "percent" | "endsAt" | "title">;
  locale?: SiteLocale;
  tone?: "light" | "dark";
  className?: string;
}) {
  return (
    <span
      data-promo-badge
      title={`${promotion.title}. ${promotionEndHint(promotion, locale)}`}
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[12px] font-medium leading-[1.4] tracking-normal",
        tone === "dark"
          ? "border-[#7cf5c0]/40 bg-[#7cf5c0]/15 text-[#7cf5c0]"
          : "border-[#c8f0d5] bg-[#ecfdf5] text-[#116b2a]",
        className,
      )}
    >
      <BadgePercent aria-hidden className="size-3.5 shrink-0" />
      {promotionBadgeLabel(promotion, locale)}
    </span>
  );
}

/** «Ваша скидка −10 % навсегда» / «Промокод X: −50 % на 12 месяцев» / «Промокод X: −10 %». */
export function PersonalDiscountBadge({
  locale = "ru",
  discount,
  tone = "light",
  className,
}: {
  discount: PersonalDiscount;
  locale?: SiteLocale;
  tone?: "light" | "dark";
  className?: string;
}) {
  // Бесконечность — только у бессрочной скидки; срочная («на 12 месяцев») — билет.
  const Icon = discount.lifetime && !discount.durationMonths && !discount.expiresAt ? InfinityIcon : Ticket;
  return (
    <span
      data-personal-badge
      data-discount-source={discount.source}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[12px] font-medium leading-[1.4] tracking-normal",
        tone === "dark"
          ? "border-white/25 bg-white/10 text-white"
          : "border-[#c7ccea] bg-[#eef1ff] text-[#3848c7]",
        className,
      )}
    >
      <Icon aria-hidden className="size-3.5 shrink-0" />
      {discountLabel(discount, locale)}
    </span>
  );
}

export function PromoPrice({
  locale = "ru",
  price,
  personal = null,
  size = "sm",
  tone = "light",
  layout = "inline",
  suffix,
  showBadge = true,
  className,
}: {
  price: Pick<PriceWithPromotion, "baseRub" | "priceRub" | "promotion">;
  locale?: SiteLocale;
  /** Персональная скидка поверх акции — от price.priceRub. */
  personal?: PersonalDiscount | null;
  size?: Size;
  tone?: Tone;
  /**
   * inline — «~~1 990 ₽~~ 1 592 ₽/мес [−20 %…]» в строку (с переносом);
   * stacked — зачёркнутая цена и плашка строкой выше крупной новой цены
   * (карточки тарифов, плитки).
   */
  layout?: "inline" | "stacked";
  /** «/мес», «в месяц» — после новой цены. */
  suffix?: React.ReactNode;
  showBadge?: boolean;
  className?: string;
}) {
  const t = pricingTranslator(locale);
  const promotion = price.promotion && price.priceRub < price.baseRub ? price.promotion : null;
  const personalRub = personal ? discountForPrice(personal, price.priceRub) : 0;
  const personalActive = personal && personalRub > 0 ? personal : null;
  const finalRub = Math.max(0, price.priceRub - personalRub);
  const newTone = tone === "dark" ? "text-white" : tone === "light" ? "text-[#0b1024]" : "";
  const oldTone = tone === "dark" ? "text-white/50" : "text-[#9b9fb3]";

  if (!promotion && !personalActive) {
    return (
      <span data-testid="promo-price" data-promo-active="false" className={cn("tabular-nums", className)}>
        <span data-promo-new className={cn(NEW_SIZE[size], newTone)}>
          {formatPriceRub(price.priceRub, locale)}
        </span>
        {suffix}
      </span>
    );
  }

  const oldPrice = (
    <s data-promo-old className={cn("tabular-nums decoration-[1.5px]", OLD_SIZE[size], oldTone)}>
      <span className="sr-only">{promotion ? t("price.regularBeforePromotion") : t("price.regularBeforeDiscount")}</span>
      {formatPriceRub(price.baseRub, locale)}
    </s>
  );
  const newPrice = (
    <span className="whitespace-nowrap">
      <span data-promo-new className={cn("tabular-nums", NEW_SIZE[size], newTone)}>
        <span className="sr-only">{t("price.discountedPrice")}</span>
        {formatPriceRub(finalRub, locale)}
      </span>
      {suffix}
    </span>
  );
  const badgeTone = tone === "dark" ? "dark" : "light";
  const badges = showBadge ? (
    <>
      {promotion ? <PromoBadge locale={locale} promotion={promotion} tone={badgeTone} /> : null}
      {personalActive ? <PersonalDiscountBadge locale={locale} discount={personalActive} tone={badgeTone} /> : null}
    </>
  ) : null;
  const dataAttrs = {
    "data-testid": "promo-price",
    "data-promo-active": promotion ? "true" : "false",
    "data-promo-percent": promotion?.percent,
    "data-personal-discount": personalActive ? "true" : undefined,
    "data-discount-source": personalActive?.source,
  };

  if (layout === "stacked") {
    return (
      <span {...dataAttrs} className={cn("flex flex-col gap-1.5", className)}>
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {oldPrice}
          {badges}
        </span>
        {newPrice}
      </span>
    );
  }

  return (
    <span {...dataAttrs} className={cn("inline-flex flex-wrap items-baseline gap-x-1.5 gap-y-1", className)}>
      {oldPrice}
      {newPrice}
      {badges ? <span className="inline-flex flex-wrap items-center gap-1 self-center">{badges}</span> : null}
    </span>
  );
}
