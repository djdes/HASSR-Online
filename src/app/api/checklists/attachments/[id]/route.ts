import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireChecklistAccess } from "@/lib/custom-checklists.server";
import { checklistByteRange } from "@/lib/custom-checklist-files";

export const dynamic = "force-dynamic";
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireChecklistAccess(); if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  const file = await db.checklistAttachment.findFirst({ where: { id, organizationId: auth.organizationId, OR: [
    { purpose: "reference", ...(auth.canManage ? {} : { OR: [{ templateId: { not: null } }, { createdById: auth.session.user.id }] }) },
    { inspection: { organizationId: auth.organizationId, ...(auth.canManage ? {} : { createdById: auth.session.user.id }) } },
  ] } });
  if (!file) return NextResponse.json({ error: "Файл не найден" }, { status: 404 });
  const range = checklistByteRange(request.headers.get("range"), file.sizeBytes);
  const headers = { "Content-Type": file.mimeType, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Accept-Ranges": "bytes", "Content-Disposition": `${file.mimeType.startsWith("image/") || file.mimeType.startsWith("video/") || file.mimeType.startsWith("audio/") || file.mimeType === "application/pdf" ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.fileName)}` };
  if (range === "invalid") return new NextResponse(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${file.sizeBytes}` } });
  const bytes = range ? file.content.slice(range.start, range.end + 1) : file.content;
  return new NextResponse(new Uint8Array(bytes), { status: range ? 206 : 200, headers: { ...headers, "Content-Length": String(bytes.length), ...(range ? { "Content-Range": `bytes ${range.start}-${range.end}/${file.sizeBytes}` } : {}) } });
}
