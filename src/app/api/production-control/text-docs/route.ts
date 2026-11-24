import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { recordAuditLog } from "@/lib/audit-log";
import { checkStorageForUpload, limitResponse } from "@/lib/billing.server";
import { requireKnowledgeAccess } from "@/lib/knowledge-documents.server";
import { requirePpkAccess } from "@/lib/ppk/access.server";
import { TEXT_DOC_MIME, textDocCreateSchema, textDocFileName } from "@/lib/ppk/text-docs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_IN_FOLDER = 100;

/**
 * POST { source, title, text } — документ текстом: рабочая инструкция в базе
 * знаний (source "knowledge") или документированная процедура точки
 * (source "procedures"). Дальше — «Утвердить редакцию» и печать с шапкой.
 */
export async function POST(request: Request) {
  const parsed = textDocCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Введите название и текст" }, { status: 400 });
  const { source, title, text } = parsed.data;
  const content = Buffer.from(text, "utf8");

  let organizationId: string;
  let buildingId: string | null = null;
  let session;
  if (source === "knowledge") {
    const auth = await requireKnowledgeAccess(true);
    if (!auth.ok) return auth.response;
    organizationId = auth.organizationId;
    session = auth.session;
  } else {
    const auth = await requirePpkAccess();
    if (!auth.ok) return auth.response;
    organizationId = auth.scope.organizationId;
    buildingId = auth.scope.buildingId;
    session = auth.session;
    const inFolder = await db.knowledgeDocument.count({ where: { organizationId, buildingId, folder: "procedures" } });
    if (inFolder >= MAX_IN_FOLDER) return NextResponse.json({ error: "В папке уже 100 файлов" }, { status: 409 });
  }
  const storage = await checkStorageForUpload(organizationId, content.byteLength, { source: `text-docs:${source}` });
  if (!storage.ok) return limitResponse(storage);

  const created = await db.knowledgeDocument.create({
    data: {
      organizationId,
      buildingId,
      folder: source === "procedures" ? "procedures" : null,
      title,
      fileName: textDocFileName(title),
      mimeType: TEXT_DOC_MIME,
      sizeBytes: content.byteLength,
      content,
      uploadedByName: session.user.name ?? "",
    },
    select: { id: true },
  });
  await recordAuditLog({
    request,
    session,
    organizationId,
    action: "production-control.text-doc-create",
    entity: "KnowledgeDocument",
    entityId: created.id,
    details: { source, title, chars: text.length },
  });
  return NextResponse.json({ id: created.id }, { status: 201 });
}
