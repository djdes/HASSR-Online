"use client";

import { useTranslations } from "next-intl";
import { Check, Loader2, MapPin } from "lucide-react";
import { toast } from "sonner";
import type { BuildingOption } from "@/lib/building-scope";
import { cn } from "@/lib/utils";
import { useContentTransition } from "@/components/layout/content-transition";
import { ScrollList } from "@/components/ui/scroll-list";

/**
 * Точки (2026-09-05): переключение активной точки. С 2026-10-16 — из центра
 * шапки (`current-point-switcher.tsx`); с 2026-10-30 и на телефоне только
 * оттуда, без дубля в меню (как на ПК). Здесь хук переключения и список
 * точек для листа на телефоне.
 *
 * Страницы остаются одно-точечными: журналы, «сегодня» и пул задач
 * показываются для выбранной точки, а не сводятся в один экран. Список
 * приходит с сервера по активной организации (не по членству), поэтому
 * партнёр в кабинете клиента и ROOT при импёрсонации видят те же точки,
 * что и владелец.
 *
 * Смена — общий переход кабинета (`content-transition.tsx`, 2026-10-29):
 * пока новая страница не пришла, контент — скелет, у пункта — крутилка,
 * тост «Точка: …» — после того, как данные точки уже на экране.
 */

export function useSwitchBuilding() {
  const t = useTranslations("navigation.shell.point");
  const { refreshAfter, pendingTag, isPending } = useContentTransition();

  function switchTo(building: BuildingOption, activeBuildingId: string | null) {
    if (building.id === activeBuildingId || isPending) return;
    refreshAfter(
      building.id,
      async () => {
        try {
          const response = await fetch("/api/me/active-building", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ buildingId: building.id }),
          });
          const data = await response.json().catch(() => null);
          if (!response.ok) throw new Error(data?.error ?? t("failed"));
          return true;
        } catch (error) {
          toast.error(error instanceof Error ? error.message : t("failed"));
          return false;
        }
      },
      () => toast.success(t("switched", { name: building.name })),
    );
  }

  return { switchTo, busyId: pendingTag };
}

/**
 * Тот же список плоскими кнопками — для листа «Точки» на телефоне. Подписи
 * «Точки» нет: она уже в заголовке листа. Высота ограничена, справа полоса
 * прокрутки (`ScrollList`), чтобы «Управление точками» под списком было на
 * виду и при двадцати точках.
 */
export function LocationSwitcherList({
  buildings,
  activeBuildingId,
}: {
  buildings: BuildingOption[];
  activeBuildingId: string | null;
}) {
  const { switchTo, busyId } = useSwitchBuilding();
  if (buildings.length < 2) return null;
  const activeId = activeBuildingId ?? buildings[0]?.id ?? null;

  return (
    <ScrollList
      maxHeightClassName="max-h-[min(52vh,440px)] supports-[height:100dvh]:max-h-[min(52dvh,440px)]"
      className="mb-1 border-b border-[#ececf4] pb-2"
    >
      {buildings.map((building) => {
        const isActive = building.id === activeId;
        return (
          <button
            key={building.id}
            type="button"
            data-location-option={building.id}
            data-active-option={isActive ? "" : undefined}
            onClick={() => void switchTo(building, activeId)}
            className={cn(
              "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[14px] font-medium transition-colors",
              isActive ? "bg-[#f5f6ff] text-[#5566f6]" : "text-[#3c4053] hover:bg-[#fafbff]",
            )}
          >
            <MapPin
              className={cn("size-5 shrink-0", isActive ? "text-[#5566f6]" : "text-[#6f7282]")}
            />
            <span className="min-w-0 flex-1 truncate">{building.name}</span>
            {busyId === building.id ? (
              <Loader2 className="size-4 shrink-0 animate-spin text-[#5566f6]" />
            ) : isActive ? (
              <Check className="size-4 shrink-0 text-[#5566f6]" />
            ) : null}
          </button>
        );
      })}
    </ScrollList>
  );
}
