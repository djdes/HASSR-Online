import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireKnowledgeAccess } from "@/lib/knowledge-documents.server";
import { knowledgeInline } from "@/lib/knowledge-documents";

export const dynamic = "force-dynamic";
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireKnowledgeAccess();
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  const file = await db.knowledgeDocument.findFirst({ where: { id, organizationId: auth.organizationId, kind: null, folder: null }, select: { fileName: true, mimeType: true, content: true } });
  if (!file) return NextResponse.json({ error: "Документ не найден" }, { status: 404 });
  const download = new URL(request.url).searchParams.get("download") === "1" || !knowledgeInline(file.mimeType);
  return new Response(new Uint8Array(file.content), { headers: {
    "Content-Type": file.mimeType,
    "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
    "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "X-Robots-Tag": "noindex, nofollow",
  } });
}
