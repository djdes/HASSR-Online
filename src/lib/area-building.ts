/**
 * Цех (`Area`) ↔ точка (`Building`) — чистые функции без БД.
 *
 * С 2026-10-17 цех знает свою точку (`Area.buildingId`, необязательно):
 * схема «точка → помещения → оборудование» (план, раздел 4.3). Связь
 * выводится из уже существующего зеркала «помещение (`Room`) ↔ цех (`Area`)
 * по названию»: помещение живёт в точке, одноимённый цех — его зеркало.
 *
 * Здесь: план однократного заполнения, выбор зеркального цеха помещения,
 * группировка списков по точкам и варианты «точка → помещение» для окна
 * оборудования. Тесты — `area-building.test.ts`.
 */
import { normalizePlaceName } from "@/lib/orphan-areas";

export type PlaceBuilding = { id: string; name: string; address?: string | null };

// ---------- заполнение buildingId у существующих цехов

export type BackfillArea = {
  id: string;
  organizationId: string;
  name: string;
  buildingId: string | null;
};

export type BackfillRoom = { organizationId: string; buildingId: string; name: string };

export type BackfillBuilding = { id: string; organizationId: string };

export type AreaBuildingAssignment = {
  areaId: string;
  buildingId: string;
  /** `room-name` — одноимённое помещение в одной точке; `single-building` — точка у организации одна. */
  reason: "room-name" | "single-building";
};

export type AreaBuildingSkip = {
  areaId: string;
  /** `ambiguous` — одноимённые помещения в нескольких точках; `no-match` — помещения нет, точек несколько; `no-buildings` — точек нет. */
  reason: "ambiguous" | "no-match" | "no-buildings";
};

/**
 * Какие цеха получат точку. Уже заполненные не трогаем — повторный прогон
 * ничего не меняет. Неоднозначное не угадываем: такой цех остаётся
 * «без точки» и виден на каждой точке, руководитель выберет сам.
 */
export function planAreaBuildingBackfill(input: {
  areas: ReadonlyArray<BackfillArea>;
  rooms: ReadonlyArray<BackfillRoom>;
  buildings: ReadonlyArray<BackfillBuilding>;
}): { assign: AreaBuildingAssignment[]; skipped: AreaBuildingSkip[] } {
  const buildingsByOrg = new Map<string, string[]>();
  for (const building of input.buildings) {
    const list = buildingsByOrg.get(building.organizationId) ?? [];
    list.push(building.id);
    buildingsByOrg.set(building.organizationId, list);
  }
  // org → нормализованное название помещения → точки, где оно есть.
  const roomBuildings = new Map<string, Map<string, Set<string>>>();
  for (const room of input.rooms) {
    const key = normalizePlaceName(room.name);
    if (!key) continue;
    const byName = roomBuildings.get(room.organizationId) ?? new Map<string, Set<string>>();
    const set = byName.get(key) ?? new Set<string>();
    set.add(room.buildingId);
    byName.set(key, set);
    roomBuildings.set(room.organizationId, byName);
  }

  const assign: AreaBuildingAssignment[] = [];
  const skipped: AreaBuildingSkip[] = [];
  for (const area of input.areas) {
    if (area.buildingId) continue;
    const orgBuildings = buildingsByOrg.get(area.organizationId) ?? [];
    if (orgBuildings.length === 0) {
      skipped.push({ areaId: area.id, reason: "no-buildings" });
      continue;
    }
    const matches = [
      ...(roomBuildings.get(area.organizationId)?.get(normalizePlaceName(area.name)) ?? []),
    ].filter((id) => orgBuildings.includes(id));
    if (matches.length === 1) {
      assign.push({ areaId: area.id, buildingId: matches[0], reason: "room-name" });
    } else if (matches.length > 1) {
      skipped.push({ areaId: area.id, reason: "ambiguous" });
    } else if (orgBuildings.length === 1) {
      assign.push({ areaId: area.id, buildingId: orgBuildings[0], reason: "single-building" });
    } else {
      skipped.push({ areaId: area.id, reason: "no-match" });
    }
  }
  return { assign, skipped };
}

// ---------- зеркальный цех помещения

export type MirrorCandidate = { id: string; name: string; buildingId: string | null };

/**
 * Зеркальный цех помещения точки: одноимённый цех этой точки, иначе
 * одноимённый цех без точки (его точка заполнится). Цех другой точки —
 * чужое зеркало: у «Кухни» точки 1 и «Кухни» точки 2 разные цеха.
 */
