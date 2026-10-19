/**
 * Штатная численность должностей: «занято N из M».
 *
 * План — `JobPosition.plannedHeadcount` (null = не задан). Занято —
 * активные сотрудники должности, не в архиве. Чистый модуль: его читают
 * `GET /api/positions`, страница «Сотрудники» и будущая страница
 * «Должности».
 */

import { z } from "zod";

export const PLANNED_HEADCOUNT_MAX = 999;

const PLANNED_HEADCOUNT_MESSAGE = "Штатная численность — целое число от 0 до 999";

/** Штатная численность в запросе: целое 0…999 или null («не задано»). */
export const plannedHeadcountSchema = z
  .number({ message: PLANNED_HEADCOUNT_MESSAGE })
  .int(PLANNED_HEADCOUNT_MESSAGE)
  .min(0, PLANNED_HEADCOUNT_MESSAGE)
  .max(PLANNED_HEADCOUNT_MAX, PLANNED_HEADCOUNT_MESSAGE)
  .nullable();

export type StaffingMember = {
  jobPositionId: string | null;
  isActive: boolean;
  /** Не передан — человек не в архиве (страница уже отфильтровала архив). */
  archivedAt?: Date | string | null;
};

export type PositionStaffing = {
  plannedHeadcount: number | null;
  occupied: number;
  /** Свободных мест по плану; 0, если план не задан или выполнен. */
  vacancies: number;
  /** Сколько человек сверх плана; 0, если план не задан или не превышен. */
  overstaffed: number;
  /** «занято 3 из 5» или «занято 3», если план не задан. */
  staffingLabel: string;
};

export type StaffingTotals = {
  positions: number;
  /** Должностей с заданной штатной численностью. */
  withPlan: number;
  /** Сумма плана по должностям, где он задан. */
  planned: number;
  /** Занято на всех должностях. */
  occupied: number;
  /** Занято на должностях с планом — то, что сравнивается с `planned`. */
  occupiedPlanned: number;
  vacancies: number;
  overstaffed: number;
  staffingLabel: string;
};

/** Человек занимает место: активен и не в архиве. */
export function occupiesSeat(member: StaffingMember): boolean {
  return member.isActive === true && !member.archivedAt;
}

/** Занятые места по id должности. */
export function countOccupiedByPosition(members: readonly StaffingMember[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const member of members) {
    if (!member.jobPositionId || !occupiesSeat(member)) continue;
    counts.set(member.jobPositionId, (counts.get(member.jobPositionId) ?? 0) + 1);
  }
  return counts;
}

export function staffingLabel(occupied: number, planned: number | null): string {
  return planned === null ? `занято ${occupied}` : `занято ${occupied} из ${planned}`;
}

export function positionStaffing(plannedHeadcount: number | null | undefined, occupied: number): PositionStaffing {
  const planned = normalizePlannedHeadcount(plannedHeadcount);
  return {
    plannedHeadcount: planned,
    occupied,
    vacancies: planned === null ? 0 : Math.max(0, planned - occupied),
    overstaffed: planned === null ? 0 : Math.max(0, occupied - planned),
    staffingLabel: staffingLabel(occupied, planned),
  };
}

export function staffingTotals(rows: readonly PositionStaffing[]): StaffingTotals {
  let withPlan = 0;
  let planned = 0;
  let occupied = 0;
  let occupiedPlanned = 0;
  let vacancies = 0;
  let overstaffed = 0;
  for (const row of rows) {
    occupied += row.occupied;
    vacancies += row.vacancies;
    overstaffed += row.overstaffed;
    if (row.plannedHeadcount === null) continue;
    withPlan += 1;
    planned += row.plannedHeadcount;
    occupiedPlanned += row.occupied;
  }
  return {
    positions: rows.length,
    withPlan,
    planned,
    occupied,
    occupiedPlanned,
    vacancies,
    overstaffed,
    staffingLabel: withPlan === 0 ? staffingLabel(occupied, null) : staffingLabel(occupiedPlanned, planned),
  };
}

/** Штат по каждой должности и итоги организации. */
export function computeStaffing<P extends { id: string; plannedHeadcount: number | null }>(
  positions: readonly P[],
  members: readonly StaffingMember[]
): { positions: Array<P & PositionStaffing>; totals: StaffingTotals } {
  const counts = countOccupiedByPosition(members);
  const rows = positions.map((position) => ({
    ...position,
    ...positionStaffing(position.plannedHeadcount, counts.get(position.id) ?? 0),
  }));
  return { positions: rows, totals: staffingTotals(rows) };
}

/** Мусор и отрицательные значения из базы — «не задано». */
function normalizePlannedHeadcount(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) return null;
  return Math.min(value, PLANNED_HEADCOUNT_MAX);
}

/**
 * Новый порядок должностей (`sortOrder`): присланные — первыми и в
 * присланном порядке, остальные — следом, в прежнем порядке. `current` —
 * должности организации, отсортированные как сейчас.
 */
export function planPositionOrder(current: readonly { id: string }[], ids: readonly string[]): Map<string, number> {
  const order = new Map<string, number>();
  for (const id of ids) {
    if (!order.has(id)) order.set(id, order.size + 1);
  }
  for (const position of current) {
    if (!order.has(position.id)) order.set(position.id, order.size + 1);
  }
  return order;
}

/** Категории должностей в порядке показа (`JobPosition.categoryKey`). */
export const POSITION_CATEGORIES = ["management", "staff", "commission"] as const;
export type PositionCategoryKey = (typeof POSITION_CATEGORIES)[number];

/** Неизвестная категория из базы — «Сотрудники» (как на странице сотрудников). */
export function positionCategoryOf(categoryKey: string | null | undefined): PositionCategoryKey {
  return categoryKey === "management" || categoryKey === "commission" ? categoryKey : "staff";
}

/**
 * Сдвиг должности «выше» (-1) или «ниже» (+1) внутри её категории. `ordered` —
 * все должности организации в порядке показа. Возвращает новый порядок всех
 * id для `PUT /api/positions/order` или null, если двигать некуда.
 */
export function movePositionWithinCategory(
  ordered: readonly { id: string; categoryKey: string }[],
  id: string,
  direction: -1 | 1
): string[] | null {
  const index = ordered.findIndex((position) => position.id === id);
  if (index < 0) return null;
  const category = positionCategoryOf(ordered[index].categoryKey);
  let neighbour = index + direction;
  while (
    neighbour >= 0 &&
    neighbour < ordered.length &&
    positionCategoryOf(ordered[neighbour].categoryKey) !== category
  ) {
    neighbour += direction;
  }
  if (neighbour < 0 || neighbour >= ordered.length) return null;
  const ids = ordered.map((position) => position.id);
  [ids[index], ids[neighbour]] = [ids[neighbour], ids[index]];
  return ids;
}

/**
 * Значение из запроса: целое 0…999 или null («не задано»). `undefined` —
 * поле не прислали (не менять). Всё остальное — ошибка.
 */
export function parsePlannedHeadcount(
  value: unknown
): { ok: true; value: number | null | undefined } | { ok: false } {
  if (value === undefined) return { ok: true, value: undefined };
  const parsed = plannedHeadcountSchema.safeParse(value);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false };
}
