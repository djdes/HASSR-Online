import { NextResponse } from "next/server";
import { getActiveOrgId, requireApiAuth } from "@/lib/auth-helpers";
import { isOfficeBuilding } from "@/lib/building-scope";
import { db } from "@/lib/db";
import { nextPinned, parsePinRequest } from "@/lib/pinned-buildings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/me/pinned-buildings { buildingId, pinned } — скрепка у объекта
 * (владелец, 2026-11-23): закреплённый объект стоит первым в шапке и на
 * странице «Объекты». Закрепление личное — пишется в аккаунт человека.
 * Объект — только активной организации; офис — не объект (400).
 */
export async function POST(request: Request) {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;
  const { session } = auth;

  const parsed = parsePinRequest(await request.json().catch(() => null));
  if (!parsed) return NextResponse.json({ error: "Нужны buildingId и pinned" }, { status: 400 });

  const building = await db.building.findFirst({
    where: { id: parsed.buildingId, organizationId: getActiveOrgId(session) },
    select: { id: true, kind: true },
  });
  if (!building) return NextResponse.json({ error: "Объект не найден" }, { status: 404 });
  if (isOfficeBuilding(building)) return NextResponse.json({ error: "Офис — не объект" }, { status: 400 });

  const user = await db.user.findUnique({ where: { id: session.user.id }, select: { pinnedBuildingIds: true } });
  if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  const pinnedBuildingIds = nextPinned(user.pinnedBuildingIds, building.id, parsed.pinned);
  await db.user.update({ where: { id: session.user.id }, data: { pinnedBuildingIds } });
  return NextResponse.json({ pinnedBuildingIds });
}
