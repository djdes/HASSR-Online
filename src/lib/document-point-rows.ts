import { equipmentBuildingWhere } from "@/lib/building-scope";
import { staffAtBuildingWhere } from "@/lib/building-settings";
import { buildingTargets } from "@/lib/building-targets";

/**
 * Строки документа точки (владелец, 2026-10-29: «в журналы конкретной точки
 * выводятся все помещения / сотрудники / оборудование организации»).
 *
 * У документа точки строки собираются только из её справочников:
 * помещения — этой точки, цеха — этой точки и цеха без точки (общие),
 * оборудование — цехов точки и цехов без точки, сотрудники — отмеченные на
 * точке или без точек (работают везде). Документ без точки или точки
 * выключены — без фильтра, как раньше.
 */
export type PointRowsWhere = {
  area: { OR?: Array<{ buildingId: string | null }> };
  room: { buildingId?: string };
  equipment: ReturnType<typeof equipmentBuildingWhere>;
  staff: ReturnType<typeof staffAtBuildingWhere>;
};

/**
 * Условия `where` для справочников документа точки. Каждое занимает
 * верхний `OR` — в запросе с другими условиями класть в `AND: [...]`.
 */
export function pointRowsWhere(pointId: string | null | undefined): PointRowsWhere {
  return {
    area: pointId ? { OR: [{ buildingId: pointId }, { buildingId: null }] } : {},
    room: pointId ? { buildingId: pointId } : {},
    equipment: equipmentBuildingWhere(pointId),
    staff: staffAtBuildingWhere(pointId),
  };
}

/** Точка документа из списка точек организации; иначе (нет точки, точки выключены, чужая) — null. */
export function rowsPointFromTargets(
  targets: ReadonlyArray<string | null>,
  buildingId: string | null | undefined,
): string | null {
  return buildingId && targets.includes(buildingId) ? buildingId : null;
}

/**
 * Сколько объектов в строках документа точки — с других точек: документ
 * собран до разделения журналов по точкам. Удалённые объекты (нет в
 * `knownIds`) и объекты точки или общие (`pointIds`) не считаются.
 */
export function countForeignRows(
  rowObjectIds: ReadonlyArray<string | null | undefined>,
  pointIds: ReadonlySet<string>,
  knownIds: ReadonlySet<string>,
): number {
  return new Set(rowObjectIds.filter((id): id is string => Boolean(id) && knownIds.has(id as string) && !pointIds.has(id as string))).size;
}

function collectStrings(value: unknown, into: Set<string>, depth = 0): void {
  if (depth > 12 || value == null) return;
  if (typeof value === "string") {
    const text = value.trim();
    if (text) into.add(text);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, into, depth + 1);
    return;
  }
  if (typeof value === "object") {
    for (const item of Object.values(value as Record<string, unknown>)) collectStrings(item, into, depth + 1);
  }
}

/**
 * Люди из списка, на которых документ уже ссылается: `employeeId` записей и
 * любая строка в конфиге / данных записей, равная id или ФИО человека.
 * Списки выбора документа точки — её сотрудники плюс эти люди, чтобы уже
 * выбранный человек другой точки не пропадал из поля (2026-10-31).
 */
export function documentReferencedUserIds(
  users: ReadonlyArray<{ id: string; name?: string | null }>,
  sources: ReadonlyArray<unknown>,
  entryEmployeeIds: Iterable<string | null | undefined>,
): Set<string> {
  const strings = new Set<string>();
  for (const source of sources) collectStrings(source, strings);
  for (const id of entryEmployeeIds) if (id) strings.add(id);
  return new Set(
    users
      .filter((user) => strings.has(user.id) || (user.name?.trim() ? strings.has(user.name.trim()) : false))
      .map((user) => user.id),
  );
}

/** Точка, по которой собираются строки документа; null — вся организация. */
export async function documentRowsPointId(
  organizationId: string,
  buildingId: string | null | undefined,
): Promise<string | null> {
  if (!buildingId) return null;
  return rowsPointFromTargets(await buildingTargets(organizationId), buildingId);
}
