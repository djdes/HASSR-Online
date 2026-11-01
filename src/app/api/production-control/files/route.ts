import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { recordAuditLog } from "@/lib/audit-log";
import { KNOWLEDGE_MAX_BYTES, knowledgeFileType } from "@/lib/knowledge-documents";
import { isPpkFolder } from "@/lib/ppk/folders";
import { requirePpkAccess } from "@/lib/ppk/access.server";
import { ppkWhere } from "@/lib/ppk/scope";
import { checkStorageForUpload, limitResponse } from "@/lib/billing.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Не больше стольких файлов в одной папке организации. */
const MAX_FILES_PER_FOLDER = 100;

const SELECT = {
  id: true,
  fileName: true,
  mimeType: true,
  sizeBytes: true,
  uploadedByName: true,
  createdAt: true,
} as const;

/** GET ?folder=<key> — файлы папки раздела ППК. */
export async function GET(request: Request) {
  const auth = await requirePpkAccess();
  if (!auth.ok) return auth.response;
  const folder = new URL(request.url).searchParams.get("folder");
  if (!isPpkFolder(folder)) {
    return NextResponse.json({ error: "Неизвестная папка" }, { status: 400 });
  }
  const files = await db.knowledgeDocument.findMany({
    where: { ...ppkWhere(auth.scope), folder },
    select: SELECT,
    orderBy: { createdAt: "desc" },
    take: 500,
  });
  return NextResponse.json({ files }, { headers: { "Cache-Control": "private, no-store" } });
}

/** POST multipart: folder, file — загрузить файл в папку. */
export async function POST(request: Request) {
  const auth = await requirePpkAccess();
  if (!auth.ok) return auth.response;
  const form = await request.formData().catch(() => null);
  const folder = form?.get("folder");
  if (!isPpkFolder(folder)) {
    return NextResponse.json({ error: "Неизвестная папка" }, { status: 400 });
  }
  const file = form?.get("file");
  if (!(file instanceof File) || !file.size) {
    return NextResponse.json({ error: "Выберите непустой файл" }, { status: 400 });
  }
  if (file.size > KNOWLEDGE_MAX_BYTES) {
    return NextResponse.json({ error: "Максимальный размер файла — 25 МБ" }, { status: 413 });
  }
  const inFolder = await db.knowledgeDocument.count({
    where: { ...ppkWhere(auth.scope), folder },
  });
  if (inFolder >= MAX_FILES_PER_FOLDER) {
    return NextResponse.json({ error: "В папке уже 100 файлов" }, { status: 409 });
  }
  // Хранилище тарифа (Стандарт 10 МБ, Премиум 1 ГБ) — до чтения файла.
  const storage = await checkStorageForUpload(auth.organizationId, file.size, { source: `production-control/files:${folder}` });
  if (!storage.ok) return limitResponse(storage);
  const content = new Uint8Array(await file.arrayBuffer());
  const mimeType = knowledgeFileType(file.name, content);
  if (!mimeType) {
    return NextResponse.json({ error: "Такой тип файла не подходит" }, { status: 415 });
  }
  const fileName = file.name.replace(/[\/\r\n\x00]/g, "_").slice(0, 240);
  const created = await db.knowledgeDocument.create({
    data: {
      organizationId: auth.organizationId,
      buildingId: auth.scope.buildingId,
      folder,
      title: fileName,
      fileName,
      mimeType,
      sizeBytes: content.byteLength,
      content,
      uploadedByName: auth.session.user.name ?? "",
    },
    select: SELECT,
  });
  await recordAuditLog({
    request,
    session: auth.session,
    organizationId: auth.organizationId,
    action: "production-control.file-upload",
    entity: "KnowledgeDocument",
    entityId: created.id,
    details: { folder, fileName, sizeBytes: content.byteLength },
  });
  return NextResponse.json({ file: created }, { status: 201 });
}

/** DELETE ?id= — удалить файл папки раздела ППК. */
export async function DELETE(request: Request) {
  const auth = await requirePpkAccess();
  if (!auth.ok) return auth.response;
  const id = new URL(request.url).searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Файл не найден" }, { status: 404 });
  }
  const result = await db.knowledgeDocument.deleteMany({
    where: { id, ...ppkWhere(auth.scope), folder: { not: null } },
  });
  if (result.count === 0) {
    return NextResponse.json({ error: "Файл не найден" }, { status: 404 });
  }
  await recordAuditLog({
    request,
    session: auth.session,
    organizationId: auth.organizationId,
    action: "production-control.file-delete",
    entity: "KnowledgeDocument",
    entityId: id,
    details: { id },
  });
  return NextResponse.json({ ok: true });
}
