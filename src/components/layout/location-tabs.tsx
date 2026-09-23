"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Check, Loader2, MapPinned, Settings2, Store } from "lucide-react";
import type { BuildingOption } from "@/lib/building-scope";
import { cn } from "@/lib/utils";
import { useSwitchBuilding } from "@/components/layout/location-switcher";

export type LocationTabCounter = {
  /** Заполнено сегодня обязательных журналов на точке. */
  filled: number;
  total: number;
};

/**
 * Тон счётчика «N/M»: красный < 50 %, жёлтый < 100 %, зелёный — всё
 * заполнено (или на точке нечего заполнять). Пороги — от прежней сводки
 * «Точки сегодня».
 */
export function locationCounterTone(counter: LocationTabCounter): "ok" | "warn" | "bad" {
  if (counter.total <= 0 || counter.filled >= counter.total) return "ok";
  return counter.filled / counter.total >= 0.5 ? "warn" : "bad";
}

const COUNTER_TONE_CLASS = {
  ok: "bg-[#ecfdf5] text-[#116b2a]",
  warn: "bg-[#fff8eb] text-[#8a5a12]",
  bad: "bg-[#fff4f2] text-[#a13a32]",
} as const;

/**
 * Точки (2026-09-23): строка горизонтальных вкладок «Выберите точку» над
 * страницей. Заменила выпадающую пилюлю в шапке и блок «Точки сегодня» на
 * дашборде: все точки видны сразу, нужная — в одно касание. На дашборде у
 * вкладок счётчик заполненных сегодня журналов.
 *
 * Разметка — `nav` + `aria-current`, а не `role="tablist"`: глобальный CSS
 * на телефонах переносит tablist'ы на несколько строк, а здесь нужна одна
 * строка со скроллом вбок.
 */
export function LocationTabs({
  buildings,
  activeBuildingId,
  counters,
  manageHref = null,
  className,
}: {
  buildings: BuildingOption[];
  activeBuildingId: string | null;
  /** Счётчики по id точки — только на дашборде. */
  counters?: Record<string, LocationTabCounter>;
  /** «Настроить точки» в конце строки — только полному доступу. */
  manageHref?: string | null;
  className?: string;
}) {
  const { switchTo, busyId } = useSwitchBuilding();
  const scroller = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  const activeId = activeBuildingId ?? buildings[0]?.id ?? null;

  const measure = useCallback(() => {
    const box = scroller.current;
    if (!box) return;
    const left = box.scrollLeft > 2;
    const right = box.scrollLeft + box.clientWidth < box.scrollWidth - 2;
    setEdges((prev) => (prev.left === left && prev.right === right ? prev : { left, right }));
  }, []);

  // Активная точка — в центр строки, чтобы соседи были видны с обеих сторон.
  useEffect(() => {
    const box = scroller.current;
    const current = box?.querySelector<HTMLElement>("[aria-current]");
    if (box && current) {
      box.scrollLeft = Math.max(
        0,
        current.offsetLeft - (box.clientWidth - current.offsetWidth) / 2,
      );
    }
    measure();
  }, [activeId, buildings.length, measure]);

  useEffect(() => {
    const box = scroller.current;
    if (!box || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, [measure]);

  if (buildings.length < 2) return null;

  // Затухание края — только с той стороны, куда ещё есть что листать.
  const fade = 28;
  const mask =
    edges.left || edges.right
      ? `linear-gradient(to right, ${edges.left ? "transparent" : "#000"} 0, #000 ${
          edges.left ? fade : 0
        }px, #000 calc(100% - ${edges.right ? fade : 0}px), ${
          edges.right ? "transparent" : "#000"
        } 100%)`
      : undefined;

  return (
    <nav aria-label="Точки" data-location-tabs className={cn("min-w-0", className)}>
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="inline-flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
          <MapPinned className="size-4 text-[#5566f6]" aria-hidden />
          Выберите точку
        </div>
        {counters ? (
          <div className="truncate text-[12px] text-[#9b9fb3]">заполнено сегодня</div>
        ) : null}
      </div>
      <div className="flex min-w-0 items-center gap-2">
        <div
          ref={scroller}
          onScroll={measure}
          style={mask ? { maskImage: mask, WebkitMaskImage: mask } : undefined}
          // Поля внутри скроллера — чтобы тень активной вкладки и фокус-кольцо
          // не обрезались краем прокрутки.
          className="-mx-1 -my-3 flex min-w-0 flex-nowrap gap-2 overflow-x-auto overscroll-x-contain px-1 py-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {buildings.map((building) => {
            const isActive = building.id === activeId;
            const isBusy = busyId === building.id;
            const counter = counters?.[building.id];
            const tone = counter ? locationCounterTone(counter) : null;
            return (
              <button
                key={building.id}
                type="button"
                onClick={() => void switchTo(building, activeId)}
                aria-current={isActive ? "true" : undefined}
                aria-busy={isBusy || undefined}
                title={building.address ? `${building.name}, ${building.address}` : building.name}
                className={cn(
                  "inline-flex h-11 shrink-0 items-center gap-2 rounded-2xl border px-3.5 text-[14px] font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15",
                  isActive
                    ? "cursor-default border-[#5566f6] bg-[#5566f6] text-white shadow-[0_6px_16px_-10px_rgba(85,102,246,0.6)]"
                    : "border-[#dcdfed] bg-white text-[#0b1024] hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]",
                )}
              >
                {isBusy ? (
                  <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden />
                ) : (
                  <Store
                    className={cn("size-4 shrink-0", isActive ? "text-white" : "text-[#5566f6]")}
                    aria-hidden
                  />
                )}
                <span className="max-w-[150px] truncate sm:max-w-[220px]">{building.name}</span>
                {counter && tone ? (
                  <span
                    aria-label={`заполнено ${counter.filled} из ${counter.total}`}
                    className={cn(
                      "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-semibold tabular-nums",
                      isActive ? "bg-white/20 text-white" : COUNTER_TONE_CLASS[tone],
                    )}
                  >
                    {tone === "ok" ? <Check className="size-3.5" aria-hidden /> : null}
                    {counter.filled}/{counter.total}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
        {manageHref ? (
          <Link
            href={manageHref}
            title="Настроить точки"
            aria-label="Настроить точки"
            className="inline-flex size-11 shrink-0 items-center justify-center rounded-2xl border border-[#dcdfed] bg-white text-[#5566f6] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
          >
            <Settings2 className="size-[18px]" />
          </Link>
        ) : null}
      </div>
    </nav>
  );
}

/**
 * Вкладки точек для всех страниц кабинета, кроме дашборда: там их рисует
 * сама страница — со счётчиками заполненности.
 */
export function LayoutLocationTabs(props: {
  buildings: BuildingOption[];
  activeBuildingId: string | null;
  manageHref?: string | null;
}) {
  const pathname = usePathname();
  if (pathname === "/dashboard" || props.buildings.length < 2) return null;
  return <LocationTabs {...props} className="mb-4" />;
}
