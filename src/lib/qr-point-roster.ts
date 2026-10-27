import { worksAtBuilding } from "@/lib/building-scope";
import { buildingTargets } from "@/lib/building-targets";
import { db } from "@/lib/db";

/**
 * QR по точке (2026-10-27): на наклейке объекта и на QR журнала в «Кто
 * заполняет» — только сотрудники точки объекта, и сохранить запись может
 * только он. Одно правило для списка и для проверки при сохранении.
 *
 * Точка объекта: оборудование — точка цеха (`Area.buildingId`), склад —
 * `Room.buildingId`, журнал — `JournalDocument.buildingId`. Без точки или
 * при выключенных точках (`buildingTargets` → `[null]`) фильтра нет.
 */
export type QrPointScope = {
  buildingId: string;
  buildingName: string;
  /** Точки организации — чтобы висящие id удалённых точек не отрезали людей. */
  orgBuildingIds: string[];
} | null;

export const QR_POINT_DENIED =
  "Этот сотрудник работает на другой точке — здесь записывают сотрудники этой точки.";
export const QR_POINT_DENIED_CODE = "equipmentFill.errors.otherPoint";

export async function loadQrPointScope(
  organizationId: string,
  buildingId: string | null | undefined,
): Promise<QrPointScope> {
  if (!buildingId) return null;
  const targets = await buildingTargets(organizationId);
  if (!targets.includes(buildingId)) return null;
  const building = await db.building.findUnique({ where: { id: buildingId }, select: { name: true } });
  return {
    buildingId,
    buildingName: building?.name ?? "",
    orgBuildingIds: targets.filter((id): id is string => id !== null),
  };
}

export function worksAtQrPoint(scope: QrPointScope, userBuildingIds: readonly string[] | null | undefined): boolean {
  return !scope || worksAtBuilding(scope.orgBuildingIds, userBuildingIds ?? [], scope.buildingId);
}

export function filterByQrPoint<T extends { buildingIds: string[] }>(users: readonly T[], scope: QrPointScope): T[] {
  return users.filter((user) => worksAtQrPoint(scope, user.buildingIds));
}

/** Проверка при сохранении, когда точки сотрудника ещё не загружены. */
export async function employeeWorksAtQrPoint(scope: QrPointScope, employeeId: string): Promise<boolean> {
  if (!scope) return true;
  const user = await db.user.findUnique({ where: { id: employeeId }, select: { buildingIds: true } });
  return worksAtQrPoint(scope, user?.buildingIds ?? []);
}
