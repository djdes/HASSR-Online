"use client";

import { Fragment, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Check, Loader2, Search } from "lucide-react";
import { journalMatchesQuery, normalizeJournalSearch } from "@/lib/journal-search";
import { toast } from "sonner";
import { isOfficeBuilding, type BuildingOption } from "@/lib/building-scope";
import { hrefAfterPointSwitch } from "@/lib/point-section-sync";
import { cn } from "@/lib/utils";
import { useContentTransition } from "@/components/layout/content-transition";
import { forgetReturnPoint } from "@/components/layout/point-section-sync";
import { ScrollList } from "@/components/ui/scroll-list";
import { BuildingIcon } from "@/components/layout/building-icon";
import { PinButton } from "@/components/layout/pinned-buildings";

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
 * пока новая страница не пришла, контент — скелет, у пункта — крутилка.
 * Без оповещений (владелец, 2026-11-23: «при самостоятельных переходах
 * объектов не показывать оповещение о смене и возможности обратно
 * перейти») — ни тоста «Объект: …», ни «Вернуться на …».
 */

export function useSwitchBuilding(options: { canManagePoints?: boolean } = {}) {
  const t = useTranslations("navigation.shell.point");
  const router = useRouter();
  const pathname = usePathname();
  const { refreshAfter, pendingTag, isPending } = useContentTransition();

  async function postBuilding(buildingId: string): Promise<boolean> {
    try {
      const response = await fetch("/api/me/active-building", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ buildingId }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error ?? t("failed"));
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("failed"));
      return false;
    }
  }

  /** Выбрать объект: запрос смены и переход, без тоста. */
  function switchTo(building: BuildingOption, activeBuildingId: string | null) {
    if (isPending) return;
    // Выбор ведёт в раздел, который у выбранного есть (2026-11-10): объект,
    // выбранный на главной или в разделе всей компании, открывает свою страницу.
    const href = hrefAfterPointSwitch({
      pathname,
      target: { id: building.id, office: isOfficeBuilding(building) },
      canManagePoints: options.canManagePoints === true,
      hasPlaceParam: new URLSearchParams(window.location.search).has("place"),
    });
    // Человек выбрал сам — запомненный объект «до перехода» больше не нужен.
    forgetReturnPoint();
    if (building.id === activeBuildingId) {
      // Объект уже выбран: менять нечего, но его раздел открываем — нажатие
      // на главной не должно оставаться без ответа.
      if (href) router.push(href);
      return;
    }
    refreshAfter(building.id, async () => {
      const ok = await postBuilding(building.id);
      // Переход — после записи выбора: новая страница соберётся уже для него.
      if (ok && href) router.push(href);
      return ok;
    });
  }

  return { switchTo, busyId: pendingTag };
}

/**
 * Тот же список плоскими кнопками — для листа «Объекты» на телефоне. Подписи
 * «Объекты» нет: она уже в заголовке листа. Офиса в списке нет — он не объект
 * (2026-11-23). Высота ограничена, справа полоса прокрутки (`ScrollList`),
 * чтобы «Создать объект» под списком было на виду и при двадцати объектах.
 */
