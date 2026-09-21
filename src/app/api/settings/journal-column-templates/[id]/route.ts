import { NextResponse } from "next/server";

import { getActiveOrgId } from "@/lib/auth-helpers";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { getServerSession } from "@/lib/server-session";
import { isManagementRole } from "@/lib/user-roles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** DELETE — удалить свой шаблон колонок (встроенные не удаляются). */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  if (!isManagementRole(session.user.role) && !session.user.isRoot) {
    return NextResponse.json({ error: "Удалять шаблоны может руководитель" }, { status: 403 });
  }
  const { id } = await params;
  const result = await db.journalColumnTemplate.deleteMany({
    where: { id, organizationId: getActiveOrgId(session) },
  });
  if (result.count === 0) return NextResponse.json({ error: "Шаблон не найден" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
