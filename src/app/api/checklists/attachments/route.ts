import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { checklistInspectionInArea, requireChecklistAccess } from "@/lib/custom-checklists.server";
import { checklistAttachmentType, CHECKLIST_FILE_MAX_BYTES, CHECKLIST_FILE_PURPOSES, CHECKLIST_FILE_QUOTA_BYTES } from "@/lib/custom-checklist-files";
import { checklistInstancesSchema } from "@/lib/custom-checklist-rules";
import { expandChecklistDefinition } from "@/lib/custom-checklist-runtime";
import { allChecklistQuestions, checklistDefinitionSchema } from "@/lib/custom-checklists";

export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  const authenticated = await requireChecklistAccess(); if (!authenticated.ok) return authenticated.response;
  if (Number(request.headers.get("content-length")) > CHECKLIST_FILE_MAX_BYTES + 100000) return NextResponse.json({ error: "Файл до 10 МБ" }, { status: 413 });
  const form = await request.formData().catch(() => null);
  const parsed = z.object({ purpose: z.enum(CHECKLIST_FILE_PURPOSES), questionId: z.string().min(1).max(220), inspectionId: z.string().min(1).max(100).optional(), templateId: z.string().min(1).max(100).optional(), instances: checklistInstancesSchema }).safeParse({ purpose: form?.get("purpose"), questionId: form?.get("questionId"), inspectionId: form?.get("inspectionId") || undefined, templateId: form?.get("templateId") || undefined, instances: (() => { try { return JSON.parse(String(form?.get("instances") || "{}")); } catch { return null; } })() });
  const file = form?.get("file");
  if (!parsed.success || !(file instanceof File)) return NextResponse.json({ error: "Укажите файл и вопрос" }, { status: 400 });
  const data = parsed.data;
  const auth = await requireChecklistAccess(data.purpose === "reference" ? "manage" : "write"); if (!auth.ok) return auth.response;
  if (file.size > CHECKLIST_FILE_MAX_BYTES) return NextResponse.json({ error: "Файл до 10 МБ" }, { status: 413 });
  if ((data.purpose !== "reference" && !data.inspectionId) || (data.purpose === "reference" && data.inspectionId) || (data.inspectionId && data.templateId)) return NextResponse.json({ error: "Проверьте назначение файла" }, { status: 400 });
  const bytes = new Uint8Array(await file.arrayBuffer());
  const fileName = (file.name.split(/[\\/]/).pop() || "Файл").replace(/[\x00-\x1f\x7f]/g, "").slice(-180);
  const mimeType = checklistAttachmentType(fileName, bytes, data.purpose);
  if (!mimeType) return NextResponse.json({ error: "Неподдерживаемый или повреждённый файл. Фото: JPG/PNG/WebP; видео: MP4/WebM; аудио: MP3/WAV/OGG/M4A/WebM. До 10 МБ." }, { status: 415 });
  // Точка (2026-11-01, «точка видит только своё»): к проверке другой точки файл не добавить.
  const target = data.inspectionId ? await db.checklistInspection.findFirst({ where: { id: data.inspectionId, organizationId: auth.organizationId }, select: { createdById: true, assignmentId: true } }) : null;
  if (target && !(await checklistInspectionInArea(auth.session, auth.organizationId, target))) return NextResponse.json({ error: "Проверка не найдена" }, { status: 404 });
  const outcome = await db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`checklist-files:${auth.organizationId}`}))`;
    if (data.inspectionId) {
      await tx.$queryRaw`SELECT id FROM "ChecklistInspection" WHERE id = ${data.inspectionId} AND "organizationId" = ${auth.organizationId} FOR UPDATE`;
      const inspection = await tx.checklistInspection.findFirst({ where: { id: data.inspectionId, organizationId: auth.organizationId, ...(auth.canManage ? {} : { createdById: auth.session.user.id }) } });
      if (!inspection) return { error: "Проверка не найдена", status: 404 };
      if (inspection.status !== "draft") return { error: "Завершённую проверку нельзя изменять", status: 409 };
      const expanded = expandChecklistDefinition(checklistDefinitionSchema.parse(inspection.snapshot), data.instances);
      if (!allChecklistQuestions(expanded).some(question => question.id === data.questionId)) return { error: "Вопрос не найден", status: 400 };
    }
    if (data.templateId && !(await tx.checklistTemplate.findFirst({ where: { id: data.templateId, organizationId: auth.organizationId, archived: false }, select: { id: true } }))) return { error: "Шаблон не найден", status: 404 };
    const used = await tx.checklistAttachment.aggregate({ where: { organizationId: auth.organizationId }, _sum: { sizeBytes: true } });
    if ((used._sum.sizeBytes ?? 0) + bytes.length > CHECKLIST_FILE_QUOTA_BYTES) return { error: "Достигнут лимит файлов чек-листов организации", status: 413 };
    const attachment = await tx.checklistAttachment.create({ data: { organizationId: auth.organizationId, inspectionId: data.inspectionId, templateId: data.templateId, questionId: data.questionId, purpose: data.purpose, fileName, mimeType, sizeBytes: bytes.length, content: bytes, sha256: createHash("sha256").update(bytes).digest("hex"), createdById: auth.session.user.id }, select: { id: true, fileName: true, mimeType: true, sizeBytes: true } });
    return { attachment };
  }).catch(error => {
    if (error instanceof Error && error.name === "ChecklistRunError") return { error: error.message, status: 400 };
    console.error("Checklist attachment save failed", { name: error instanceof Error ? error.name : "UnknownError" });
    return { error: "Не удалось сохранить файл. Повторите попытку.", status: 500 };
  });
  if ("error" in outcome) return NextResponse.json({ error: outcome.error }, { status: outcome.status });
  return NextResponse.json({ attachment: { ...outcome.attachment, ref: `file:${outcome.attachment.id}`, url: `/api/checklists/attachments/${outcome.attachment.id}` } }, { status: 201 });
}