export function pickMirrorArea<T extends MirrorCandidate>(
  areas: ReadonlyArray<T>,
  roomName: string,
  buildingId: string,
): T | null {
  const key = normalizePlaceName(roomName);
  if (!key) return null;
  const same = areas.filter((area) => normalizePlaceName(area.name) === key);
  return (
    same.find((area) => area.buildingId === buildingId) ??
    same.find((area) => !area.buildingId) ??
    null
  );
}

// ---------- группировка по точкам

export type BuildingGroup<T> = {
  /** `null` — «Без точки»: цеха, у которых точка не выбрана. */
  building: PlaceBuilding | null;
  items: T[];
};

/**
 * Список по точкам в порядке `buildings` (он уже отсортирован). Выбрана
 * точка в шапке — только она и «без точки»: цех без точки может стоять
 * где угодно, прятать его нельзя. Пустые точки остаются (`keepEmpty`),
 * чтобы было видно, что в точке ещё ничего нет. «Без точки» — в конце и
 * только если не пусто. Предмет с точкой не из списка (удалена, чужая) —
 * тоже «без точки».
 */
export function groupByBuilding<T>(
  items: ReadonlyArray<T>,
  buildingIdOf: (item: T) => string | null,
  buildings: ReadonlyArray<PlaceBuilding>,
  options: { activeBuildingId?: string | null; keepEmpty?: boolean } = {},
): BuildingGroup<T>[] {
  const known = new Set(buildings.map((building) => building.id));
  const active =
    options.activeBuildingId && known.has(options.activeBuildingId) ? options.activeBuildingId : null;
  const visible = active ? buildings.filter((building) => building.id === active) : buildings;
  const groups: BuildingGroup<T>[] = visible.map((building) => ({
    building,
    items: items.filter((item) => buildingIdOf(item) === building.id),
  }));
  const loose = items.filter((item) => {
    const id = buildingIdOf(item);
    return !id || !known.has(id);
  });
  const result = options.keepEmpty ? groups : groups.filter((group) => group.items.length > 0);
  if (loose.length > 0) result.push({ building: null, items: loose });
  return result;
}

// ---------- «точка → помещение» для окна оборудования

export type PlaceOption = {
  /** Ключ для `<Select>`: `area:<id>` или `room:<id>`. */
  key: string;
  name: string;
  areaId: string | null;
  /** Помещение без зеркального цеха: сервер создаст цех при сохранении. */
  roomId: string | null;
};

/**
 * Помещения точки для выбора в окне оборудования: цеха этой точки и
 * помещения, у которых цеха ещё нет (старые данные до зеркала). Цеха без
 * точки — отдельным списком: их можно выбрать на любой точке.
 */
export function buildPlaceOptions(input: {
  buildings: ReadonlyArray<PlaceBuilding>;
  areas: ReadonlyArray<MirrorCandidate>;
  rooms: ReadonlyArray<{ id: string; name: string; buildingId: string }>;
}): { byBuilding: Record<string, PlaceOption[]>; loose: PlaceOption[] } {
  const known = new Set(input.buildings.map((building) => building.id));
  const sortByName = (a: PlaceOption, b: PlaceOption) => a.name.localeCompare(b.name, "ru");
  const byBuilding: Record<string, PlaceOption[]> = {};
  for (const building of input.buildings) {
    const own = input.areas.filter((area) => area.buildingId === building.id);
    const options: PlaceOption[] = own.map((area) => ({
      key: `area:${area.id}`,
      name: area.name,
      areaId: area.id,
      roomId: null,
    }));
    const taken = new Set(own.map((area) => normalizePlaceName(area.name)));
    for (const room of input.rooms) {
      if (room.buildingId !== building.id) continue;
      const key = normalizePlaceName(room.name);
      if (!key || taken.has(key)) continue;
      taken.add(key);
      options.push({ key: `room:${room.id}`, name: room.name, areaId: null, roomId: room.id });
    }
    byBuilding[building.id] = options.sort(sortByName);
  }
  const loose = input.areas
    .filter((area) => !area.buildingId || !known.has(area.buildingId))
    .map((area) => ({ key: `area:${area.id}`, name: area.name, areaId: area.id, roomId: null }))
    .sort(sortByName);
  return { byBuilding, loose };
}
