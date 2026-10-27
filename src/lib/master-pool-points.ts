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
