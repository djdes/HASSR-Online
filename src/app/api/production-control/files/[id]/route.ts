import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePpkAccess } from "@/lib/ppk/access.server";
import { ppkWhere } from "@/lib/ppk/scope";
import { knowledgeInline } from "@/lib/knowledge-documents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET — скачать или открыть файл папки раздела ППК. */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requirePpkAccess();
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  const file = await db.knowledgeDocument.findFirst({
    where: { id, ...ppkWhere(auth.scope), folder: { not: null } },
    select: { fileName: true, mimeType: true, content: true },
  });
  if (!file) return NextResponse.json({ error: "Файл не найден" }, { status: 404 });
  const download = new URL(request.url).searchParams.get("download") === "1" || !knowledgeInline(file.mimeType);
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
