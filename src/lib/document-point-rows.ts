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

/** Точка, по которой собираются строки документа; null — вся организация. */
export async function documentRowsPointId(
  organizationId: string,
  buildingId: string | null | undefined,
): Promise<string | null> {
  if (!buildingId) return null;
  return rowsPointFromTargets(await buildingTargets(organizationId), buildingId);
}
