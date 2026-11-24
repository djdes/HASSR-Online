import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { recordAuditLog } from "@/lib/audit-log";
import { checkStorageForUpload, limitResponse } from "@/lib/billing.server";
import { KNOWLEDGE_MAX_BYTES, knowledgeFileType } from "@/lib/knowledge-documents";
import { isTextDoc, textDocFileName, textDocPatchSchema } from "@/lib/ppk/text-docs";
import { requireEditableDoc } from "@/lib/ppk/text-docs.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** GET — название и текст документа текстом (для правки). */
export async function GET(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const access = await requireEditableDoc(id);
  if (!access.ok) return access.response;
  if (!isTextDoc(access.doc.mimeType)) return NextResponse.json({ error: "Это файл, а не текст" }, { status: 400 });
  const row = await db.knowledgeDocument.findUnique({ where: { id }, select: { content: true } });
  return NextResponse.json(
    { title: access.doc.title, text: Buffer.from(row?.content ?? new Uint8Array()).toString("utf8") },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

/**
 * PATCH { title?, text? } — новое название и/или текст. Текст — только у
 * документа текстом. Изменение хоть одного слова делает утверждённую редакцию
 * «изменённой»: программа спросит про новую.
 */
export async function PATCH(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const access = await requireEditableDoc(id);
  if (!access.ok) return access.response;
  const parsed = textDocPatchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Введите название до 200 символов и непустой текст" }, { status: 400 });
  const { doc } = access;
  const { title, text } = parsed.data;
  if (text !== undefined && !isTextDoc(doc.mimeType)) {
    return NextResponse.json({ error: "Текст правится только у документа текстом; файл можно заменить" }, { status: 400 });
  }
  const content = text !== undefined ? Buffer.from(text, "utf8") : null;
  if (content) {
    const storage = await checkStorageForUpload(doc.organizationId, content.byteLength, {
      source: "text-docs:edit",
      replacingBytes: doc.sizeBytes,
    });
    if (!storage.ok) return limitResponse(storage);
  }
  const nextTitle = title ?? doc.title;
  await db.knowledgeDocument.update({
    where: { id },
    data: {
      title: nextTitle,
      ...(isTextDoc(doc.mimeType) ? { fileName: textDocFileName(nextTitle) } : {}),
      ...(content ? { content, sizeBytes: content.byteLength } : {}),
    },
  });
  await recordAuditLog({
    request,
    session: access.session,
    organizationId: doc.organizationId,
    action: "production-control.text-doc-edit",
    entity: "KnowledgeDocument",
    entityId: id,
    details: { before: doc.title, title: nextTitle, textChanged: content !== null },
  });
  return NextResponse.json({ ok: true });
}

/** PUT multipart { file } — заменить файл документа: тот же документ, новое содержимое. */
export async function PUT(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const access = await requireEditableDoc(id);
  if (!access.ok) return access.response;
  const { doc } = access;
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File) || !file.size) return NextResponse.json({ error: "Выберите непустой файл" }, { status: 400 });
  if (file.size > KNOWLEDGE_MAX_BYTES) return NextResponse.json({ error: "Максимальный размер файла — 25 МБ" }, { status: 413 });
  const storage = await checkStorageForUpload(doc.organizationId, file.size, { source: "text-docs:replace", replacingBytes: doc.sizeBytes });
  if (!storage.ok) return limitResponse(storage);
  const content = new Uint8Array(await file.arrayBuffer());
  const mimeType = knowledgeFileType(file.name, content);
  if (!mimeType) {
    return NextResponse.json({ error: "Формат или содержимое файла не поддерживается. Подойдут PDF, JPG, PNG, DOC, DOCX, XLS, XLSX, ZIP, RAR и 7Z." }, { status: 415 });
  }
  const fileName = file.name.replace(/[\\/\r\n\x00]/g, "_").slice(0, 240);
  await db.knowledgeDocument.update({
    where: { id },
    data: { fileName, mimeType, sizeBytes: content.byteLength, content },
  });
  await recordAuditLog({
    request,
    session: access.session,
    organizationId: doc.organizationId,
    action: "production-control.text-doc-replace",
    entity: "KnowledgeDocument",
    entityId: id,
    details: { title: doc.title, before: doc.fileName, fileName, sizeBytes: content.byteLength },
  });
  return NextResponse.json({ ok: true });
}
