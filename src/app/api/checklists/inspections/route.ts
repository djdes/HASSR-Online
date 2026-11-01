import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { checklistInspectionReadWhere, checklistInspectionsInArea, requireChecklistAccess } from "@/lib/custom-checklists.server";
import { assignmentForStart } from "@/lib/checklist-assignments.server";
import { visibleObjectBuildingIds } from "@/lib/point-objects.server";
import { recordAuditLog } from "@/lib/audit-log";

export const dynamic = "force-dynamic";
export async function GET() {
  const auth = await requireChecklistAccess(); if (!auth.ok) return auth.response;
  const rows = await db.checklistInspection.findMany({ where: checklistInspectionReadWhere({ organizationId: auth.organizationId, canManage: auth.canManage, userId: auth.session.user.id }), select: { id: true, title: true, templateVersion: true, createdByName: true, completedByName: true, status: true, createdAt: true, completedAt: true, assignmentId: true, reviewedAt: true, reviewedByName: true, createdById: true }, orderBy: { createdAt: "desc" }, take: 200 });
  // Точка (2026-11-01, «точка видит только своё»): проверок другой точки в списке нет.
  const inspections = (await checklistInspectionsInArea(auth.session, auth.organizationId, rows)).map(({ createdById: _createdById, ...row }) => row);
  return NextResponse.json({ inspections }, { headers: { "Cache-Control": "private, no-store" } });
}
export async function POST(request: Request) {
  const auth = await requireChecklistAccess("write"); if (!auth.ok) return auth.response;
  const parsed = z.object({ templateId: z.string().min(1), assignmentId: z.string().min(1).max(100).optional() }).strict().safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Выберите шаблон" }, { status: 400 });
  const template = await db.checklistTemplate.findFirst({ where: { id: parsed.data.templateId, organizationId: auth.organizationId, archived: false } });
  if (!template) return NextResponse.json({ error: "Шаблон не найден" }, { status: 404 });
  // Проверка по назначению: назначение живое, сегодня есть период, человек — получатель
  // (руководитель — и не получатель, но только по назначению своей точки).
  let assignmentId: string | null = null;
  if (parsed.data.assignmentId) {
    const check = await assignmentForStart({ organizationId: auth.organizationId, assignmentId: parsed.data.assignmentId, templateId: template.id, user: auth.session.user, now: new Date(), points: await visibleObjectBuildingIds(auth.session) });
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });
    assignmentId = check.id;
    // Уже начатая этим человеком проверка по назначению — продолжаем её, а не плодим черновики.
    const draft = await db.checklistInspection.findFirst({ where: { organizationId: auth.organizationId, assignmentId, createdById: auth.session.user.id, status: "draft" }, orderBy: { createdAt: "desc" }, select: { id: true } });
    if (draft) return NextResponse.json({ id: draft.id, resumed: true }, { status: 200 });
  }
  const inspection = await db.checklistInspection.create({ data: { organizationId: auth.organizationId, templateId: template.id, templateVersion: template.version, title: template.title, snapshot: template.definition ?? {}, createdById: auth.session.user.id, createdByName: auth.session.user.name ?? "", assignmentId }, select: { id: true } });
  await recordAuditLog({ request, session: auth.session, organizationId: auth.organizationId, action: "checklist.inspection_create", entity: "ChecklistInspection", entityId: inspection.id, details: { templateId: template.id, version: template.version, assignmentId } });
  return NextResponse.json(inspection, { status: 201 });
}
