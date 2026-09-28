import { BadgePercent } from "lucide-react";

import {
  promotionBadgeLabel,
  promotionEndHint,
  type AppliedPromotion,
  type PriceWithPromotion,
} from "@/lib/promo/promotions";
import { cn } from "@/lib/utils";

/**
 * Цена подписки с акцией — один компонент на все витрины: лендинг,
 * /pricing, кабинет, /order, калькуляторы. В период акции старая цена
 * зачёркнута, рядом новая и плашка «−N % до <дата>»; без акции — просто
 * цена, как раньше.
 *
 * Намеренно без "use client" и без хуков (как `PlanCard`): остаётся
 * серверным на лендинге и попадает в клиентский бандл, когда его
 * импортирует клиентский компонент. Даты форматируются без Intl-часовых
 * поясов (lib/promo/promotions.ts) — сервер и браузер рисуют одно и то же.
 *
 * Цифры приходят с сервера (`getSubscriptionOffer` / `getDisplayOffer`
 * или `applyPromotion` от того же `promotion`) — компонент ничего не
 * решает, только показывает.
 */

/** text — как окружающий текст (цена внутри абзаца), sm — полужирная в строке. */
type Size = "text" | "sm" | "md" | "lg" | "xl";
/** inherit — цвет новой цены от родителя (абзац, строка-ссылка). */
type Tone = "light" | "dark" | "inherit";

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

export function formatPriceRub(value: number): string {
  return `${new Intl.NumberFormat("ru-RU").format(value)} ₽`;
}

export function PromoBadge({
  promotion,
  tone = "light",
  className,
}: {
  promotion: Pick<AppliedPromotion, "percent" | "endsAt" | "title">;
  tone?: "light" | "dark";
  className?: string;
}) {
  return (
    <span
      data-promo-badge
      title={`${promotion.title}. ${promotionEndHint(promotion)}`}
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[12px] font-medium leading-[1.4] tracking-normal",
        tone === "dark"
          ? "border-[#7cf5c0]/40 bg-[#7cf5c0]/15 text-[#7cf5c0]"
          : "border-[#c8f0d5] bg-[#ecfdf5] text-[#116b2a]",
        className,
      )}
    >
      <BadgePercent aria-hidden className="size-3.5 shrink-0" />
      {promotionBadgeLabel(promotion)}
    </span>
  );
}

export function PromoPrice({
  price,
  size = "sm",
  tone = "light",
  layout = "inline",
  suffix,
  showBadge = true,
  className,
}: {
  price: Pick<PriceWithPromotion, "baseRub" | "priceRub" | "promotion">;
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
  const promotion = price.promotion && price.priceRub < price.baseRub ? price.promotion : null;
  const newTone = tone === "dark" ? "text-white" : tone === "light" ? "text-[#0b1024]" : "";
  const oldTone = tone === "dark" ? "text-white/50" : "text-[#9b9fb3]";

  if (!promotion) {
    return (
      <span data-testid="promo-price" data-promo-active="false" className={cn("tabular-nums", className)}>
        <span data-promo-new className={cn(NEW_SIZE[size], newTone)}>
          {formatPriceRub(price.priceRub)}
        </span>
        {suffix}
      </span>
    );
  }

  const oldPrice = (
    <s data-promo-old className={cn("tabular-nums decoration-[1.5px]", OLD_SIZE[size], oldTone)}>
      <span className="sr-only">Без акции: </span>
      {formatPriceRub(price.baseRub)}
    </s>
  );
  const newPrice = (
    <span className="whitespace-nowrap">
      <span data-promo-new className={cn("tabular-nums", NEW_SIZE[size], newTone)}>
        <span className="sr-only">По акции: </span>
        {formatPriceRub(price.priceRub)}
      </span>
      {suffix}
    </span>
  );
  const badge = showBadge ? (
    <PromoBadge promotion={promotion} tone={tone === "dark" ? "dark" : "light"} />
  ) : null;

  if (layout === "stacked") {
    return (
      <span
        data-testid="promo-price"
        data-promo-active="true"
        data-promo-percent={promotion.percent}
        className={cn("flex flex-col gap-1.5", className)}
      >
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {oldPrice}
          {badge}
        </span>
        {newPrice}
      </span>
    );
  }

  return (
    <span
      data-testid="promo-price"
      data-promo-active="true"
      data-promo-percent={promotion.percent}
      className={cn("inline-flex flex-wrap items-baseline gap-x-1.5 gap-y-1", className)}
    >
      {oldPrice}
      {newPrice}
      {badge ? <span className="self-center">{badge}</span> : null}
    </span>
  );
}
