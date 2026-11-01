import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { STAFF_OUT_OF_SCOPE_ERROR, isPointScoped, staffInScope } from "@/lib/point-scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/setup-helper/devices/<id>/revoke — отключить телефон с
 * «Сетап помощником». Ключ перестаёт работать; приложение выйдет из
 * аккаунта, как только выйдет на связь. Строку не удаляем: по ней видно,
 * через какой телефон подключали принтеры.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) {
    return NextResponse.json({ error: "Нет доступа" }, { status: 403 });
  }

  const { id } = await params;
  const organizationId = getActiveOrgId(session);
  // Руководитель точки отключает только телефоны людей своих точек (аудит точек, 2026-11-01).
  if (isPointScoped(session.user)) {
    const device = await db.setupHelperDevice.findFirst({
      where: { id, organizationId, revokedAt: null },
      select: { userId: true },
    });
    if (!device) return NextResponse.json({ error: "Не найдено" }, { status: 404 });
    const owner = await db.user.findFirst({
      where: { id: device.userId, organizationId },
      select: { buildingIds: true },
    });
    if (!staffInScope(session.user, owner?.buildingIds ?? [])) {
      return NextResponse.json({ error: STAFF_OUT_OF_SCOPE_ERROR }, { status: 403 });
    }
  }
  const result = await db.setupHelperDevice.updateMany({
    where: { id, organizationId, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  if (result.count === 0) {
    return NextResponse.json({ error: "Не найдено" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
