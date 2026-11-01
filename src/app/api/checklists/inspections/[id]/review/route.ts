import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { checklistInspectionInArea, checklistInspectionReadWhere, requireChecklistAccess } from "@/lib/custom-checklists.server";
import { canReviewInspection } from "@/lib/checklist-results";
import { hasCapability } from "@/lib/permission-presets";
import { recordAuditLog } from "@/lib/audit-log";

export const dynamic = "force-dynamic";

/**
 * «Принять результат» (2026-10-19): проверяющий по назначению или
 * руководитель (`admin.full`) отмечает завершённую проверку принятой.
 * Повторное принятие — 409, отметка не перезаписывается.
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireChecklistAccess();
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  const userId = auth.session.user.id;
  const inspection = await db.checklistInspection.findFirst({
    where: { id, ...checklistInspectionReadWhere({ organizationId: auth.organizationId, canManage: auth.canManage, userId }) },
    select: { id: true, status: true, reviewedAt: true, createdById: true, assignmentId: true, assignment: { select: { verifierUserId: true } } },
  });
  // Точка (2026-11-01, «точка видит только своё»): проверка другой точки — «не найдена».
  if (!inspection || !(await checklistInspectionInArea(auth.session, auth.organizationId, inspection))) {
    return NextResponse.json({ error: "Проверка не найдена" }, { status: 404 });
  }
  if (inspection.reviewedAt) return NextResponse.json({ error: "Результат уже принят" }, { status: 409 });
  const allowed = canReviewInspection({
    status: inspection.status,
    reviewedAt: inspection.reviewedAt,
    verifierUserId: inspection.assignment?.verifierUserId ?? null,
    userId,
    isAdmin: hasCapability(auth.session.user, "admin.full"),
  });
  if (inspection.status !== "completed") return NextResponse.json({ error: "Сначала завершите проверку" }, { status: 409 });
  if (!allowed) return NextResponse.json({ error: "Принять результат может проверяющий по назначению или руководитель" }, { status: 403 });
  const reviewedAt = new Date();
  const reviewedByName = auth.session.user.name ?? "";
  // Условие `reviewedAt: null` — от двойного нажатия в двух вкладках.
  const updated = await db.checklistInspection.updateMany({
    where: { id, organizationId: auth.organizationId, reviewedAt: null },
    data: { reviewedAt, reviewedById: userId, reviewedByName },
  });
  if (updated.count === 0) return NextResponse.json({ error: "Результат уже принят" }, { status: 409 });
  await recordAuditLog({
    request,
    session: auth.session,
    organizationId: auth.organizationId,
    action: "checklist.inspection_review",
    entity: "ChecklistInspection",
    entityId: id,
    details: { assignmentId: inspection.assignmentId },
  });
  return NextResponse.json({ reviewedAt: reviewedAt.toISOString(), reviewedByName });
}
