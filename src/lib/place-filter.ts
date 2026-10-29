/**
 * Фильтр «по местам» над списками — как «Где работает» у сотрудников
 * (2026-10-28, владелец: «Журналы точек», «Цеха» и «Оборудование» —
 * «так, как на вкладке Сотрудники»). Чистые функции, без БД.
 *
 * Выбор живёт в адресе (`?place=`): id точки или офиса, `none` — без точки,
 * `all` — все. На этих вкладках это единственный выбор точки: переключатель
 * в шапке там скрыт (2026-10-29, партнёр: «один список — или сверху, или
 * снизу»), страницы передают `headerPointId: null`, и без выбора — «Все».
 */

import { isOfficeBuilding } from "@/lib/building-scope";

export const PLACE_ALL = "all";
export const PLACE_NONE = "none";

/** Значение `?place=` из параметров страницы (первое, если их несколько). */
export function placeFilterParam(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  const id = raw?.trim();
  return id ? id : null;
}

/**
 * Какое место отмечено: id места, `none` или null («Все»). Чужой или
 * удалённый id в адресе — как будто выбора нет.
 */
export function resolvePlaceFilter(args: {
  requested: string | null;
  places: readonly string[];
  /** Есть «Без точки» (объекты без места). */
  hasNone: boolean;
  /** Торговая точка из шапки; null — «Вся организация». */
  headerPointId: string | null;
}): string | null {
  const { requested, places, hasNone, headerPointId } = args;
  if (requested === PLACE_ALL) return null;
  if (requested === PLACE_NONE && hasNone) return PLACE_NONE;
  if (requested && places.includes(requested)) return requested;
  return headerPointId && places.includes(headerPointId) ? headerPointId : null;
}

/**
 * Объекты и места в пределах человека («Цеха», «Оборудование»): точки, которые
 * ему доступны (`scopeIds`, как в переключателе шапки; null — без
 * ограничения), и объекты без точки — они общие. Офис — место, только если у
 * него есть свои объекты. Объекты чужих точек не попадают никуда, даже в
 * «Без точки» (руководитель точки раньше видел только свою точку).
 */
export function scopePlaces<T, B extends { id: string; kind?: string }>(args: {
  items: readonly T[];
  buildingIdOf: (item: T) => string | null;
  /** Все здания организации. */
  buildings: readonly B[];
  scopeIds: ReadonlySet<string> | null;
}): { items: T[]; buildings: B[]; loose: T[] } {
  const orgIds = new Set(args.buildings.map((building) => building.id));
  const known = (id: string | null) => Boolean(id && orgIds.has(id));
  const inScope = (id: string | null) => !id || !orgIds.has(id) || !args.scopeIds || args.scopeIds.has(id);
  const items = args.items.filter((item) => inScope(args.buildingIdOf(item)));
  const buildings = args.buildings.filter(
    (building) =>
      (!args.scopeIds || args.scopeIds.has(building.id)) &&
      (!isOfficeBuilding(building) || items.some((item) => args.buildingIdOf(item) === building.id)),
  );
  const loose = items.filter((item) => !known(args.buildingIdOf(item)));
  return { items, buildings, loose };
}

/** Подходит ли объект с местом `placeId` под отмеченное место. */
export function matchesPlace(active: string | null, placeId: string | null | undefined): boolean {
  if (active === null) return true;
  if (active === PLACE_NONE) return !placeId;
  return placeId === active;
}
