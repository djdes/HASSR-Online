import { workBuildingsForUser } from "@/lib/building-scope";
import { db } from "@/lib/db";

/**
 * Точки (2026-09-05): на какие точки раздавать документы и обязательства.
 * Без `next/headers` — этим пользуются кроны и обязательства, которые
 * живут вне запроса; серверный контекст запроса — в active-building.ts.
 */

/**
 * Список id точек организации с включёнными точками (их ≥ 2), иначе
 * `[null]` — один общий документ, как раньше.
 */
export async function buildingTargets(
  organizationId: string,
): Promise<Array<string | null>> {
  const organization = await db.organization.findUnique({
    where: { id: organizationId },
    select: { perLocationJournals: true },
  });
  if (!organization?.perLocationJournals) return [null];
  const buildings = await db.building.findMany({
    where: { organizationId },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true },
  });
  return buildings.length >= 2 ? buildings.map((building) => building.id) : [null];
}

/**
 * Точки, где сотрудник работает: `User.buildingIds` ∩ точки организации;
 * пустой список = все точки; сотрудник офиса — только офис
 * (`workBuildingsForUser`). Организация без точек → `[null]`.
 */
export async function userBuildingTargets(
  organizationId: string,
  userId: string,
): Promise<Array<string | null>> {
  const organization = await db.organization.findUnique({
    where: { id: organizationId },
    select: { perLocationJournals: true },
  });
  if (!organization?.perLocationJournals) return [null];
  const [buildings, user] = await Promise.all([
    db.building.findMany({
      where: { organizationId },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true, address: true, kind: true },
    }),
    db.user.findUnique({
      where: { id: userId },
      select: { organizationId: true, buildingIds: true },
    }),
  ]);
  if (buildings.length < 2) return [null];
  const userBuildingIds =
    user && user.organizationId === organizationId ? user.buildingIds : [];
  return workBuildingsForUser(buildings, userBuildingIds).map((building) => building.id);
}

/** Оставить только точки этой организации, без дублей, в исходном порядке. */
export async function sanitizeBuildingIds(
  organizationId: string,
  ids: readonly string[],
): Promise<string[]> {
  if (ids.length === 0) return [];
  const buildings = await db.building.findMany({
    where: { organizationId, id: { in: [...new Set(ids)] } },
    select: { id: true },
  });
  const known = new Set(buildings.map((building) => building.id));
  const out: string[] = [];
  for (const id of ids) {
    if (known.has(id) && !out.includes(id)) out.push(id);
  }
  return out;
}
