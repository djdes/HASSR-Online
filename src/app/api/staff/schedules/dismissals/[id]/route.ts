import { NextResponse } from "next/server";
import { getActiveOrgId, requireAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { isManagementRole } from "@/lib/user-roles";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireAuth();
  if (!isManagementRole(session.user.role) && !session.user.isRoot) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }
  const { id } = await params;
  const orgId = getActiveOrgId(session);

  const row = await db.staffDismissal.findFirst({
    where: { id, user: { organizationId: orgId } },
    select: { id: true, userId: true },
  });
  if (!row) {
    return NextResponse.json({ error: "Запись не найдена" }, { status: 404 });
  }
  // Remove the dismissal AND unarchive the user.
  await db.$transaction([
    db.staffDismissal.delete({ where: { id: row.id } }),
    db.user.update({
      where: { id: row.userId },
      data: { archivedAt: null, isActive: true },
    }),
  ]);
  return NextResponse.json({ ok: true });
}
