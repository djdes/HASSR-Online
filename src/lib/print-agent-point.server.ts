import { db } from "@/lib/db";
import { computePointScope } from "@/lib/point-scope.server";
import { pointsWithOwnAgent } from "@/lib/print-point-routing";

/**
 * Принтер своей точки (2026-11-01) — запросы к БД вокруг чистых правил
 * `print-point-routing.ts`.
 */

/** Точки организации, у которых есть свой подключённый принтер. */
export async function loadPointsWithOwnAgent(organizationId: string): Promise<string[]> {
  const agents = await db.printAgent.findMany({
    where: { organizationId, revokedAt: null, buildingId: { not: null } },
    select: { buildingId: true },
  });
  return pointsWithOwnAgent(agents);
}

/** Точка этой организации (или null, если такой нет). */
export async function orgBuildingOrNull(organizationId: string, buildingId: unknown): Promise<string | null> {
  if (typeof buildingId !== "string" || !buildingId) return null;
  const building = await db.building.findFirst({
    where: { id: buildingId, organizationId },
    select: { id: true },
  });
  return building?.id ?? null;
}

/**
 * Точка нового принтера по человеку, который подключает программу:
 * руководитель точки — его (первая) точка; руководство на всю компанию —
 * вся организация, как было до точек. Сменить точку можно на странице
 * «Онлайн-принтер».
 */
export async function defaultAgentBuildingId(user: {
  organizationId: string;
  buildingIds: readonly string[];
}): Promise<string | null> {
  const scope = await computePointScope(user);
  return scope?.[0] ?? null;
}
