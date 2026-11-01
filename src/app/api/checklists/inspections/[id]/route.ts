import { NextResponse, after } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { checklistInspectionInArea, checklistInspectionReadWhere, requireChecklistAccess } from "@/lib/custom-checklists.server";
import { notifyChecklistVerifier } from "@/lib/checklist-assignments.server";
import { checklistAnswersSchema, checklistDefinitionSchema } from "@/lib/custom-checklists";
import { checklistEvidenceSchema, checklistInstancesSchema } from "@/lib/custom-checklist-rules";
import { ChecklistRunError, evaluateChecklistRun, expandChecklistDefinition, pruneChecklistRun, resolveChecklistResult, validateChecklistRun } from "@/lib/custom-checklist-runtime";
import { validateChecklistStoredFiles } from "@/lib/custom-checklist-files.server";
import { recordAuditLog } from "@/lib/audit-log";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
export async function GET(_request: Request, ctx: Ctx) {
  const auth = await requireChecklistAccess(); if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  const inspection = await db.checklistInspection.findFirst({ where: { id, ...checklistInspectionReadWhere({ organizationId: auth.organizationId, canManage: auth.canManage, userId: auth.session.user.id }) } });
  // Точка (2026-11-01, «точка видит только своё»): проверка другой точки — «не найдена».
  if (!inspection || !(await checklistInspectionInArea(auth.session, auth.organizationId, inspection))) return NextResponse.json({ error: "Проверка не найдена" }, { status: 404 });
  const definition = expandChecklistDefinition(checklistDefinitionSchema.parse(inspection.snapshot), checklistInstancesSchema.parse(inspection.categoryInstances ?? {}));
  const result = resolveChecklistResult(definition,checklistAnswersSchema.parse(inspection.answers),inspection.status === "completed"?inspection.result:undefined);
  return NextResponse.json({ inspection, result, score: (result as { score?: unknown }).score }, { headers: { "Cache-Control": "private, no-store" } });
}
export async function PATCH(request: Request, ctx: Ctx) {
  const auth = await requireChecklistAccess("write"); if (!auth.ok) return auth.response;
  const parsed = z.object({ answers: checklistAnswersSchema, evidence: checklistEvidenceSchema.optional(), categoryInstances: checklistInstancesSchema.optional(), complete: z.boolean().default(false), updatedAt: z.iso.datetime() }).strict().safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Проверьте ответы" }, { status: 400 });
  const { id } = await ctx.params;
  const where = { id, organizationId: auth.organizationId, ...(auth.canManage ? {} : { createdById: auth.session.user.id }) };
  const current = await db.checklistInspection.findFirst({ where });
  if (!current || !(await checklistInspectionInArea(auth.session, auth.organizationId, current))) return NextResponse.json({ error: "Проверка не найдена" }, { status: 404 });
  if (current.status !== "draft") return NextResponse.json({ error: "Завершённую проверку нельзя изменять" }, { status: 409 });
  const instances = parsed.data.categoryInstances ?? checklistInstancesSchema.parse(current.categoryInstances ?? {});
  let definition;
  try { definition = expandChecklistDefinition(checklistDefinitionSchema.parse(current.snapshot), instances); }
  catch (error) { return NextResponse.json({ error: error instanceof ChecklistRunError ? error.message : "Проверьте шаблон проверки" }, { status: 400 }); }
  const evidence = parsed.data.evidence ?? checklistEvidenceSchema.parse(current.evidence ?? {});
  const evaluated = evaluateChecklistRun(definition, parsed.data.answers);
  const completing = parsed.data.complete || evaluated.stopped;
  if (completing) { const finalize = await requireChecklistAccess("finalize"); if (!finalize.ok) return finalize.response; }
  const errors = validateChecklistRun(definition, parsed.data.answers, evidence, completing);
  if (Object.keys(errors).length) return NextResponse.json({ error: "Проверьте ответы и обязательные подтверждения", errors }, { status: 400 });
  const clean = completing ? pruneChecklistRun(definition, parsed.data.answers, evidence) : { answers: parsed.data.answers, evidence };
  const outcome = await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "ChecklistInspection" WHERE id = ${id} AND "organizationId" = ${auth.organizationId} FOR UPDATE`;
    const locked = await tx.checklistInspection.findFirst({ where });
    if (!locked || locked.status !== "draft" || locked.updatedAt.toISOString() !== parsed.data.updatedAt) return { error: "Проверка изменена в другой вкладке. Обновите её.", status: 409 };
    if (!await validateChecklistStoredFiles(tx, auth.organizationId, id, definition, clean.answers, clean.evidence)) return { error: "Файл недоступен или относится к другой проверке/вопросу", status: 400 };
    const result = evaluateChecklistRun(definition, clean.answers);
    const inspection = await tx.checklistInspection.update({ where: { id }, data: {
      answers: json(clean.answers), evidence: json(clean.evidence), categoryInstances: json(instances),
      ...(completing ? { status: "completed", completedAt: new Date(), completedByName: auth.session.user.name ?? "", completedById: auth.session.user.id, result: json(result) } : {}),
    } });
    return { inspection, result, score: result.score };
  });
  if ("error" in outcome) return NextResponse.json({ error: outcome.error }, { status: outcome.status });
  await recordAuditLog({ request, session: auth.session, organizationId: auth.organizationId, action: completing ? evaluated.stopped ? "checklist.inspection_critical_complete" : "checklist.inspection_complete" : "checklist.inspection_save", entity: "ChecklistInspection", entityId: id, details: { score: outcome.score, critical: outcome.result.critical.map(item => item.questionId), violations: outcome.result.violations.length, completedById: completing ? auth.session.user.id : null } });
  // Проверка по назначению завершена — проверяющему в Telegram, после ответа.
  if (completing && outcome.inspection.assignmentId) {
    after(async () => {
      try {
        const outcome = await notifyChecklistVerifier(id);
        console.info(`[checklists] verifier notify ${id}: ${outcome.sent ? "sent" : outcome.reason ?? "not-sent"}`);
      }
      catch (error) { console.error("[checklists] verifier notify failed", error); }
    });
  }
  return NextResponse.json(outcome);
}
