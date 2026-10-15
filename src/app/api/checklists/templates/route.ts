import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireChecklistAccess } from "@/lib/custom-checklists.server";
import { checklistDefinitionSchema } from "@/lib/custom-checklists";
import { recordAuditLog } from "@/lib/audit-log";
import { validateChecklistReferenceFiles } from "@/lib/custom-checklist-files.server";

export const dynamic = "force-dynamic";
const schema = z.object({ title: z.string().trim().min(1).max(200), definition: checklistDefinitionSchema }).strict();
export async function GET() {
  const auth = await requireChecklistAccess(); if (!auth.ok) return auth.response;
  const templates = await db.checklistTemplate.findMany({ where: { organizationId: auth.organizationId, archived: false }, orderBy: { updatedAt: "desc" }, take: 200 });
  return NextResponse.json({ templates, canManage: auth.canManage }, { headers: { "Cache-Control": "private, no-store" } });
}
export async function POST(request: Request) {
  const auth = await requireChecklistAccess("manage"); if (!auth.ok) return auth.response;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Проверьте шаблон" }, { status: 400 });
  const template = await db.$transaction(async tx => {
    if (!await validateChecklistReferenceFiles(tx, auth.organizationId, auth.session.user.id, parsed.data.definition)) return null;
    const created = await tx.checklistTemplate.create({ data: { organizationId: auth.organizationId, ...parsed.data } });
    await validateChecklistReferenceFiles(tx, auth.organizationId, auth.session.user.id, parsed.data.definition, created.id);
    return created;
  });
  if (!template) return NextResponse.json({ error: "Файл-пример недоступен. Загрузите его в этой организации." }, { status: 400 });
  await recordAuditLog({ request, session: auth.session, organizationId: auth.organizationId, action: "checklist.template_create", entity: "ChecklistTemplate", entityId: template.id, details: { title: template.title } });
  return NextResponse.json({ template }, { status: 201 });
}
