"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { MapPin } from "lucide-react";
import type { BuildingOption } from "@/lib/building-scope";
import { cn } from "@/lib/utils";

/**
 * Точки (2026-09-05): чипы «на каких точках работает сотрудник».
 *
 * Ничего не выбрано — работает на всех точках (так и подписано), поэтому
 * у существующих сотрудников после включения точек ничего не ломается.
 * Стиль — как у WeekdayChips, чтобы блок «Выходные» и блок «Точки» в
 * одном диалоге читались одинаково. Больше трёх точек — сворачиваем,
 * чтобы диалог на телефоне оставался в одном экране.
 */
const VISIBLE_LIMIT = 3;

export function BuildingChips(props: {
  buildings: BuildingOption[];
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  const { buildings, value, onChange, disabled } = props;
  const t = useTranslations("staffManagement.buildings");
  const [expanded, setExpanded] = useState(false);
  if (buildings.length < 2) return null;
  const all = value.length === 0;
  const collapsible = buildings.length > VISIBLE_LIMIT + 1;
  const visible =
    !collapsible || expanded
      ? buildings
      : buildings.filter(
          (building, index) => index < VISIBLE_LIMIT || value.includes(building.id),
        );
  const hidden = buildings.length - visible.length;

  const chipClass = (active: boolean) =>
    cn(
      "inline-flex h-9 max-w-full items-center gap-1.5 rounded-lg border px-2.5 text-[13px] font-medium transition-colors focus:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15",
      active
        ? "border-[#5566f6] bg-[#5566f6] text-white hover:bg-[#4a5bf0]"
        : "border-[#dcdfed] bg-white text-[#6f7282] hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] hover:text-[#0b1024]",
    );

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-[#9b9fb3]">
          {t("heading")}
        </div>
        <span className="text-[11px] leading-snug text-[#6f7282]">
          {t("allTasksHint")}
        </span>
      </div>
      <div
        role="group"
        aria-label={props.ariaLabel ?? t("employeeLabel")}
        className="flex flex-wrap gap-1"
      >
        <button
          type="button"
          disabled={disabled}
          aria-pressed={all}
          title={t("allTitle")}
          onClick={() => onChange([])}
          className={chipClass(all)}
        >
          {t("all")}
        </button>
        {visible.map((building) => {
          const active = value.includes(building.id);
          return (
            <button
              key={building.id}
              type="button"
              disabled={disabled}
              aria-pressed={active}
              title={building.address ? `${building.name}, ${building.address}` : building.name}
              onClick={() =>
                onChange(
                  active
                    ? value.filter((id) => id !== building.id)
                    : [...value, building.id],
                )
              }
              className={chipClass(active)}
            >
              <MapPin className="size-3.5 shrink-0" />
              <span className="truncate">{building.name}</span>
            </button>
          );
        })}
        {collapsible ? (
          <button
            type="button"
            disabled={disabled}
            onClick={() => setExpanded((prev) => !prev)}
            className="inline-flex h-9 items-center rounded-lg px-2.5 text-[13px] font-medium text-[#5566f6] transition-colors hover:bg-[#f5f6ff]"
          >
            {expanded ? t("collapse") : t("more", { count: hidden })}
          </button>
        ) : null}
      </div>
    </div>
  );
}
