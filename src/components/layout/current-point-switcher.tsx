"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Check, ChevronDown, Loader2, Plus, Settings2, Store } from "lucide-react";
import type { BuildingOption } from "@/lib/building-scope";
import type { HeaderPoint, HeaderPointOption } from "@/lib/header-point";
import { cn } from "@/lib/utils";
import { useIsNarrowViewport } from "@/lib/use-narrow-viewport";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MENU_ITEM_ACTIVE_CLASS } from "@/components/ui/menu-styles";
import { LocationSwitcherList, useSwitchBuilding } from "@/components/layout/location-switcher";

const FOCUS = "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15";

/**
 * Центр шапки — текущая торговая точка (эскиз руководителя: слева логотип и
 * название компании, в центре «наименование торговой точки / текущего
 * объекта»). Над названием тихая подпись «Точка», чтобы было видно, где
 * компания, а где точка. Что показать, решает `resolveHeaderPoint`:
 *   • точек две и больше и журналы по точкам — переключатель в одно касание;
 *   • одна точка — её название (совпадает с компанией — адрес);
 *   • точек несколько, журналы общие — «Точки · Все: N», без переключения;
 *   • точек нет — руководителю «+ Добавить точку», остальным ничего.
 */
export function CurrentPointSwitcher({
  point,
  buildings,
  activeBuildingId,
  manageHref,
}: {
  point: HeaderPoint;
  /** Точки для переключения (`kind: "switch"`). */
  buildings: BuildingOption[];
  activeBuildingId: string | null;
  manageHref: string | null;
}) {
  const t = useTranslations("navigation.shell.point");
  const narrow = useIsNarrowViewport();
  const [sheetOpen, setSheetOpen] = useState(false);
  const { switchTo, busyId } = useSwitchBuilding();

  const titleOf = (option: HeaderPointOption) => {
    const title = option.title;
    return title.text === null ? t(title.source) : title.text;
  };
  const hintOf = (option: HeaderPointOption) =>
    option.address ? `${titleOf(option)}, ${option.address}` : titleOf(option);

  if (point.kind === "none") return null;

  if (point.kind === "add") {
    return (
      <Link
        href={manageHref ?? "/settings/buildings"}
        title={t("addHint")}
        data-current-point="add"
        className={cn(
          "inline-flex h-10 min-w-0 items-center gap-1.5 rounded-2xl border border-dashed border-[#c9cee6] px-3.5 text-[14px] font-medium text-[#3848c7] transition-colors duration-150 hover:border-[#5566f6]/50 hover:bg-[#f5f6ff] max-sm:h-11 max-sm:px-3 max-sm:text-[13.5px]",
          FOCUS,
        )}
      >
        <Plus className="size-4 shrink-0" aria-hidden />
        <span className="truncate">{t("add")}</span>
      </Link>
    );
  }

  if (point.kind === "single" || point.kind === "all") {
    const caption = point.kind === "all" ? t("captionMany") : t("caption");
    const title = point.kind === "all" ? t("all", { count: String(point.count) }) : titleOf(point.point);
    const hint = point.kind === "all" ? point.options.map(titleOf).join(" · ") : hintOf(point.point);
    return (
      <span className={BASE} data-current-point={point.kind} title={hint}>
        <PointLabel caption={caption} title={title} />
      </span>
    );
  }

  // Переключатель: несколько точек, журналы ведутся по каждой.
  const options = point.options;
  const active = options.find((option) => option.id === point.activeId) ?? options[0];
  // В списке — те же подписи, что в шапке: точка с названием компании — по адресу.
  const listBuildings = buildings.map((building) => {
    const option = options.find((item) => item.id === building.id);
    return option ? { ...building, name: titleOf(option) } : building;
  });
  const trigger = cn(
    BASE,
    "transition-colors duration-150 hover:bg-[#f5f6ff] data-[state=open]:bg-[#f5f6ff]",
    FOCUS,
  );
  const body = (
    <>
      <PointLabel caption={t("caption")} title={titleOf(active)} />
      {busyId ? (
        <Loader2 className="size-4 shrink-0 animate-spin text-[#5566f6]" aria-hidden />
      ) : (
        <ChevronDown className="size-4 shrink-0 text-[#6f7282]" aria-hidden />
      )}
    </>
  );

  if (narrow) {
    return (
      <>
        <button
          type="button"
          onClick={() => setSheetOpen(true)}
          className={trigger}
          aria-label={`${t("switch")}: ${titleOf(active)}`}
          title={hintOf(active)}
          data-current-point="switch"
        >
          {body}
        </button>
        <BottomSheet open={sheetOpen} onClose={() => setSheetOpen(false)} title={t("list")}>
          <div
            onClick={(event) => {
              if ((event.target as HTMLElement).closest("button,a")) setSheetOpen(false);
            }}
          >
            <LocationSwitcherList buildings={listBuildings} activeBuildingId={activeBuildingId} />
            {manageHref ? (
              <Link
                href={manageHref}
                className="flex min-h-[48px] items-center gap-3 rounded-xl px-3 text-[14px] font-medium text-[#3848c7] transition-colors hover:bg-[#f5f6ff]"
              >
                <Settings2 className="size-5" />
                {t("manage")}
              </Link>
            ) : null}
          </div>
        </BottomSheet>
      </>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={trigger}
          aria-label={`${t("switch")}: ${titleOf(active)}`}
          title={hintOf(active)}
          data-current-point="switch"
        >
          {body}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center" className="w-[300px]">
        {options.map((option) => {
          const isActive = option.id === active.id;
          const building = buildings.find((item) => item.id === option.id);
          return (
            <DropdownMenuItem
              key={option.id}
              onSelect={() => {
                if (building) void switchTo({ ...building, name: titleOf(option) }, active.id);
              }}
              className={cn("items-start", isActive && MENU_ITEM_ACTIVE_CLASS)}
              data-point-option={option.id}
            >
              <Store className={cn("mt-0.5 size-4", isActive ? "text-[#3848c7]" : "text-[#9b9fb3]")} />
              <span className="min-w-0 flex-1">
                <span className="block truncate">{titleOf(option)}</span>
                {option.address ? (
                  <span className="block truncate text-[12px] font-normal text-[#9b9fb3]">{option.address}</span>
                ) : null}
              </span>
              {isActive ? <Check className="mt-0.5 size-4 text-[#3848c7]" /> : null}
            </DropdownMenuItem>
          );
        })}
        {manageHref ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href={manageHref}>
                <Settings2 className="size-4" />
                {t("manage")}
              </Link>
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const BASE =
  "inline-flex h-11 min-w-0 max-w-[min(40vw,420px)] items-center gap-2 rounded-2xl px-3 text-left max-sm:max-w-[min(52vw,240px)] max-sm:px-2";

/** Иконка точки, тихая подпись «Точка» и название — две строки. */
function PointLabel({ caption, title }: { caption: string; title: string }) {
  return (
    <>
      <Store className="size-[18px] shrink-0 text-[#5566f6]" aria-hidden />
      <span className="flex min-w-0 flex-col leading-tight">
        <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-[#9b9fb3]" data-point-caption>
          {caption}
        </span>
        <span className="truncate text-[15px] font-semibold text-[#0b1024] max-sm:text-[14px]" data-point-title>
          {title}
        </span>
      </span>
    </>
  );
}
