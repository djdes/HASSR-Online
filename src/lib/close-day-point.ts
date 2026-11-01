import type { BuildingContext } from "@/lib/building-scope";

/**
 * «Закрыть день» (кнопка «Автозаполнить» на главной, ⌘K) заполняет журналы
 * одной точки. На уровне организации — офис или «Вся организация» — день
 * закрывался только офису (без офиса — первой точке), хотя кнопка выглядит
 * как «для всех». Владелец 2026-11-01: «требовать выбрать точку».
 */
export const CLOSE_DAY_POINT_REQUIRED =
  "Выберите точку в шапке: автозаполнение закрывает день одной точки, а не всей организации.";

/** Режим точек и смотрят на уровень всей организации — сначала выбрать точку. */
export function closeDayNeedsPoint(context: Pick<BuildingContext, "enabled" | "organizationView">): boolean {
  return context.enabled && context.organizationView;
}
