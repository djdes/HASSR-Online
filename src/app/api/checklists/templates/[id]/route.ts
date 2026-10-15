import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireChecklistAccess } from "@/lib/custom-checklists.server";
import { checklistDefinitionSchema } from "@/lib/custom-checklists";
import { recordAuditLog } from "@/lib/audit-log";
import { validateChecklistReferenceFiles } from "@/lib/custom-checklist-files.server";

export const dynamic = "force-dynamic";
const schema = z.object({ title: z.string().trim().min(1).max(200), definition: checklistDefinitionSchema, version: z.number().int().positive() }).strict();
type Ctx = { params: Promise<{ id: string }> };
export async function GET(_request: Request, ctx: Ctx) {
  const auth = await requireChecklistAccess(); if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  const template = await db.checklistTemplate.findFirst({ where: { id, organizationId: auth.organizationId, archived: false } });
  if (!template) return NextResponse.json({ error: "Шаблон не найден" }, { status: 404 });
  return NextResponse.json({ template }, { headers: { "Cache-Control": "private, no-store" } });
}
export async function PATCH(request: Request, ctx: Ctx) {
  const auth = await requireChecklistAccess("manage"); if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Проверьте шаблон" }, { status: 400 });
  const { version, ...data } = parsed.data;
  const outcome = await db.$transaction(async tx => {
    if (!await validateChecklistReferenceFiles(tx, auth.organizationId, auth.session.user.id, data.definition)) return { error: "Файл-пример недоступен. Загрузите его в этой организации.", status: 400 };
    const updated = await tx.checklistTemplate.updateMany({ where: { id, organizationId: auth.organizationId, archived: false, version }, data: { ...data, version: { increment: 1 } } });
    if (!updated.count) return { error: "Шаблон изменён или недоступен. Обновите список.", status: 409 };
    await validateChecklistReferenceFiles(tx, auth.organizationId, auth.session.user.id, data.definition, id);
    return { template: await tx.checklistTemplate.findFirst({ where: { id, organizationId: auth.organizationId } }) };
  });
  if ("error" in outcome) return NextResponse.json({ error: outcome.error }, { status: outcome.status });
  await recordAuditLog({ request, session: auth.session, organizationId: auth.organizationId, action: "checklist.template_edit", entity: "ChecklistTemplate", entityId: id, details: { title: data.title, version: version + 1 } });
  return NextResponse.json({ ok: true, template: outcome.template });
}
export async function DELETE(request: Request, ctx: Ctx) {
  const auth = await requireChecklistAccess("manage"); if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  const result = await db.checklistTemplate.updateMany({ where: { id, organizationId: auth.organizationId }, data: { archived: true } });
  if (!result.count) return NextResponse.json({ error: "Шаблон не найден" }, { status: 404 });
  await recordAuditLog({ request, session: auth.session, organizationId: auth.organizationId, action: "checklist.template_archive", entity: "ChecklistTemplate", entityId: id, details: {} });
  return NextResponse.json({ ok: true });
}
