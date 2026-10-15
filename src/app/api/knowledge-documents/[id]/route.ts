import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireKnowledgeAccess } from "@/lib/knowledge-documents.server";
import { recordAuditLog } from "@/lib/audit-log";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };
async function change(request: Request, ctx: Ctx, remove: boolean) {
  const auth = await requireKnowledgeAccess(true);
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  const where = { id, organizationId: auth.organizationId };
  const current = await db.knowledgeDocument.findFirst({ where, select: { title: true } });
  if (!current) return NextResponse.json({ error: "Документ не найден" }, { status: 404 });
  let title = current.title;
  if (remove) await db.knowledgeDocument.deleteMany({ where });
  else {
    const parsed = z.object({ title: z.string().trim().min(1).max(200) }).strict().safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Введите название до 200 символов" }, { status: 400 });
    title = parsed.data.title;
    await db.knowledgeDocument.updateMany({ where, data: { title } });
  }
  await recordAuditLog({ request, session: auth.session, organizationId: auth.organizationId, action: remove ? "knowledge.delete" : "knowledge.rename", entity: "KnowledgeDocument", entityId: id, details: { before: current.title, title } });
  return NextResponse.json({ ok: true });
}
export async function PATCH(request: Request, ctx: Ctx) { return change(request, ctx, false); }
export async function DELETE(request: Request, ctx: Ctx) { return change(request, ctx, true); }
