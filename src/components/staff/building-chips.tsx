"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowLeftRight, Briefcase, MapPin, Star } from "lucide-react";
import { isOfficeBuilding, type BuildingOption } from "@/lib/building-scope";
import { cn } from "@/lib/utils";

/**
 * Точки (2026-09-05): чипы «на каких точках работает сотрудник».
 *
 * Ничего не выбрано — работает на всех точках (так и подписано), поэтому
 * у существующих сотрудников после включения точек ничего не ломается.
 * Стиль — как у WeekdayChips, чтобы блок «Выходные» и блок «Точки» в
 * одном диалоге читались одинаково. Больше трёх точек — сворачиваем,
 * чтобы диалог на телефоне оставался в одном экране.
 *
 * Основная точка (2026-10-27): у человека на ≥ 2 точках рядом с каждой
 * выбранной — звезда; основная точка — та, по которой приходят уведомления
 * «по месту». Временная точка (замена) помечена значком ⇄.
 */
const VISIBLE_LIMIT = 3;

export function BuildingChips(props: {
  buildings: BuildingOption[];
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  ariaLabel?: string;
  /** Основная точка; передан `onPrimaryChange` — звезда у выбранных точек. */
  primaryId?: string | null;
  onPrimaryChange?: (id: string | null) => void;
  /** Временная точка (замена) — значок на чипе. */
  temporaryId?: string | null;
}) {
  const { buildings, value, onChange, disabled, onPrimaryChange } = props;
  const t = useTranslations("staffManagement.buildings");
  const [expanded, setExpanded] = useState(false);
  if (buildings.length < 2) return null;
  const all = value.length === 0;
  // Офис (2026-10-26) — отдельно от точек: сотрудник офиса видит все точки,
  // а работает только в офисе, поэтому офис и точки не выбираются вместе.
  const office = buildings.find(isOfficeBuilding) ?? null;
  const inOffice = office ? value.includes(office.id) : false;
  const pickOffice = () => {
    if (!office) return;
    onChange(inOffice ? [] : [office.id]);
  };
  const pickPoint = (id: string, active: boolean) => {
    const points = office ? value.filter((item) => item !== office.id) : value;
    onChange(active ? points.filter((item) => item !== id) : [...points, id]);
  };
  const collapsible = buildings.length > VISIBLE_LIMIT + 1;
  const visible =
    !collapsible || expanded
      ? buildings
      : buildings.filter(
          (building, index) => index < VISIBLE_LIMIT || value.includes(building.id),
        );
  const hidden = buildings.length - visible.length;
  const selectedPoints = buildings.filter((building) => !isOfficeBuilding(building) && value.includes(building.id));
  const showPrimary = Boolean(onPrimaryChange) && selectedPoints.length >= 2;
  const primaryId = showPrimary && props.primaryId && value.includes(props.primaryId) ? props.primaryId : null;

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
          {inOffice ? t("officeHint") : showPrimary ? t("primaryHint") : t("allTasksHint")}
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
        {office ? (
          <button
            type="button"
            disabled={disabled}
            aria-pressed={inOffice}
            title={t("officeTitle")}
            onClick={pickOffice}
            className={chipClass(inOffice)}
            data-building-chip="office"
          >
            <Briefcase className="size-3.5 shrink-0" />
            <span className="truncate">{t("office")}</span>
          </button>
        ) : null}
        {visible.filter((building) => !isOfficeBuilding(building)).map((building) => {
          const active = value.includes(building.id);
          const temporary = active && props.temporaryId === building.id;
          const chip = (
            <button
              key={building.id}
              type="button"
              disabled={disabled}
              aria-pressed={active}
              title={
                temporary
                  ? t("temporaryTitle", { name: building.name })
                  : building.address
                    ? `${building.name}, ${building.address}`
                    : building.name
              }
              onClick={() => pickPoint(building.id, active)}
              className={cn(chipClass(active), showPrimary && active && "rounded-r-none border-r-0")}
              data-building-chip={building.id}
            >
              {temporary ? <ArrowLeftRight className="size-3.5 shrink-0" /> : <MapPin className="size-3.5 shrink-0" />}
              <span className="truncate">{building.name}</span>
            </button>
          );
          if (!showPrimary || !active) return chip;
          const isPrimary = primaryId === building.id;
          return (
            <span key={building.id} className="inline-flex max-w-full">
              {chip}
              <button
                type="button"
                disabled={disabled}
                aria-pressed={isPrimary}
                aria-label={isPrimary ? t("primaryOn", { name: building.name }) : t("makePrimary", { name: building.name })}
                title={isPrimary ? t("primaryOn", { name: building.name }) : t("makePrimary", { name: building.name })}
                onClick={() => onPrimaryChange?.(isPrimary ? null : building.id)}
                data-primary-star={building.id}
                className="inline-flex h-9 items-center rounded-r-lg border border-l-white/30 border-[#5566f6] bg-[#5566f6] px-2 text-white transition-colors duration-150 hover:bg-[#4a5bf0] focus:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
              >
                <Star className={cn("size-3.5", isPrimary ? "fill-current" : "opacity-60")} />
              </button>
            </span>
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
