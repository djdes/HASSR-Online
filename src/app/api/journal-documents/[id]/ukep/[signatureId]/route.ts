import { NextResponse } from "next/server";

import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { getServerSession } from "@/lib/server-session";
import { attachmentDisposition, loadUkepDocument } from "@/lib/ukep-access.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/journal-documents/[id]/ukep/[signatureId]?file=pdf|sig — подписанный
 * PDF или его откреплённая подпись (спека journal-ukep-signing-2026-11-21).
 * Пару «PDF + .sig» проверяют на Госуслугах или в КриптоАРМ. Только своей
 * организации, своей точки и с доступом к журналу.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string; signatureId: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  const { id, signatureId } = await params;
  const access = await loadUkepDocument(session, id);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const file = new URL(request.url).searchParams.get("file") === "sig" ? "sig" : "pdf";
  const row = await db.journalDocumentSignature.findFirst({
    where: { id: signatureId, documentId: id, organizationId: access.organizationId },
    select: { fileName: true, pdf: file === "pdf", signature: file === "sig" },
  });
  if (!row) return NextResponse.json({ error: "Подпись не найдена" }, { status: 404 });
  const bytes = new Uint8Array(file === "pdf" ? (row.pdf as Uint8Array) : (row.signature as Uint8Array));
  return new Response(bytes, {
    headers: {
      "Content-Type": file === "pdf" ? "application/pdf" : "application/pkcs7-signature",
      "Content-Disposition": attachmentDisposition(file === "pdf" ? row.fileName : `${row.fileName}.sig`),
      "Content-Length": String(bytes.length),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
