import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { canManageAgentPoint } from "@/lib/print-point-routing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/print/agents/<id>/revoke — отключить машину от печати.
 *
 * Строку не удаляем, а помечаем `revokedAt`: история печати должна
 * помнить, на какой машине что печаталось, даже после того как машину
 * списали.
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
  // Руководитель точки отключает только принтеры своих точек (2026-11-01).
  const agent = await db.printAgent.findFirst({
    where: { id, organizationId: getActiveOrgId(session), revokedAt: null },
    select: { buildingId: true },
  });
  if (!agent) {
    return NextResponse.json({ error: "Не найдено" }, { status: 404 });
  }
  if (!canManageAgentPoint({ scope: session.user.pointScope ?? null, current: agent.buildingId })) {
    return NextResponse.json({ error: "Это принтер другой точки — его ведёт руководство компании" }, { status: 403 });
  }
  const result = await db.printAgent.updateMany({
    where: {
      id,
      organizationId: getActiveOrgId(session),
      revokedAt: null,
    },
    data: { revokedAt: new Date() },
  });

  if (result.count === 0) {
    return NextResponse.json({ error: "Не найдено" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
