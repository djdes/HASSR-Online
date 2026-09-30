"use client";

import Link from "next/link";
import { ArrowRight, Building2 } from "lucide-react";

import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { formatPriceRub } from "@/lib/billing-period";
import type { CabinetPlanCard } from "@/lib/cabinet-plan";
import { useInsideMobileApp } from "@/lib/use-inside-mobile-app";
import { cn } from "@/lib/utils";

/**
 * «Мой кабинет» — верх меню профиля (лист на телефоне и выпадающее меню на
 * компьютере): какой тариф, сколько организаций и сотрудников, сколько это
 * стоит в месяц и ссылка «Изменить тариф». Нажатие по карточке — в свой
 * кабинет, как прежний пункт «Моя организация».
 *
 * Данные считает сервер (`buildCabinetPlanCard` в layout'е). В приложении
 * WeSetup цену и ссылку прячет ещё и клиент — на случай, если признак
 * приложения сервер не увидел (правила сторов).
 */
export function CabinetPlanCardView({
  card,
  ownCabinet,
  variant,
  onNavigate,
}: {
  card: CabinetPlanCard;
  /** Открыт свой кабинет (не ROOT «под видом», не консультант партнёра). */
  ownCabinet: boolean;
  variant: "sheet" | "menu";
  onNavigate?: () => void;
}) {
  const inApp = useInsideMobileApp();
  const price = inApp ? null : card.price;
  const link = inApp ? null : card.link;
  const sheet = variant === "sheet";

  const main = (
    <Link
      href="/dashboard"
      onClick={onNavigate}
      data-testid="cabinet-plan-card"
      className={cn(
        "block min-w-0 rounded-xl text-left transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15",
        sheet ? "px-3.5 py-3 hover:bg-[#eef1ff]" : "px-2.5 py-2 hover:bg-[#eef1ff] focus:bg-[#eef1ff]"
      )}
    >
      <span className="flex items-center gap-2">
        <Building2 className={cn("shrink-0 text-[#5566f6]", sheet ? "size-5" : "size-4")} />
        <span className={cn("min-w-0 flex-1 truncate font-semibold text-[#0b1024]", sheet ? "text-[16px]" : "text-[14px]")}>
          {ownCabinet ? "Мой кабинет" : "Кабинет организации"}
        </span>
        {ownCabinet ? (
          <span className={cn("shrink-0 text-[#3848c7]", sheet ? "text-[12px]" : "text-[11px]")}>сейчас</span>
        ) : null}
      </span>
      <span
        data-testid="cabinet-plan-title"
        className={cn("mt-1 block font-medium text-[#3848c7]", sheet ? "text-[14.5px]" : "text-[13px]")}
      >
        {card.title}
      </span>
      {card.counts ? (
        <span className={cn("mt-0.5 block text-[#6f7282]", sheet ? "text-[13.5px]" : "text-[12px]")}>
          {card.counts}
        </span>
      ) : null}
      {price ? (
        <span
          data-testid="cabinet-plan-price"
          className={cn("mt-0.5 block leading-snug text-[#3c4053]", sheet ? "text-[13.5px]" : "text-[12px]")}
        >
          <span className="font-semibold tabular-nums text-[#0b1024]">
            {formatPriceRub(price.finalRub)}/мес
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
    </Link>
  );

  const change = link ? (
    <Link
      href={link.href}
      onClick={onNavigate}
      data-testid="cabinet-plan-change"
      className={cn(
        "inline-flex items-center gap-1.5 rounded-xl font-medium text-[#5566f6] transition-colors hover:bg-[#eef1ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15",
        sheet ? "min-h-10 px-3.5 py-2 text-[14px]" : "px-2.5 py-1.5 text-[12.5px] focus:bg-[#eef1ff]"
      )}
    >
      {link.label}
      <ArrowRight className={sheet ? "size-4" : "size-3.5"} />
    </Link>
  ) : null;

  return (
    <div className={cn("rounded-2xl border border-[#dfe3fb] bg-[#f5f6ff]", sheet ? "p-1" : "p-0.5")}>
      {variant === "menu" ? (
        <>
          <DropdownMenuItem asChild className="block p-0 focus:bg-transparent">
            {main}
          </DropdownMenuItem>
          {change ? (
            <DropdownMenuItem asChild className="w-fit p-0 focus:bg-transparent">
              {change}
            </DropdownMenuItem>
          ) : null}
        </>
      ) : (
        <>
          {main}
          {change}
        </>
      )}
    </div>
  );
}
