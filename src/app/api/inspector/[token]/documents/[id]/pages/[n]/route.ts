import {
  guardInspectorDocumentRequest,
  inspectorViewLimiter,
  logInspectorEvent,
} from "@/lib/inspector-access";
import { getInspectorDocPage, inspectorDocVersion } from "@/lib/inspector-doc-sheets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Лист n документа журнала в PNG: `/api/inspector/<token>/documents/<id>/pages/1.png`.
 * Проверки — как у PDF: организация токена, окно дат, журнал не отключён,
 * лимит запросов. В журнал действий пишем открытие документа (первый
 * лист), а не каждый лист — иначе квартал давал бы сотню строк.
 */
export async function GET(
  request: Request,
  ctx: { params: Promise<{ token: string; id: string; n: string }> }
) {
  const { token, id, n } = await ctx.params;
  const match = /^(\d{1,4})(?:\.png)?$/.exec(n);
  const pageNumber = match ? Number(match[1]) : NaN;
  const guard = await guardInspectorDocumentRequest({
    request,
    rawToken: token,
    documentId: id,
    limiter: inspectorViewLimiter,
  });
  if (!guard.ok) return guard.response;
  const { access, doc, viewer } = guard;
  if (!Number.isInteger(pageNumber) || pageNumber < 1) {
    return new Response("Лист не найден", { status: 404 });
  }

  try {
    const version = await inspectorDocVersion(doc);
    const png = await getInspectorDocPage(doc.id, access.token.organizationId, version, pageNumber);
    if (!png) return new Response("Лист не найден", { status: 404 });
    if (pageNumber === 1) {
      await logInspectorEvent({
        access,
        headers: request.headers,
        action: "inspector.view",
        viewer,
        details: {
          kind: "document",
          code: doc.template.code,
          journal: doc.template.name,
          documentId: doc.id,
          title: doc.title,
          controlCode: version.controlCode,
        },
      });
    }
    const body = new Uint8Array(png);
    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Content-Length": String(body.byteLength),
        // Адрес листа не меняется при правке записей — кэш браузера
        // короткий и приватный; повторный показ всё равно из памяти сервера.
        "Cache-Control": "private, max-age=60",
        "X-Robots-Tag": "noindex, nofollow",
      },
    });
  } catch (err) {
    console.error("[inspector] sheet render failed", doc.id, pageNumber, err);
    return new Response("Не удалось показать лист", { status: 500 });
  }
}
