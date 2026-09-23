import {
  guardInspectorDocumentRequest,
  inspectorPdfLimiter,
  logInspectorEvent,
} from "@/lib/inspector-access";
import { getInspectorDocPdf, inspectorDocVersion } from "@/lib/inspector-doc-sheets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PDF документа журнала для проверяющего — та же печатная форма, что у
 * кнопки «Печать» в кабинете (`generateJournalDocumentPdf`). Вход — токен
 * из QR; документ сверяется с организацией токена, окном дат и списком
 * отключённых журналов (иначе 404), лимит — 20 PDF в минуту.
 */
export async function GET(
  request: Request,
  ctx: { params: Promise<{ token: string; id: string }> }
) {
  const { token, id } = await ctx.params;
  const guard = await guardInspectorDocumentRequest({
    request,
    rawToken: token,
    documentId: id,
    limiter: inspectorPdfLimiter,
  });
  if (!guard.ok) return guard.response;
  const { access, doc, viewer } = guard;

  try {
    const version = await inspectorDocVersion(doc);
    const { pdf, fileName } = await getInspectorDocPdf(doc.id, access.token.organizationId, version);
    await logInspectorEvent({
      access,
      headers: request.headers,
      action: "inspector.download",
      viewer,
      details: {
        kind: "document_pdf",
        code: doc.template.code,
        journal: doc.template.name,
        documentId: doc.id,
        title: doc.title,
        controlCode: version.controlCode,
      },
    });
    const body = new Uint8Array(pdf);
    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        "Content-Length": String(body.byteLength),
        "Cache-Control": "private, no-store",
        "X-Robots-Tag": "noindex, nofollow",
      },
    });
  } catch (err) {
    console.error("[inspector] document pdf failed", doc.id, err);
    return new Response("Не удалось сформировать PDF", { status: 500 });
  }
}
