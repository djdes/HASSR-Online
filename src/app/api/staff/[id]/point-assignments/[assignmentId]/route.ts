import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { getServerSession } from "@/lib/server-session";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { STAFF_OUT_OF_SCOPE_ERROR, buildingInScope, staffInScope } from "@/lib/point-scope";
import { endPointAssignment } from "@/lib/point-assignments.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * DELETE /api/staff/[id]/point-assignments/[assignmentId]
 *
 * «Завершить сейчас»: замена кончается досрочно, точки возвращаются как
 * были. Уже завершённая — 200 с `ended: false` (повтор безопасен).
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; assignmentId: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  if (!hasFullWorkspaceAccess({ role: session.user.role, isRoot: session.user.isRoot === true })) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }
  const { id, assignmentId } = await params;
  const organizationId = getActiveOrgId(session);
  const assignment = await db.userPointAssignment.findFirst({
    where: { id: assignmentId, userId: id, organizationId },
    select: { id: true, buildingId: true, endedAt: true, user: { select: { buildingIds: true } } },
  });
  if (!assignment) return NextResponse.json({ error: "Замена не найдена" }, { status: 404 });
  // Руководитель точки завершает замены на своей точке или своих людей.
  if (!buildingInScope(session.user, assignment.buildingId) && !staffInScope(session.user, assignment.user.buildingIds)) {
    return NextResponse.json({ error: STAFF_OUT_OF_SCOPE_ERROR }, { status: 403 });
  }
  if (assignment.endedAt) return NextResponse.json({ ok: true, ended: false });
  const done = await endPointAssignment({ organizationId, assignmentId, reason: "manual", session });
  return NextResponse.json({ ok: true, ended: Boolean(done), buildingIds: done?.buildingIds ?? null });
}
