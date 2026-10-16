"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Check, ChevronDown, Loader2, Settings2, Store } from "lucide-react";
import type { BuildingOption } from "@/lib/building-scope";
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

/**
 * Текущая торговая точка — в центре шапки (схема владельца 2026-10-16).
 * Точек две и больше — по нажатию список, переключение в одно касание.
 * Точка одна — просто её название, без стрелки: выбирать нечего.
 */
export function CurrentPointSwitcher({
  name,
  buildings,
  activeBuildingId,
  manageHref,
}: {
  /** Что написать, когда переключать нечего: точка или организация. */
  name: string;
  /** Точки для переключения; меньше двух — переключателя нет. */
  buildings: BuildingOption[];
  activeBuildingId: string | null;
  manageHref: string | null;
}) {
  const t = useTranslations("navigation.shell.point");
  const narrow = useIsNarrowViewport();
  const [sheetOpen, setSheetOpen] = useState(false);
  const { switchTo, busyId } = useSwitchBuilding();
  const canSwitch = buildings.length >= 2;
  const activeId = activeBuildingId ?? buildings[0]?.id ?? null;
  const current = buildings.find((building) => building.id === activeId);
  const label = canSwitch ? current?.name ?? name : name;

  const body = (
    <>
      <Store className="size-[18px] shrink-0 text-[#5566f6]" aria-hidden />
      <span className="min-w-0 truncate">{label}</span>
      {canSwitch ? (
        busyId ? (
          <Loader2 className="size-4 shrink-0 animate-spin text-[#5566f6]" aria-hidden />
        ) : (
          <ChevronDown className="size-4 shrink-0 text-[#9b9fb3]" aria-hidden />
        )
      ) : null}
    </>
  );
  const base =
    "inline-flex h-10 min-w-0 max-w-full items-center gap-2 rounded-2xl px-3 text-[15px] font-semibold text-[#0b1024] max-sm:h-11 max-sm:text-[14px]";

  if (!label) return null;

  if (!canSwitch) {
    return (
      <span className={base} data-current-point title={label}>
        {body}
      </span>
    );
  }

  const trigger = cn(
    base,
    "transition-colors duration-150 hover:bg-[#f5f6ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 data-[state=open]:bg-[#f5f6ff]",
  );

  if (narrow) {
    return (
      <>
        <button
          type="button"
          onClick={() => setSheetOpen(true)}
          className={trigger}
          aria-label={t("switch")}
          data-current-point
        >
          {body}
        </button>
        <BottomSheet open={sheetOpen} onClose={() => setSheetOpen(false)} title={t("list")}>
          <div
            onClick={(event) => {
              if ((event.target as HTMLElement).closest("button,a")) setSheetOpen(false);
            }}
          >
            <LocationSwitcherList buildings={buildings} activeBuildingId={activeBuildingId} />
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
        <button type="button" className={trigger} aria-label={t("switch")} data-current-point>
          {body}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center" className="w-[300px]">
        {buildings.map((building) => {
          const isActive = building.id === activeId;
          return (
            <DropdownMenuItem
              key={building.id}
              onSelect={() => void switchTo(building, activeId)}
              className={cn("items-start", isActive && MENU_ITEM_ACTIVE_CLASS)}
              data-point-option={building.id}
            >
              <Store className={cn("mt-0.5 size-4", isActive ? "text-[#3848c7]" : "text-[#9b9fb3]")} />
              <span className="min-w-0 flex-1">
                <span className="block truncate">{building.name}</span>
                {building.address ? (
                  <span className="block truncate text-[12px] font-normal text-[#9b9fb3]">
                    {building.address}
                  </span>
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
