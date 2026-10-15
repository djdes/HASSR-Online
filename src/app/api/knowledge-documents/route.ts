import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireKnowledgeAccess } from "@/lib/knowledge-documents.server";
import { KNOWLEDGE_MAX_BYTES, knowledgeFileType } from "@/lib/knowledge-documents";
import { recordAuditLog } from "@/lib/audit-log";

export const dynamic = "force-dynamic";
export async function GET() {
  const auth = await requireKnowledgeAccess();
  if (!auth.ok) return auth.response;
  const documents = await db.knowledgeDocument.findMany({ where: { organizationId: auth.organizationId }, select: { id: true, title: true, fileName: true, mimeType: true, sizeBytes: true, createdAt: true, uploadedByName: true }, orderBy: { createdAt: "desc" }, take: 500 });
  return NextResponse.json({ documents }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request) {
  const auth = await requireKnowledgeAccess(true);
  if (!auth.ok) return auth.response;
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File) || !file.size) return NextResponse.json({ error: "Выберите непустой файл" }, { status: 400 });
  if (file.size > KNOWLEDGE_MAX_BYTES) return NextResponse.json({ error: "Максимальный размер файла — 25 МБ" }, { status: 413 });
  const content = new Uint8Array(await file.arrayBuffer());
  const mimeType = knowledgeFileType(file.name, content);
  if (!mimeType) return NextResponse.json({ error: "Формат или содержимое файла не поддерживается. Подойдут PDF, JPG, PNG, DOC, DOCX, XLS, XLSX, ZIP, RAR и 7Z." }, { status: 415 });
  const fileName = file.name.replace(/[\\/\r\n\x00]/g, "_").slice(0, 240);
  const title = String(form?.get("title") || fileName).trim().slice(0, 200) || fileName;
  const document = await db.knowledgeDocument.create({ data: { organizationId: auth.organizationId, title, fileName, mimeType, sizeBytes: content.byteLength, content, uploadedByName: auth.session.user.name ?? "" }, select: { id: true } });
  await recordAuditLog({ request, session: auth.session, organizationId: auth.organizationId, action: "knowledge.upload", entity: "KnowledgeDocument", entityId: document.id, details: { title, fileName, sizeBytes: content.byteLength } });
  return NextResponse.json(document, { status: 201 });
}
