import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { recordAuditLog } from "@/lib/audit-log";
import { checklistAssignmentInputSchema, checklistAssignmentToggleSchema } from "@/lib/checklist-assignments";
import { requireAssignmentAccess, validateAssignmentRefs } from "@/lib/checklist-assignments.api";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

/**
 * PATCH — «Пауза/Включить» (`{ active }`) или правка формы целиком (плюс
 * необязательный `active`); DELETE — удалить назначение, проверки по нему
 * остаются в истории (`assignmentId` обнуляется). Оба — `admin.full`.
 */
export async function PATCH(request: Request, ctx: Ctx) {
  const auth = await requireAssignmentAccess("write");
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  const existing = await db.checklistAssignment.findFirst({ where: { id, organizationId: auth.organizationId }, select: { id: true } });
  if (!existing) return NextResponse.json({ error: "Назначение не найдено" }, { status: 404 });
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const toggle = checklistAssignmentToggleSchema.safeParse(body);
  let data: Prisma.ChecklistAssignmentUncheckedUpdateInput;
  if (toggle.success) {
    data = { active: toggle.data.active };
  } else {
    const { active, ...rest } = body ?? {};
    if (active !== undefined && typeof active !== "boolean") return NextResponse.json({ error: "Проверьте назначение" }, { status: 400 });
    const parsed = checklistAssignmentInputSchema.safeParse(rest);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Проверьте назначение" }, { status: 400 });
    const problem = await validateAssignmentRefs(auth.organizationId, parsed.data, new Date());
    if (problem) return problem;
    // Новые условия — новый счёт напоминаний: отметку периода сбрасываем.
    data = { ...parsed.data, ...(typeof active === "boolean" ? { active } : {}), lastReminderPeriodKey: null };
  }
  await db.checklistAssignment.update({ where: { id }, data });
  await recordAuditLog({
    request,
    session: auth.session,
    organizationId: auth.organizationId,
    action: toggle.success ? (toggle.data.active ? "checklist.assignment_resume" : "checklist.assignment_pause") : "checklist.assignment_update",
    entity: "ChecklistAssignment",
    entityId: id,
    details: JSON.parse(JSON.stringify(data)),
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request, ctx: Ctx) {
  const auth = await requireAssignmentAccess("write");
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  const existing = await db.checklistAssignment.findFirst({
    where: { id, organizationId: auth.organizationId },
    select: { id: true, templateId: true, targetKind: true, targetId: true, _count: { select: { inspections: true } } },
  });
  if (!existing) return NextResponse.json({ error: "Назначение не найдено" }, { status: 404 });
  await db.checklistAssignment.delete({ where: { id } });
  await recordAuditLog({
    request,
    session: auth.session,
    organizationId: auth.organizationId,
    action: "checklist.assignment_delete",
    entity: "ChecklistAssignment",
    entityId: id,
    details: { templateId: existing.templateId, targetKind: existing.targetKind, targetId: existing.targetId, inspectionsKept: existing._count.inspections },
  });
  return NextResponse.json({ ok: true, inspectionsKept: existing._count.inspections });
}
