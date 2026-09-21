import { NextResponse } from "next/server";
import { z } from "zod";
import { getActiveOrgId, requireAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { isManagementRole } from "@/lib/user-roles";

const patchSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  categoryKey: z.enum(["management", "staff", "commission"]).optional(),
});

function forbidden() {
  return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
}

async function loadOwned(id: string, orgId: string) {
  const row = await db.jobPosition.findFirst({
    where: { id, organizationId: orgId },
  });
  return row;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireAuth();
  if (!isManagementRole(session.user.role) && !session.user.isRoot) {
    return forbidden();
  }
  const { id } = await params;
  const orgId = getActiveOrgId(session);
  const position = await loadOwned(id, orgId);
  if (!position) {
    return NextResponse.json({ error: "Должность не найдена" }, { status: 404 });
  }

  let parsed;
  try {
    parsed = patchSchema.parse(await request.json());
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues[0]?.message ?? "Некорректные данные" },
        { status: 400 }
      );
    }
    return NextResponse.json({ error: "Не удалось прочитать запрос" }, { status: 400 });
  }

  try {
    const updated = await db.jobPosition.update({
      where: { id: position.id },
      data: {
        ...(parsed.name !== undefined ? { name: parsed.name } : {}),
        ...(parsed.categoryKey !== undefined
          ? { categoryKey: parsed.categoryKey }
          : {}),
      },
    });
    return NextResponse.json({ position: updated });
  } catch (error: unknown) {
    const code = (error as { code?: string })?.code;
    if (code === "P2002") {
      return NextResponse.json(
        { error: "Должность с таким названием уже существует" },
        { status: 409 }
      );
    }
    throw error;
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireAuth();
  if (!isManagementRole(session.user.role) && !session.user.isRoot) {
    return forbidden();
  }
  const { id } = await params;
  const orgId = getActiveOrgId(session);
  const position = await loadOwned(id, orgId);
  if (!position) {
    return NextResponse.json({ error: "Должность не найдена" }, { status: 404 });
  }

  // "Active" in this context = both flags set to their active values. Legacy
  // DELETE /api/users/[id] only flips isActive=false without touching
  // archivedAt, so we OR'd the archive check and ended up refusing to clean
  // up positions after soft-deletes.
  const linked = await db.user.count({
    where: {
      jobPositionId: position.id,
      archivedAt: null,
      isActive: true,
    },
  });
  if (linked > 0) {
    return NextResponse.json(
      {
        error: `К должности прикреплено ${linked} активных сотрудников. Переведите их в другую должность или архив перед удалением.`,
      },
      { status: 409 }
    );
  }

  await db.jobPosition.delete({ where: { id: position.id } });
  return NextResponse.json({ ok: true });
}
