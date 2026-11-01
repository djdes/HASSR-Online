import { getServerSession } from "@/lib/server-session";
import { authOptions } from "@/lib/auth";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { aclActorFromSession, hasJournalAccess } from "@/lib/journal-acl";
import { generateJournalDocumentPdf } from "@/lib/document-pdf";
import { journalPdfErrorResponse } from "@/lib/journal-pdf-error";
import { resolveRequestLocale } from "@/i18n/site-locale";
import { resolveExportLocale } from "@/i18n/export-locale";
import { canSeeDocumentPoint } from "@/lib/document-point-access";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  let locale = resolveRequestLocale(request);
  try {
    const session = await getServerSession(authOptions);

    if (!session) {
      return journalPdfErrorResponse(request, "UNAUTHORIZED", locale);
    }

    const { id } = await params;
    const orgId = getActiveOrgId(session);
    locale = resolveExportLocale(null, session.user)!;
    const requestedLocale = resolveExportLocale(new URL(request.url).searchParams.get("locale"), session.user);
    if (!requestedLocale) return journalPdfErrorResponse(request, "INVALID_LOCALE", locale);
    locale = requestedLocale;

    // ACL-check: раньше любой org-member мог скачать PDF любого
    // журнала, включая journals на которые у него нет доступа
    // (UserJournalAccess.canRead). Подгружаем template.code и
    // проверяем через hasJournalAccess.
    const docMeta = await db.journalDocument.findUnique({
      where: { id },
      select: {
        organizationId: true,
        buildingId: true,
        template: { select: { code: true } },
      },
    });
    if (!docMeta || docMeta.organizationId !== orgId || !(await canSeeDocumentPoint(session, docMeta.buildingId))) {
      return journalPdfErrorResponse(request, "DOCUMENT_NOT_FOUND", locale);
    }
    const access = await hasJournalAccess(
      aclActorFromSession({
        user: {
          id: session.user.id,
          role: session.user.role,
          isRoot: session.user.isRoot === true,
        },
      }),
      docMeta.template.code
    );
    if (!access) {
      return journalPdfErrorResponse(request, "JOURNAL_FORBIDDEN", locale);
    }

    const { buffer, fileName } = await generateJournalDocumentPdf({
      documentId: id,
      organizationId: orgId,
      locale,
    });

    const uint8 = new Uint8Array(buffer);

    return new Response(uint8, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Cache-Control": "private, no-store",
        "Content-Language": locale,
        "Content-Disposition": `inline; filename="${fileName}"`,
        "Content-Length": String(uint8.length),
      },
    });
  } catch (error) {
    const missing = error instanceof Error && error.message === "Документ не найден";
    if (!missing) console.error("[journal-document-pdf] Generation failed", error);
    return journalPdfErrorResponse(request, missing ? "DOCUMENT_NOT_FOUND" : "PDF_FAILED", locale);
  }
}
