import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { recordAuditLog } from "@/lib/audit-log";
import { KNOWLEDGE_MAX_BYTES } from "@/lib/knowledge-documents";
import {
  PRODUCTION_DOC_KINDS,
  isProductionDocKind,
  productionDocFileType,
} from "@/lib/production-control-docs";
import { requireProductionDocsAccess } from "@/lib/production-control-docs.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SELECT = {
  kind: true,
  fileName: true,
  mimeType: true,
  sizeBytes: true,
  uploadedByName: true,
  updatedAt: true,
} as const;

/** GET — оба документа раздела (что загружено). */
export async function GET() {
  const auth = await requireProductionDocsAccess();
  if (!auth.ok) return auth.response;
  const documents = await db.knowledgeDocument.findMany({
    where: { organizationId: auth.organizationId, kind: { in: [...PRODUCTION_DOC_KINDS] } },
    select: SELECT,
  });
  return NextResponse.json({ documents }, { headers: { "Cache-Control": "private, no-store" } });
}

/** POST multipart: kind=ppk|haccp_plan, file — загрузить или заменить. */
export async function POST(request: Request) {
  const auth = await requireProductionDocsAccess(true);
  if (!auth.ok) return auth.response;
  const form = await request.formData().catch(() => null);
  const kind = form?.get("kind");
  if (!isProductionDocKind(kind)) {
    return NextResponse.json({ error: "Неизвестный вид документа" }, { status: 400 });
  }
  const file = form?.get("file");
  if (!(file instanceof File) || !file.size) {
    return NextResponse.json({ error: "Выберите непустой файл" }, { status: 400 });
  }
  if (file.size > KNOWLEDGE_MAX_BYTES) {
    return NextResponse.json({ error: "Максимальный размер файла — 25 МБ" }, { status: 413 });
  }
  const content = new Uint8Array(await file.arrayBuffer());
  const mimeType = productionDocFileType(file.name, content);
  if (!mimeType) {
    return NextResponse.json(
      { error: "Подойдёт PDF, Word (DOC, DOCX) или скан JPG/PNG" },
      { status: 415 },
    );
  }
  const fileName = file.name.replace(/[\/\r\n\x00]/g, "_").slice(0, 240);
  const data = {
    title: fileName,
    fileName,
    mimeType,
    sizeBytes: content.byteLength,
    content,
    uploadedByName: auth.session.user.name ?? "",
  };
  const document = await db.knowledgeDocument.upsert({
    where: { organizationId_kind: { organizationId: auth.organizationId, kind } },
    create: { organizationId: auth.organizationId, kind, ...data },
    update: data,
    select: SELECT,
  });
  await recordAuditLog({
    request,
    session: auth.session,
    organizationId: auth.organizationId,
    action: "production-control.upload",
    entity: "KnowledgeDocument",
    entityId: kind,
    details: { kind, fileName, sizeBytes: content.byteLength },
  });
  return NextResponse.json({ document }, { status: 201 });
}

/** DELETE ?kind=ppk|haccp_plan */
export async function DELETE(request: Request) {
  const auth = await requireProductionDocsAccess(true);
  if (!auth.ok) return auth.response;
  const kind = new URL(request.url).searchParams.get("kind");
  if (!isProductionDocKind(kind)) {
    return NextResponse.json({ error: "Неизвестный вид документа" }, { status: 400 });
  }
  await db.knowledgeDocument.deleteMany({ where: { organizationId: auth.organizationId, kind } });
  await recordAuditLog({
    request,
    session: auth.session,
    organizationId: auth.organizationId,
    action: "production-control.delete",
    entity: "KnowledgeDocument",
    entityId: kind,
    details: { kind },
  });
  return NextResponse.json({ ok: true });
}
