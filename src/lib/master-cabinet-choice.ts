/**
 * Окно «Новый мастер-кабинет» (меню профиля → «Кабинет») — чистая часть
 * без БД.
 *
 * Мастер-кабинетов у аккаунта сколько угодно (владелец, 2026-09-30:
 * «один на школы, один на сады»). Каждый новый кабинет получает свой код
 * справочника, отмеченные объекты подключаются к этому коду. Источник
 * меню и сырья у объекта один: если объект получал их из другого
 * кабинета, он переходит в новый — окно об этом предупреждает.
 */

/** Больше объектов пул не читает (`POOL_MAX_ORGS` в dish-pool.ts: 50 вместе с кабинетом). */
export const MASTER_CABINET_OBJECTS_MAX = 49;

export type MasterCabinetObject = {
  id: string;
  name: string;
  /** Кабинет, из которого объект сейчас получает меню и сырьё; нет — null. */
  currentCabinet: { id: string; name: string } | null;
};

type PoolCodes = { serviceCode: string | null; linkedServiceCode: string | null };

/** Код пула: чужой, к которому подключились, иначе свой. */
export function poolCodeOf(org: PoolCodes | null | undefined): string | null {
  return org?.linkedServiceCode ?? org?.serviceCode ?? null;
}

/**
 * Кабинет каждого объекта: первый по дате создания кабинет с тем же кодом
 * пула — так же, как выбирает `findPoolMasterOrgId`. `cabinets` — уже
 * отсортированы по дате создания.
 */
export function mapObjectsToCabinets(
  objects: ReadonlyArray<{ id: string; name: string } & PoolCodes>,
  cabinets: ReadonlyArray<{ id: string; name: string } & PoolCodes>
): MasterCabinetObject[] {
  const byCode = new Map<string, { id: string; name: string }>();
  for (const cabinet of cabinets) {
    const code = poolCodeOf(cabinet);
    if (code && !byCode.has(code)) byCode.set(code, { id: cabinet.id, name: cabinet.name });
  }
  return objects.map((object) => {
    const code = poolCodeOf(object);
    return { id: object.id, name: object.name, currentCabinet: (code && byCode.get(code)) || null };
  });
}

/** Отмечены сразу объекты без кабинета — у нового аккаунта это все объекты. */
export function initialMasterCabinetSelection(objects: readonly MasterCabinetObject[]): string[] {
  return objects.filter((object) => !object.currentCabinet).map((object) => object.id);
}

export type MasterCabinetChoiceSummary = {
  selected: number;
  /** Сколько отмеченных объектов уходит из каждого прежнего кабинета. */
  moving: Array<{ cabinetName: string; count: number }>;
};

export function summarizeMasterCabinetChoice(
  objects: readonly MasterCabinetObject[],
  selectedIds: readonly string[]
): MasterCabinetChoiceSummary {
  const selected = new Set(selectedIds);
  const moving = new Map<string, { cabinetName: string; count: number }>();
  let count = 0;
  for (const object of objects) {
    if (!selected.has(object.id)) continue;
    count += 1;
    if (!object.currentCabinet) continue;
    const entry = moving.get(object.currentCabinet.id) ?? { cabinetName: object.currentCabinet.name, count: 0 };
    entry.count += 1;
    moving.set(object.currentCabinet.id, entry);
  }
  return { selected: count, moving: [...moving.values()] };
}

/** id объектов из запроса: только непустые строки, без повторов. */
export function normalizeObjectIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter((id): id is string => typeof id === "string" && id.trim().length > 0))];
}
