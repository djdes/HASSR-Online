import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireChecklistAccess } from "@/lib/custom-checklists.server";
import { recordAuditLog } from "@/lib/audit-log";

export const dynamic = "force-dynamic";
export async function GET() {
  const auth = await requireChecklistAccess(); if (!auth.ok) return auth.response;
  const inspections = await db.checklistInspection.findMany({ where: { organizationId: auth.organizationId, ...(auth.canManage ? {} : { createdById: auth.session.user.id }) }, select: { id: true, title: true, templateVersion: true, createdByName: true, completedByName: true, status: true, createdAt: true, completedAt: true }, orderBy: { createdAt: "desc" }, take: 200 });
  return NextResponse.json({ inspections }, { headers: { "Cache-Control": "private, no-store" } });
}
export async function POST(request: Request) {
  const auth = await requireChecklistAccess("write"); if (!auth.ok) return auth.response;
  const parsed = z.object({ templateId: z.string().min(1) }).strict().safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Выберите шаблон" }, { status: 400 });
  const template = await db.checklistTemplate.findFirst({ where: { id: parsed.data.templateId, organizationId: auth.organizationId, archived: false } });
  if (!template) return NextResponse.json({ error: "Шаблон не найден" }, { status: 404 });
  const inspection = await db.checklistInspection.create({ data: { organizationId: auth.organizationId, templateId: template.id, templateVersion: template.version, title: template.title, snapshot: template.definition ?? {}, createdById: auth.session.user.id, createdByName: auth.session.user.name ?? "" }, select: { id: true } });
  await recordAuditLog({ request, session: auth.session, organizationId: auth.organizationId, action: "checklist.inspection_create", entity: "ChecklistInspection", entityId: inspection.id, details: { templateId: template.id, version: template.version } });
  return NextResponse.json(inspection, { status: 201 });
}
