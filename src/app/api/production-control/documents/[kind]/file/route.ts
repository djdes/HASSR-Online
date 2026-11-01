import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { knowledgeInline } from "@/lib/knowledge-documents";
import { isProductionDocKind } from "@/lib/production-control-docs";
import { requireProductionDocsAccess } from "@/lib/production-control-docs.server";
import { ppkDocKindKey } from "@/lib/ppk/scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Открыть или скачать документ раздела: PDF и сканы — в браузере. */
export async function GET(request: Request, ctx: { params: Promise<{ kind: string }> }) {
  const auth = await requireProductionDocsAccess();
  if (!auth.ok) return auth.response;
  const { kind } = await ctx.params;
  if (!isProductionDocKind(kind)) {
    return NextResponse.json({ error: "Неизвестный вид документа" }, { status: 404 });
  }
  const file = await db.knowledgeDocument.findFirst({
    where: { organizationId: auth.organizationId, kind: ppkDocKindKey(kind, auth.scope.buildingId) },
    select: { fileName: true, mimeType: true, content: true },
  });
  if (!file) return NextResponse.json({ error: "Документ не загружен" }, { status: 404 });
  const download =
    new URL(request.url).searchParams.get("download") === "1" || !knowledgeInline(file.mimeType);
  return new Response(new Uint8Array(file.content), {
    headers: {
      "Content-Type": file.mimeType,
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
