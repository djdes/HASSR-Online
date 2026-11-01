import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { listOrganizationBuildings, loadBuildingContext } from "@/lib/active-building";
import { viewedPointId } from "@/lib/building-scope";
import { buildingInScope } from "@/lib/point-scope";
import { objectPointError } from "@/lib/point-objects";

/** 403 для объекта чужой точки (или общего — руководителю точки); null — можно. */
export function objectPointResponse(
  actor: Session["user"] | null | undefined,
  buildingId: string | null | undefined,
): NextResponse | null {
  const error = objectPointError(actor, buildingId);
  return error ? NextResponse.json({ error }, { status: 403 }) : null;
}

/**
 * Точки объектов для списков API (цеха, оборудование): шапка смотрит на точку —
 * только она; иначе точки человека в пределах руководителя точки. null — все
 * (точки выключены или человек видит всю организацию). Общие объекты (без
 * точки) вызывающий добавляет сам.
 */
export async function visibleObjectBuildingIds(session: Session): Promise<string[] | null> {
  const context = await loadBuildingContext(session);
  if (!context.enabled) return null;
  const viewed = viewedPointId(context);
  if (viewed) return [viewed];
  const all = await listOrganizationBuildings(getActiveOrgId(session));
  const ids = context.buildings.filter((building) => buildingInScope(session.user, building.id)).map((building) => building.id);
  return ids.length >= all.length ? null : ids;
}

/**
 * Объект точки `buildingId` виден человеку (график датчика, карточка по id):
 * общий объект и выключенные точки — да; иначе точка должна быть среди его
 * точек и в пределах руководителя точки.
 */
export async function objectVisibleToSession(session: Session, buildingId: string | null | undefined): Promise<boolean> {
  if (!buildingId) return true;
  const context = await loadBuildingContext(session);
  if (!context.enabled) return true;
  const all = await listOrganizationBuildings(getActiveOrgId(session));
  if (!all.some((building) => building.id === buildingId)) return true;
  return context.buildings.some((building) => building.id === buildingId) && buildingInScope(session.user, buildingId);
}
