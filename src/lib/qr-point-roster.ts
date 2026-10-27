import { worksAtBuilding } from "@/lib/building-scope";
import { buildingTargets } from "@/lib/building-targets";
import { db } from "@/lib/db";
import { expireOrgPointAssignments } from "@/lib/point-assignments.server";

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
  /** Кто здесь на замене (временная точка) — подпись «Замена» в «Кто вы?». */
  substituteUserIds?: string[];
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
  // Срок замены вышел — сначала вернуть людей на их точки (крон ходит раз
  // в 5 минут, а QR сканируют сейчас).
  await expireOrgPointAssignments(organizationId);
  const [building, substitutes] = await Promise.all([
    db.building.findUnique({ where: { id: buildingId }, select: { name: true } }),
    db.userPointAssignment.findMany({
      where: { organizationId, buildingId, endedAt: null, endsAt: { gt: new Date() } },
      select: { userId: true },
    }),
  ]);
  return {
    buildingId,
    buildingName: building?.name ?? "",
    orgBuildingIds: targets.filter((id): id is string => id !== null),
    substituteUserIds: substitutes.map((row) => row.userId),
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
