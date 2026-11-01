import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { orgBuildingOrNull } from "@/lib/print-agent-point.server";
import { canManageAgentPoint } from "@/lib/print-point-routing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PATCH /api/print/agents/<id> — для какой точки печатает машина
 * (2026-11-01, «принтер своей точки»).
 *
 * Body: `{ buildingId: string | null }` — null — вся организация (общий
 * принтер: общие журналы и журналы точек без своего принтера).
 * Руководство компании ставит любую точку; руководитель точки — только
 * свои принтеры и только на свои точки.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) {
    return NextResponse.json({ error: "Нет доступа" }, { status: 403 });
  }

  let body: { buildingId?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Некорректный запрос" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || !("buildingId" in body)) {
    return NextResponse.json({ error: "Укажите точку" }, { status: 400 });
  }

  const organizationId = getActiveOrgId(session);
  const { id } = await params;
  const agent = await db.printAgent.findFirst({
    where: { id, organizationId, revokedAt: null },
    select: { id: true, buildingId: true },
  });
  if (!agent) {
    return NextResponse.json({ error: "Не найдено" }, { status: 404 });
  }

  const target = body.buildingId === null ? null : await orgBuildingOrNull(organizationId, body.buildingId);
  if (body.buildingId !== null && !target) {
    return NextResponse.json({ error: "Точка не найдена" }, { status: 400 });
  }
  if (!canManageAgentPoint({ scope: session.user.pointScope ?? null, current: agent.buildingId, target })) {
    return NextResponse.json({ error: "Это принтер другой точки — его ведёт руководство компании" }, { status: 403 });
  }

  const updated = await db.printAgent.update({
    where: { id: agent.id },
    data: { buildingId: target },
    select: { buildingId: true, building: { select: { name: true } } },
  });
  return NextResponse.json({ ok: true, buildingId: updated.buildingId, buildingName: updated.building?.name ?? null });
}
