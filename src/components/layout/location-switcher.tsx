"use client";

import { Fragment } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Building2, Check, Loader2, Store } from "lucide-react";
import { toast } from "sonner";
import { isOfficeBuilding, type BuildingOption } from "@/lib/building-scope";
import { hrefAfterPointSwitch } from "@/lib/point-section-sync";
import { cn } from "@/lib/utils";
import { useContentTransition } from "@/components/layout/content-transition";
import { forgetReturnPoint } from "@/components/layout/point-section-sync";
import { showPointSwitchToast, shortPointName } from "@/components/layout/point-switch-toast";
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

  /**
   * `previous` — что было выбрано до нажатия: тост предложит вернуться к нему
   * (владелец, 2026-11-11: короткий тост с отсчётом и «вернуться» — и при
   * ручной смене, как при автосмене).
   */
  function switchTo(building: BuildingOption, activeBuildingId: string | null, previous?: BuildingOption | null) {
    if (isPending) return;
    // Выбор ведёт в раздел, который у выбранного есть (2026-11-10): точка,
    // выбранная на главной или в разделе всей компании, открывает свою
    // страницу; офис, выбранный на странице точки, — список точек.
    const href = hrefAfterPointSwitch({
      pathname,
      target: { id: building.id, office: isOfficeBuilding(building) },
      canManagePoints: options.canManagePoints === true,
      hasPlaceParam: new URLSearchParams(window.location.search).has("place"),
    });
    // Человек выбрал сам — «вернуть точку по „назад“» больше не нужно.
    forgetReturnPoint();
    if (building.id === activeBuildingId) {
      // Точка уже выбрана: менять нечего, но её раздел открываем — нажатие
      // на главной не должно оставаться без ответа.
      if (href) router.push(href);
      return;
    }
    // Откуда ушли — чтобы «вернуться» привело и на ту же страницу.
    const fromHref = `${pathname}${window.location.search}`;
    const back =
      previous && previous.id !== building.id
        ? {
            label: t("returnTo", { name: shortPointName(previous.name) }),
            onClick: () => {
              forgetReturnPoint();
              refreshAfter(
                previous.id,
                async () => {
                  const ok = await postBuilding(previous.id);
                  // Выбор увёл на другую страницу — вернуть и её.
                  if (ok && href) router.push(fromHref);
                  return ok;
                },
                () => showPointSwitchToast(t("switched", { name: previous.name })),
              );
            },
          }
        : null;
    refreshAfter(
      building.id,
      async () => {
        const ok = await postBuilding(building.id);
        // Переход — после записи выбора: новая страница соберётся уже для него.
        if (ok && href) router.push(href);
        return ok;
      },
      () => showPointSwitchToast(t("switched", { name: building.name }), back),
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
  canManagePoints,
}: {
  buildings: BuildingOption[];
  activeBuildingId: string | null;
  /** Есть доступ к страницам точек — выбор точки может открыть её страницу. */
  canManagePoints?: boolean;
}) {
  const { switchTo, busyId } = useSwitchBuilding({ canManagePoints });
  if (buildings.length < 2) return null;
  const activeId = activeBuildingId ?? buildings[0]?.id ?? null;

  return (
    <ScrollList
      maxHeightClassName="max-h-[min(52vh,440px)] supports-[height:100dvh]:max-h-[min(52dvh,440px)]"
      className="mb-1 border-b border-[#ececf4] pb-2"
    >
      {buildings.map((building, index) => {
        const isActive = building.id === activeId;
        const office = isOfficeBuilding(building);
        const Icon = office ? Building2 : Store;
        return (
          <Fragment key={building.id}>
            <button
              type="button"
              data-location-option={building.id}
              data-active-option={isActive ? "" : undefined}
              onClick={() => void switchTo(building, activeId, buildings.find((item) => item.id === activeId) ?? null)}
              className={cn(
                "flex min-h-[52px] w-full items-center gap-3 rounded-2xl px-3 py-2 text-left text-[15.5px] font-medium transition-colors",
                isActive ? "bg-[#f1f3ff] text-[#3848c7]" : "text-[#0b1024] hover:bg-[#fafbff] active:bg-[#f1f3ff]",
              )}
            >
              <span
                className={cn(
                  "inline-flex size-9 shrink-0 items-center justify-center rounded-xl",
                  isActive ? "bg-white text-[#5566f6]" : "bg-[#f4f5fb] text-[#6f7282]",
                )}
              >
                <Icon className="size-[18px]" aria-hidden />
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
            </button>
            {/* Офис — первым, под ним черта: дальше торговые точки. */}
            {office && index < buildings.length - 1 ? <div className="mx-3 my-1 border-t border-[#ececf4]" /> : null}
          </Fragment>
        );
      })}
    </ScrollList>
  );
}
