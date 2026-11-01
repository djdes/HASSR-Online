import type { Session } from "next-auth";

import { getViewedPointId } from "@/lib/active-building";
import { buildingTargets } from "@/lib/building-targets";
import { db } from "@/lib/db";
import { resolveInspectorIssuePoint, type InspectorIssuePoint } from "@/lib/inspector-point";
import { parsePointScope } from "@/lib/point-scope";

/**
 * Точка ссылки проверяющего для человека в кабинете (`resolveInspectorIssuePoint`):
 * точки организации, точка из шапки и точки руководителя точки.
 */
export async function resolveInspectorIssuePointForSession(
  session: Session,
  organizationId: string,
  requested: string | null | undefined,
): Promise<InspectorIssuePoint> {
  const [targets, viewedPointId] = await Promise.all([buildingTargets(organizationId), getViewedPointId(session)]);
  const orgBuildingIds = targets.filter((id): id is string => Boolean(id));
  return resolveInspectorIssuePoint({
    requested,
    pointsEnabled: orgBuildingIds.length > 0,
    orgBuildingIds,
    viewedPointId,
    pointScope: parsePointScope(session.user.pointScope),
  });
}

/** Название точки для подписи; null — вся организация. */
export async function inspectorPointName(organizationId: string, buildingId: string | null): Promise<string | null> {
  if (!buildingId) return null;
  const building = await db.building.findFirst({
    where: { id: buildingId, organizationId },
    select: { name: true },
  });
  return building?.name ?? null;
}
