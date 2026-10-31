/**
 * Условия «только эта точка» для данных без своего поля точки (2026-10-31,
 * «точка видит только своё»): записи журналов по цеху / оборудованию,
 * потери по цеху, чек-листы по назначению. `pointId = null` — без фильтра.
 *
 * Цех точки — её цех или цех без точки (общий); запись без цеха видна везде.
 */

type SharedPoint = Array<{ buildingId: string | null }>;

function pointOrShared(pointId: string): SharedPoint {
  return [{ buildingId: pointId }, { buildingId: null }];
}

/** `JournalEntry` точки: её цех, общий цех, без цеха — по оборудованию, без цеха и оборудования. */
export function journalEntryPointWhere(pointId: string | null | undefined) {
  if (!pointId) return {};
  const shared = pointOrShared(pointId);
  return {
    OR: [
      { areaId: null, equipmentId: null },
      { area: { OR: shared } },
      { areaId: null, equipment: { area: { OR: shared } } },
    ],
  };
}

/** `LossRecord` точки: цеха точки и общие (`areaIds`) и записи без цеха. */
export function lossPointWhere(pointId: string | null | undefined, pointAreaIds: readonly string[]) {
  if (!pointId) return {};
  return { OR: [{ areaId: null }, { areaId: { in: [...pointAreaIds] } }] };
}

/** Цеха точки — для `lossPointWhere` и списков участков. */
export function areaPointWhere(pointId: string | null | undefined) {
  return pointId ? { OR: pointOrShared(pointId) } : {};
}

/**
 * Назначение чек-листа видно на точке: на её людей, на должность, на
 * сотрудника этой точки (или «все точки»). Назначение на другую точку или
 * на сотрудника другой точки — нет.
 */
export function checklistAssignmentAtPoint(
  assignment: { targetKind: string; targetId: string } | null | undefined,
  pointId: string | null | undefined,
  personPoints: ReadonlyMap<string, readonly string[]>,
  livePointIds: ReadonlySet<string>,
): boolean {
  if (!pointId || !assignment) return true;
  if (assignment.targetKind === "building") return assignment.targetId === pointId;
  if (assignment.targetKind === "user") {
    const live = (personPoints.get(assignment.targetId) ?? []).filter((id) => livePointIds.has(id));
    return live.length === 0 || live.includes(pointId);
  }
  return true;
}