export function LocationSwitcherList({
  buildings,
  activeBuildingId,
  canManagePoints,
  onChoose,
  pinnedIds,
  onTogglePin,
}: {
  buildings: BuildingOption[];
  /** Выбранный объект; null — «Выберите объект», выбранного нет. */
  activeBuildingId: string | null;
  /** Есть доступ к страницам точек — выбор точки может открыть её страницу. */
  canManagePoints?: boolean;
  /** Свой выбор (один объект без деления журналов) вместо смены объекта. */
  onChoose?: (buildingId: string) => void;
  /** Закреплённые скрепкой объекты; нет — скрепки в строках нет. */
  pinnedIds?: readonly string[];
  onTogglePin?: (buildingId: string) => void;
}) {
  const { switchTo, busyId } = useSwitchBuilding({ canManagePoints });
  const tPoint = useTranslations("navigation.shell.point");
  const [query, setQuery] = useState("");
  if (buildings.length === 0) return null;
  const activeId = activeBuildingId;
  // Быстрый поиск (владелец, 2026-11-11): по названию и адресу, «ё» = «е».
  const normalized = normalizeJournalSearch(query);
  const shown = normalized
    ? buildings.filter((building) => journalMatchesQuery([building.name, building.address], normalized))
    : buildings;

  return (
    <>
    {buildings.length > POINT_SEARCH_MIN ? (
      <PointSearchField value={query} onChange={setQuery} placeholder={tPoint("search")} className="mb-2" />
    ) : null}
    <ScrollList
      maxHeightClassName="max-h-[min(52vh,440px)] supports-[height:100dvh]:max-h-[min(52dvh,440px)]"
      className="mb-1 border-b border-[#ececf4] pb-2"
    >
      {shown.map((building) => {
        const isActive = building.id === activeId;
        return (
          <Fragment key={building.id}>
            <div className="group relative flex items-center">
            <button
              type="button"
              data-location-option={building.id}
              data-active-option={isActive ? "" : undefined}
              onClick={() => (onChoose ? onChoose(building.id) : void switchTo(building, activeId))}
              className={cn(
                "flex min-h-[52px] w-full items-center gap-3 rounded-2xl px-3 py-2 text-left text-[15.5px] font-medium transition-colors",
                isActive ? "bg-[#f1f3ff] text-[#3848c7]" : "text-[#0b1024] hover:bg-[#fafbff] active:bg-[#f1f3ff]",
              )}
            >
              {/* Плашка иконки одного размера у всех строк — ряд ровный. У
                  выбранной своей заливки нет: строка уже подсвечена, двойной
                  фон рябил (владелец, 2026-11-22). */}
              <span
                data-point-icon
                className={cn(
                  "inline-flex size-9 shrink-0 items-center justify-center rounded-xl",
                  isActive ? "bg-transparent text-[#5566f6]" : "border border-[#ececf4] bg-white text-[#6f7282]",
                )}
              >
                <BuildingIcon icon={building.icon} className="size-[18px]" uploadClassName="size-7" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate">{building.name}</span>
                {building.address ? (
                  <span className="block truncate text-[12.5px] font-normal text-[#9b9fb3]">{building.address}</span>
                ) : null}
              </span>
              {busyId === building.id ? (
                <Loader2 className="size-4 shrink-0 animate-spin text-[#5566f6]" />
              ) : isActive ? (
                <Check className="size-4 shrink-0 text-[#5566f6]" />
              ) : null}
              {/* Место под скрепку справа — сама кнопка лежит поверх строки. */}
              {onTogglePin ? <span aria-hidden className="w-8 shrink-0" /> : null}
            </button>
            {onTogglePin ? (
              <PinButton
                pinned={pinnedIds?.includes(building.id) === true}
                onToggle={() => onTogglePin(building.id)}
                name={building.name}
                className="absolute right-2 size-9"
              />
            ) : null}
            </div>
          </Fragment>
        );
      })}
    </ScrollList>
    {shown.length === 0 ? (
      <p className="px-3 py-4 text-center text-[14px] text-[#6f7282]">{tPoint("nothingFound")}</p>
    ) : null}
    </>
  );
}

/** Сколько точек, чтобы показать поиск. */
export const POINT_SEARCH_MIN = 4;

/** Поле быстрого поиска по объектам (лист на телефоне и меню в шапке). */
export function PointSearchField({
  value,
  onChange,
  placeholder,
  className,
  onKeyDown,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  className?: string;
  onKeyDown?: (event: React.KeyboardEvent<HTMLInputElement>) => void;
}) {
  return (
    <label className={cn("relative block", className)}>
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-[#9b9fb3]" aria-hidden />
      <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-11 w-full rounded-xl border border-[#dcdfed] bg-white pr-3 pl-9 text-[15px] text-[#0b1024] placeholder:text-[#9b9fb3] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
      />
    </label>
  );
}
