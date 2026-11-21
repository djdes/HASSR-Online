import { createHash } from "node:crypto";
import { NextResponse } from "next/server";

import { authOptions } from "@/lib/auth";
import { recordAuditLog } from "@/lib/audit-log";
import { checkSignatureForPdf, CmsError, parseCmsSignature } from "@/lib/cms-signature";
import { db } from "@/lib/db";
import { canSeeDocumentPoint } from "@/lib/document-point-access";
import { orgLockedResponse } from "@/lib/org-trial.server";
import { getServerSession } from "@/lib/server-session";
import { findUkepDocument, ukepJournalAccess, ukepPdfFileName } from "@/lib/ukep-access.server";
import { ukepSecret, verifyUkepToken } from "@/lib/ukep-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** PDF журнала — до 25 МБ, подпись — до 256 КБ (в base64 чуть больше). */
const MAX_PDF_BASE64 = Math.ceil((25 * 1024 * 1024 * 4) / 3);
const MAX_SIGNATURE_BASE64 = Math.ceil((256 * 1024 * 4) / 3);

const SIGNATURE_LIST_SELECT = {
  id: true,
  userId: true,
  fileName: true,
  pdfSha256: true,
  digest: true,
  digestChecked: true,
  signerName: true,
  signerOrg: true,
  signerTitle: true,
  signerInn: true,
  signerSnils: true,
  issuerName: true,
  certSerial: true,
  certValidTo: true,
  signedAt: true,
  createdAt: true,
} as const;

/**
 * Подписи УКЭП документа журнала (спека journal-ukep-signing-2026-11-21).
 *
 * GET — список подписей (без байтов) и можно ли подписывать этому человеку.
 * POST `{ pdf, signature, token, fileName }` — шаг 2: PDF из `…/ukep/prepare`,
 * откреплённая подпись плагина КриптоПро (base64) и токен. Сервер сверяет
 * токен и хэш, разбирает подпись (подписант — из её сертификата) и сохраняет
 * PDF и подпись в базе.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  const { id } = await params;
  const found = await findUkepDocument(session, id);
  if (!found || !(await canSeeDocumentPoint(session, found.document.buildingId))) {
    return NextResponse.json({ error: "Документ не найден" }, { status: 404 });
  }
  const access = await ukepJournalAccess(session, found.document.templateCode);
  if (!access.read) return NextResponse.json({ error: "Нет доступа к этому журналу" }, { status: 403 });
  const signatures = await db.journalDocumentSignature.findMany({
    where: { organizationId: found.organizationId, documentId: id },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: SIGNATURE_LIST_SELECT,
  });
  return NextResponse.json({ canSign: access.canSign, signatures }, { headers: { "Cache-Control": "private, no-store" } });
}

const decodeBase64 = (value: unknown, max: number): Buffer | null => {
  if (typeof value !== "string" || value.length === 0 || value.length > max) return null;
  const compact = value.replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) return null;
  return Buffer.from(compact, "base64");
};

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  const { id } = await params;
  const found = await findUkepDocument(session, id);
  if (!found || !(await canSeeDocumentPoint(session, found.document.buildingId))) {
    return NextResponse.json({ error: "Документ не найден" }, { status: 404 });
  }
  const access = await ukepJournalAccess(session, found.document.templateCode);
  if (!access.read) return NextResponse.json({ error: "Нет доступа к этому журналу" }, { status: 403 });
  if (!access.canSign) return NextResponse.json({ error: "Подписывать журнал может руководитель" }, { status: 403 });
  const locked = await orgLockedResponse(found.organizationId);
  if (locked) return locked;
  const secret = ukepSecret();
  if (!secret) return NextResponse.json({ error: "На сервере не настроен ключ подписи сессий" }, { status: 500 });

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const pdf = decodeBase64(body?.pdf, MAX_PDF_BASE64);
  const signatureBytes = decodeBase64(body?.signature, MAX_SIGNATURE_BASE64);
  if (!pdf || !signatureBytes || typeof body?.token !== "string") {
    return NextResponse.json({ error: "Нет PDF, подписи или токена — начните подписание заново" }, { status: 400 });
  }
  const pdfSha256 = createHash("sha256").update(pdf).digest("hex");
  const token = verifyUkepToken(body.token, secret, {
    documentId: id,
    userId: session.user.id,
    organizationId: found.organizationId,
    sha256: pdfSha256,
  });
  if (!token.ok) return NextResponse.json({ error: token.error }, { status: 400 });

  let parsed;
  try {
    parsed = parseCmsSignature(new Uint8Array(signatureBytes));
  } catch (error) {
    if (error instanceof CmsError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
  const check = checkSignatureForPdf(parsed, new Uint8Array(pdf), new Date());
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 });

  const { signer } = parsed;
  const saved = await db.journalDocumentSignature.create({
    data: {
      organizationId: found.organizationId,
      documentId: id,
      userId: session.user.id,
      fileName: ukepPdfFileName(body.fileName),
      pdf: new Uint8Array(pdf),
      pdfSha256,
      signature: new Uint8Array(signatureBytes),
      digest: parsed.digest,
      digestChecked: check.digestChecked,
      signerName: signer.subjectName,
      signerOrg: signer.organization,
      signerTitle: signer.title,
      signerInn: signer.inn,
      signerSnils: signer.snils,
      signerOgrn: signer.ogrn,
      issuerName: signer.issuerName,
      certSerial: signer.serialHex,
      certValidFrom: signer.validFrom,
      certValidTo: signer.validTo,
      signedAt: parsed.signingTime,
    },
    select: SIGNATURE_LIST_SELECT,
  });
  await recordAuditLog({
    request,
    session,
    organizationId: found.organizationId,
    action: "journal.ukep_sign",
    entity: "JournalDocument",
    entityId: id,
    details: { signatureId: saved.id, signerName: signer.subjectName, certSerial: signer.serialHex, digest: parsed.digest, pdfSha256 },
  });
  return NextResponse.json({ signature: saved });
}
