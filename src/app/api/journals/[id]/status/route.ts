import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/server-session";
import { authOptions } from "@/lib/auth";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { isManagementRole } from "@/lib/user-roles";
import { canSeeDocumentPoint, JOURNAL_ENTRY_POINT_SELECT, journalEntryPointId } from "@/lib/document-point-access";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }

  if (!isManagementRole(session.user.role)) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }

  const body = await request.json();
  const { status } = body;

  if (!["draft", "submitted", "approved"].includes(status)) {
    return NextResponse.json({ error: "Недопустимый статус" }, { status: 400 });
  }

  const entry = await db.journalEntry.findUnique({
    where: { id },
    include: JOURNAL_ENTRY_POINT_SELECT,
  });

  if (
    !entry ||
    entry.organizationId !== getActiveOrgId(session) ||
    !(await canSeeDocumentPoint(session, journalEntryPointId(entry)))
  ) {
    return NextResponse.json({ error: "Запись не найдена" }, { status: 404 });
  }

  const updated = await db.journalEntry.update({
    where: { id },
    data: { status },
  });

  return NextResponse.json(updated);
}
