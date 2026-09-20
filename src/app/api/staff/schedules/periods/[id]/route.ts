import { NextResponse } from "next/server";
import { z } from "zod";
import { getActiveOrgId, requireAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { isManagementRole } from "@/lib/user-roles";

const deleteSchema = z.object({
  kind: z.enum(["vacation", "sick_leave"]),
});

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireAuth();
  if (!isManagementRole(session.user.role) && !session.user.isRoot) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }
  const { id } = await params;
  const orgId = getActiveOrgId(session);

  const url = new URL(request.url);
  const kindParam = url.searchParams.get("kind");
  let parsed;
  try {
    parsed = deleteSchema.parse({ kind: kindParam });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues[0]?.message ?? "Некорректный тип" },
        { status: 400 }
      );
    }
    return NextResponse.json({ error: "Не удалось прочитать запрос" }, { status: 400 });
  }

  if (parsed.kind === "vacation") {
    const row = await db.staffVacation.findFirst({
      where: { id, user: { organizationId: orgId } },
      select: { id: true },
    });
    if (!row) {
      return NextResponse.json({ error: "Запись не найдена" }, { status: 404 });
    }
    await db.staffVacation.delete({ where: { id: row.id } });
    return NextResponse.json({ ok: true });
  }

  const row = await db.staffSickLeave.findFirst({
    where: { id, user: { organizationId: orgId } },
    select: { id: true },
  });
  if (!row) {
    return NextResponse.json({ error: "Запись не найдена" }, { status: 404 });
  }
  await db.staffSickLeave.delete({ where: { id: row.id } });
  return NextResponse.json({ ok: true });
}
