/**
 * Торговая точка на памятках (скан 97, 2026-10-28): на каждом листе под
 * шапкой печатается точка, для которой лист распечатан. Чистые функции без
 * БД — загрузка в `poster-data.server.ts`.
 *
 * Текст — как подпись точки в шапке журналов (`buildingLabel`): «наименование
 * для журналов», если задано, иначе название и адрес. Офис организации —
 * не торговая точка, памятки печатаются только для точек.
 */

import { isOfficeBuilding } from "@/lib/building-scope";

export type PosterPointSource = {
  id: string;
  name: string;
  address: string | null;
  journalName?: string | null;
  kind?: string;
};

/** Строка точки на листе: заголовок жирным и адрес обычным шрифтом. */
export type PosterPointLine = { title: string; detail: string | null };

function clean(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

/** Строка точки для листа; нет ни названия, ни адреса — null (строку не рисуем). */
export function posterPointLine(point: Omit<PosterPointSource, "id" | "kind"> | null | undefined): PosterPointLine | null {
  if (!point) return null;
  const journalName = clean(point.journalName);
  if (journalName) return { title: journalName, detail: null };
  const name = clean(point.name);
  const address = clean(point.address) || null;
  if (name) return { title: name, detail: address };
  return address ? { title: address, detail: null } : null;
}

/** Торговые точки из списка точек человека: без офиса, порядок сохраняется. */
export function posterPoints<T extends { kind?: string }>(buildings: readonly T[]): T[] {
  return buildings.filter((building) => !isOfficeBuilding(building));
}

/**
 * Точка, для которой печатаем: запрошенная (`?point=`), если она среди точек
 * человека; иначе точка из шапки кабинета; иначе первая. Точек нет — null.
 */
export function resolvePosterPoint<T extends { id: string }>(
  points: readonly T[],
  requestedId: string | null | undefined,
  headerPointId: string | null | undefined,
): T | null {
  return (
    points.find((point) => point.id === requestedId) ??
    points.find((point) => point.id === headerPointId) ??
    points[0] ??
    null
  );
}

/** Значение `?point=` из параметров страницы (первое, если их несколько). */
export function posterPointParam(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  const id = raw?.trim();
  return id ? id : null;
}
