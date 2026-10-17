import {
  inspectorClientIp,
  inspectorLimitKey,
  inspectorPdfLimiter,
  loadInspectorAccess,
  logInspectorEvent,
} from "@/lib/inspector-access";
import { isInspectionNormDoc, knowledgeKindOf } from "@/lib/inspection-norms";
import { db } from "@/lib/db";
import { knowledgeInline } from "@/lib/knowledge-documents";
import { loadPpkBundle } from "@/lib/ppk/assemble.server";
import { buildHaccpPlanPdf, buildPpkProgramPdf } from "@/lib/ppk/pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TITLE = { ppk: "ППК", "haccp-plan": "ХАССП-план" } as const;

function plain(status: number, message: string): Response {
  return new Response(message, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}

/**
 * ППК и ХАССП-план для проверяющего — только чтение, по токену QR.
 *
 *   GET /api/inspector/[token]/production-control/ppk           — собранный из разделов PDF
 *   GET /api/inspector/[token]/production-control/ppk?file=1    — загруженный файл
 *   (то же для `haccp-plan`)
 *
 * Организация — только из токена. Отозванный или истёкший токен — 410.
 */
export async function GET(request: Request, ctx: { params: Promise<{ token: string; doc: string }> }) {
  const { token, doc } = await ctx.params;
  const access = await loadInspectorAccess(token);
  if (access.status === "not_found") return plain(404, "Не найдено");
  if (access.status !== "ok") return plain(410, "Доступ отозван или истёк");
  if (!isInspectionNormDoc(doc)) return plain(404, "Не найдено");
  if (!inspectorPdfLimiter.consume(inspectorLimitKey(access.token.id, inspectorClientIp(request.headers)))) {
    return plain(429, "Слишком много запросов. Повторите через минуту.");
  }
  const organizationId = access.token.organizationId;
  const wantsFile = new URL(request.url).searchParams.get("file") === "1";

  let body: Uint8Array<ArrayBuffer>;
  let mimeType: string;
  let fileName: string;
  if (wantsFile) {
    const file = await db.knowledgeDocument.findFirst({
      where: { organizationId, kind: knowledgeKindOf(doc) },
      select: { fileName: true, mimeType: true, content: true },
    });
    if (!file) return plain(404, "Документ не загружен");
    body = new Uint8Array(file.content);
    mimeType = file.mimeType;
    fileName = file.fileName;
  } else {
    const bundle = await loadPpkBundle(organizationId);
    body = new Uint8Array(doc === "ppk" ? buildPpkProgramPdf(bundle) : buildHaccpPlanPdf(bundle));
    mimeType = "application/pdf";
    fileName = `${TITLE[doc]} — ${bundle.org.orgName || "организация"}.pdf`.replace(/[\\/:*?"<>|]+/g, "-");
  }

  await logInspectorEvent({
    access,
    headers: request.headers,
    action: "inspector.download",
    viewer: null,
    details: { kind: "ppk_document", title: `${TITLE[doc]}${wantsFile ? " (загруженный файл)" : ""}` },
  });

  const inline = knowledgeInline(mimeType);
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": mimeType,
      "Content-Length": String(body.byteLength),
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
