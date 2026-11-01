import { NextResponse } from "next/server";
import { getActiveOrgId, requireApiAuth } from "@/lib/auth-helpers";
import { getViewedPointId } from "@/lib/active-building";
import { db } from "@/lib/db";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { loadOrphanAreas } from "@/lib/room-directory";
import { BUILDING_OUT_OF_SCOPE_ERROR, buildingInScope } from "@/lib/point-scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET — цеха («Цеха и участки», Area), для которых ещё нет помещения
 * с тем же названием. Окно «Добавить помещение» предлагает создать из них
 * помещение одним нажатием.
 *
 * `?buildingId=` — точка, куда добавляют помещение (аудит точек,
 * 2026-11-01): её цеха и общие, без чужих. Не передана — точка из шапки.
 */
export async function GET(request: Request) {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;
  if (!hasFullWorkspaceAccess(auth.session.user)) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }
  const orgId = getActiveOrgId(auth.session);
  const requested = new URL(request.url).searchParams.get("buildingId");
  let pointId: string | null = null;
  if (requested) {
    const building = await db.building.findFirst({
      where: { id: requested, organizationId: orgId },
      select: { id: true },
    });
    if (!building) return NextResponse.json({ error: "Точка не найдена" }, { status: 404 });
    if (!buildingInScope(auth.session.user, building.id)) {
      return NextResponse.json({ error: BUILDING_OUT_OF_SCOPE_ERROR }, { status: 403 });
    }
    pointId = building.id;
  } else {
    pointId = await getViewedPointId(auth.session);
  }
  const areas = await loadOrphanAreas(orgId, pointId);
  return NextResponse.json({ areas });
}
