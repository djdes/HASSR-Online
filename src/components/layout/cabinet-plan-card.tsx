"use client";

import Link from "next/link";
import { ArrowLeftRight } from "lucide-react";
import { useTranslations } from "next-intl";

import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { formatPriceRub } from "@/lib/billing-period";
import type { CabinetPlanCard } from "@/lib/cabinet-plan";
import { useInsideMobileApp } from "@/lib/use-inside-mobile-app";
import { cn } from "@/lib/utils";

/**
 * Тариф организации — верх меню профиля (лист на телефоне и выпадающее меню
 * на компьютере). Владелец, 2026-11-22: без строки «Мой кабинет · сейчас» —
 * подпись «Тариф организации:», под ней тариф, и справа от него компактная
 * кнопка «Сменить» с иконкой; ниже мелко — точки, сотрудники и сумма в месяц.
 *
 * Данные считает сервер (`buildCabinetPlanCard` в layout'е). В приложении
 * WeSetup цену и кнопку прячет ещё и клиент — на случай, если признак
 * приложения сервер не увидел (правила сторов).
 */
export function CabinetPlanCardView({
  card,
  variant,
  onNavigate,
}: {
  card: CabinetPlanCard;
  variant: "sheet" | "menu";
  onNavigate?: () => void;
}) {
  const t = useTranslations("layoutUi.cabinetPlanCard");
  const inApp = useInsideMobileApp();
  const price = inApp ? null : card.price;
  const link = inApp ? null : card.link;
  const sheet = variant === "sheet";

  const change = link ? (
    <Link
      href={link.href}
      onClick={onNavigate}
      data-testid="cabinet-plan-change"
      title={link.label}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full bg-white font-medium text-[#3848c7] transition-colors hover:bg-[#eef1ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15",
        sheet ? "h-8 px-3 text-[13px]" : "h-7 px-2.5 text-[12px] focus:bg-[#eef1ff]",
      )}
    >
      <ArrowLeftRight className={sheet ? "size-3.5" : "size-3"} aria-hidden />
      {t("change")}
    </Link>
  ) : null;

  return (
    <div
      className={cn("rounded-2xl border border-[#dfe3fb] bg-[#f5f6ff]", sheet ? "px-3.5 py-3" : "px-2.5 py-2")}
      data-testid="cabinet-plan-card"
    >
      <span className={cn("block text-[#6f7282]", sheet ? "text-[12px]" : "text-[11px]")}>{t("label")}</span>
      <div className="mt-0.5 flex items-center gap-2">
        <span
          data-testid="cabinet-plan-title"
          className={cn("min-w-0 flex-1 font-semibold leading-snug text-[#0b1024]", sheet ? "text-[15px]" : "text-[13.5px]")}
        >
          {card.title}
        </span>
        {change ? (
          variant === "menu" ? (
            <DropdownMenuItem asChild className="w-fit p-0 focus:bg-transparent">
              {change}
            </DropdownMenuItem>
          ) : (
            change
          )
        ) : null}
      </div>
      {card.counts ? (
        <span className={cn("mt-0.5 block text-[#6f7282]", sheet ? "text-[12.5px]" : "text-[11.5px]")}>{card.counts}</span>
      ) : null}
      {price ? (
        <span
          data-testid="cabinet-plan-price"
          className={cn("mt-0.5 block leading-snug text-[#3c4053]", sheet ? "text-[12.5px]" : "text-[11.5px]")}
        >
          <span className="font-semibold tabular-nums text-[#0b1024]">
            {t("perMonth", { price: formatPriceRub(price.finalRub) })}
          </span>
          {price.fullRub > price.finalRub ? (
            <>
              {" "}
              <s className="tabular-nums text-[#9b9fb3]">{formatPriceRub(price.fullRub)}</s>
            </>
          ) : null}
          {price.breakdown ? `: ${price.breakdown}` : null}
          {price.note ? ` · ${price.note}` : null}
        </span>
      ) : null}
    </div>
  );
}
