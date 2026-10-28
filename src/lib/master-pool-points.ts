/**
 * Точки в мастер-кабинете — чистая часть без БД (2026-10-28).
 *
 * Владелец: «каждая точка имеет свой уникальный ID журнала бракеража,
 * независимо от организации. Именно по ним объединяется выгрузка».
 * Точка со своими журналами — торговая точка (не офис) организации, которая
 * ведёт журналы по точкам (`perLocationJournals`). У такой организации
 * кабинет работает с точками: организация, подключённая целиком, — это все
 * её точки (`listPoolOrganizations`), а новая точка подключается своим кодом
 * (`Building.serviceCode`).
 */

export type PointBuilding = {
  id: string;
  name: string;
  kind?: string | null;
  linkedServiceCode?: string | null;
};

/** Торговые точки со своими журналами; пусто — организация ведёт журналы целиком. */
export function journalPointsOf<T extends PointBuilding>(
  org: { perLocationJournals: boolean },
  buildings: readonly T[]
): T[] {
  if (!org.perLocationJournals) return [];
  return buildings.filter((building) => building.kind !== "office");
}

/**
 * Точки организации, которую кабинет с кодом `poolCode` получил целиком: все
 * её точки со своими журналами, кроме подключённых своим кодом к другому
 * кабинету (точки независимы между кабинетами).
 */
export function wholeOrgPoints<T extends PointBuilding>(
  org: { perLocationJournals: boolean },
  buildings: readonly T[],
  poolCode: string
): T[] {
  return journalPointsOf(org, buildings).filter(
    (building) => !building.linkedServiceCode || building.linkedServiceCode === poolCode
  );
}

/** Объект организации в кабинете: точка (`building`) или организация целиком (`null`). */
export type OrgPoolObject<T> = {
  building: T | null;
  /** Попала в кабинет вместе с организацией (организация подключена целиком). */
  whole: boolean;
  /**
   * Можно отключить со страницы организации. Нельзя — организация сама
   * держит код кабинета (кабинет создан из неё по старой схеме).
   */
  canDisconnect: boolean;
};

/**
 * Что из организации стоит в кабинете с кодом `poolCode` — то же правило,
 * что у `listPoolOrganizations` (страница «Мастер-кабинет» организации,
 * скан 99 от 2026-10-28): организация в кабинете целиком — её точки со
 * своими журналами (без точек — она сама); иначе — точки, подключённые
 * своим кодом.
 */
export function orgObjectsInPool<T extends PointBuilding>(
  org: { perLocationJournals: boolean; serviceCode: string | null; linkedServiceCode: string | null },
  buildings: readonly T[],
  poolCode: string | null
): OrgPoolObject<T>[] {
  if (!poolCode) return [];
  const orgCode = org.linkedServiceCode ?? org.serviceCode;
  if (orgCode === poolCode) {
    const canDisconnect = org.linkedServiceCode === poolCode;
    if (journalPointsOf(org, buildings).length === 0) return [{ building: null, whole: true, canDisconnect }];
    return wholeOrgPoints(org, buildings, poolCode).map((building) => ({ building, whole: true, canDisconnect }));
  }
  return buildings
    .filter((building) => building.linkedServiceCode === poolCode)
    .map((building) => ({ building, whole: false, canDisconnect: true }));
}

/**
 * Код кабинета, в котором сейчас объект организации: точка — своей
 * привязкой или вместе с организацией; организация — своей привязкой или
 * своим кодом. `cabinetCodes` — коды существующих кабинетов (свой код
 * организации без кабинета — это не подключение).
 */
export function poolCodeOfObject(
  org: { perLocationJournals: boolean; serviceCode: string | null; linkedServiceCode: string | null },
  building: PointBuilding | null,
  cabinetCodes: ReadonlySet<string>
): string | null {
  if (building?.linkedServiceCode && cabinetCodes.has(building.linkedServiceCode)) return building.linkedServiceCode;
  const orgCode = org.linkedServiceCode ?? org.serviceCode;
  if (!orgCode || !cabinetCodes.has(orgCode)) return null;
  if (!building) return orgCode;
  // Точка, подключённая своим кодом к другому кабинету, — не в кабинете организации.
  return wholeOrgPoints(org, [building], orgCode).length > 0 ? orgCode : null;
}
