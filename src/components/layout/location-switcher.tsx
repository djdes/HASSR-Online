"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, MapPin } from "lucide-react";
import { toast } from "sonner";
import type { BuildingOption } from "@/lib/building-scope";
import { cn } from "@/lib/utils";

/**
 * Точки (2026-09-05): переключение активной точки. С 2026-09-23 основной
 * путь — вкладки над страницей (`location-tabs.tsx`); здесь остаются хук
 * и запасной список в мобильном меню.
 *
 * Страницы остаются одно-точечными: журналы, «сегодня» и пул задач
 * показываются для выбранной точки, а не сводятся в один экран. Список
 * приходит с сервера по активной организации (не по членству), поэтому
 * партнёр в кабинете клиента и ROOT при импёрсонации видят те же точки,
 * что и владелец.
 */

export function useSwitchBuilding() {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);

  async function switchTo(building: BuildingOption, activeBuildingId: string | null) {
    if (building.id === activeBuildingId || busyId) return;
    setBusyId(building.id);
    try {
      const response = await fetch("/api/me/active-building", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ buildingId: building.id }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error ?? "Не удалось переключить точку");
      toast.success(`Точка: ${building.name}`);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Ошибка");
    } finally {
      setBusyId(null);
    }
  }

  return { switchTo, busyId };
}

/** Тот же список плоскими кнопками — для мобильного меню-шторки. */
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
    <div className="mb-1 border-b border-[#ececf4] pb-2">
      <div className="px-3 pb-1 pt-1 text-[11px] font-medium uppercase tracking-[0.14em] text-[#9b9fb3]">
        Точка
      </div>
      {buildings.map((building) => {
        const isActive = building.id === activeId;
        return (
          <button
            key={building.id}
            type="button"
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
    </div>
  );
}
