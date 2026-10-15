"use client";
import { useTranslations } from "next-intl";

import { LayoutGrid, Rows3 } from "lucide-react";
import type { MobileView } from "@/lib/use-mobile-view";
import type { TourAnchor } from "@/lib/tour-anchors";

/**
 * Shared mobile-only «Карточки / Таблица» switcher. Renders a pill-group
 * that's hidden on sm+ screens (where the table is always shown by
 * design) and on print (always table for export parity). Callers pair
 * this with `useMobileView(journalCode)` for state.
 */
export function MobileViewToggle({
  mobileView,
  onChange,
  cardsLabel,
  tableLabel,
  dataTour,
}: {
  mobileView: MobileView;
  onChange: (next: MobileView) => void;
  cardsLabel?: string;
  tableLabel?: string;
  /** Анкор спотлайт-тура «Как заполнить?» (шаг «Переключитесь на Таблица»). */
  dataTour?: TourAnchor;
}) {
  const t = useTranslations("journalControls.list");
  return (
    <div
      role="tablist"
      aria-label={t("viewMode")}
      data-tour={dataTour}
      className="flex w-full rounded-2xl border border-[#ececf4] bg-white p-1 text-[13px] font-medium sm:hidden print:hidden"
    >
      <button
        type="button"
        role="tab"
        aria-selected={mobileView === "cards"}
        onClick={() => onChange("cards")}
        className={`flex flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2 transition-colors ${
          mobileView === "cards"
            ? "bg-[#f5f6ff] text-[#5566f6]"
            : "text-[#6f7282]"
        }`}
      >
        <LayoutGrid className="size-4" />
        {cardsLabel ?? t("cards")}
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={mobileView === "table"}
        onClick={() => onChange("table")}
        className={`flex flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2 transition-colors ${
          mobileView === "table"
            ? "bg-[#f5f6ff] text-[#5566f6]"
            : "text-[#6f7282]"
        }`}
      >
        <Rows3 className="size-4" />
        {tableLabel ?? t("table")}
      </button>
    </div>
  );
}

/**
 * Wraps a `<table>` so on mobile with `mobileView === "cards"` it's
 * hidden — and the caller renders their own card list alongside.
 *
 * Usage:
 *   <MobileViewTableWrapper mobileView={mobileView}>
 *     <table>...</table>
 *   </MobileViewTableWrapper>
 *   {mobileView === "cards" ? <div className="sm:hidden print:hidden">{cards}</div> : null}
 */
export function MobileViewTableWrapper({
  mobileView,
  children,
  className = "",
}: {
  mobileView: MobileView;
  children: React.ReactNode;
  className?: string;
}) {
  const cls = mobileView === "cards" ? "hidden sm:block print:block" : "";
  return <div className={`${cls} ${className}`.trim()}>{children}</div>;
}
