import { createHash } from "node:crypto";
import { NextResponse } from "next/server";

import { resolveExportLocale } from "@/i18n/export-locale";
import { authOptions } from "@/lib/auth";
import { generateJournalDocumentPdf } from "@/lib/document-pdf";
import { orgLockedResponse } from "@/lib/org-trial.server";
import { getServerSession } from "@/lib/server-session";
import { loadUkepDocument, ukepPdfFileName } from "@/lib/ukep-access.server";
import { signUkepToken, ukepSecret } from "@/lib/ukep-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/journal-documents/[id]/ukep/prepare — шаг 1 подписи УКЭП (спека
 * journal-ukep-signing-2026-11-21): PDF документа, его SHA-256 и токен на 15
 * минут. Браузер подписывает ровно эти байты плагином КриптоПро и присылает
 * их обратно с подписью и токеном (`POST …/ukep`).
 *
 * Тело: `{ locale?: "ru" | "en" | "uz" }` — язык PDF, как у «Печати».
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  const { id } = await params;
  const access = await loadUkepDocument(session, id);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  if (!access.canSign) return NextResponse.json({ error: "Подписывать журнал может руководитель" }, { status: 403 });
  const locked = await orgLockedResponse(access.organizationId);
  if (locked) return locked;
  const secret = ukepSecret();
  if (!secret) return NextResponse.json({ error: "На сервере не настроен ключ подписи сессий" }, { status: 500 });

  const body = (await request.json().catch(() => null)) as { locale?: unknown } | null;
  const locale = resolveExportLocale(typeof body?.locale === "string" ? body.locale : null, session.user) ?? "ru";
  const { buffer, fileName } = await generateJournalDocumentPdf({ documentId: id, organizationId: access.organizationId, locale });
  const sha256 = createHash("sha256").update(buffer).digest("hex");
  const token = signUkepToken({ documentId: id, userId: session.user.id, organizationId: access.organizationId, sha256 }, secret);
  return NextResponse.json(
    { pdf: Buffer.from(buffer).toString("base64"), fileName: ukepPdfFileName(fileName), sha256, token },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
