import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getActiveOrgId, requireApiAuth } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { recordAuditLog } from "@/lib/audit-log";
import {
  findGuideTemplate,
  loadGuideTree,
} from "@/lib/journal-guide-tree";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const updateNodeSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  detail: z.string().max(4000).nullable().optional(),
  photoUrl: z.string().url().max(2000).nullable().optional(),
});

/**
 * PATCH /api/settings/journal-guides/[code]/nodes/[id]
 * Можно менять title, detail, photoUrl. Tree-структура (parentId,
 * ordering) меняется через /move.
 */
export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ code: string; id: string }> }
) {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;
  if (!hasFullWorkspaceAccess(auth.session.user)) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }
  const { code, id } = await ctx.params;
  const organizationId = getActiveOrgId(auth.session);

  const template = await findGuideTemplate(organizationId, code);
  if (!template) {
    return NextResponse.json({ error: "Шаблон не найден" }, { status: 404 });
  }
  const node = await db.journalGuideNode.findUnique({ where: { id } });
  if (!node || node.templateId !== template.id) {
    return NextResponse.json({ error: "Узел не найден" }, { status: 404 });
  }

  let body: z.infer<typeof updateNodeSchema>;
  try {
    body = updateNodeSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Невалидный запрос" }, { status: 400 });
  }

  const data: {
    title?: string;
    detail?: string | null;
    photoUrl?: string | null;
  } = {};

  if (body.title !== undefined) data.title = body.title.trim();
  if (body.detail !== undefined)
    data.detail = body.detail === null ? null : body.detail.trim() || null;
  if (body.photoUrl !== undefined)
    data.photoUrl =
      body.photoUrl === null ? null : body.photoUrl.trim() || null;

  if (Object.keys(data).length === 0) {
    return NextResponse.json(
      { error: "Нет полей для обновления" },
      { status: 400 }
    );
  }

  await db.journalGuideNode.update({ where: { id }, data });

  await recordAuditLog({
    request,
    session: auth.session,
    organizationId,
    action: "settings.journal-guides.node.update",
    entity: "JournalGuideNode",
    entityId: id,
    details: { templateCode: code, ...data },
  });

  const tree = await loadGuideTree(organizationId, code);
  return NextResponse.json({ tree });
}

/**
 * DELETE /api/settings/journal-guides/[code]/nodes/[id]
 * Удаляет узел и всех его children через cascade (см. schema).
 */
export async function DELETE(
  request: Request,
  ctx: { params: Promise<{ code: string; id: string }> }
) {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;
  if (!hasFullWorkspaceAccess(auth.session.user)) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }
  const { code, id } = await ctx.params;
  const organizationId = getActiveOrgId(auth.session);

  const template = await findGuideTemplate(organizationId, code);
  if (!template) {
    return NextResponse.json({ error: "Шаблон не найден" }, { status: 404 });
  }
  const node = await db.journalGuideNode.findUnique({ where: { id } });
  if (!node || node.templateId !== template.id) {
    return NextResponse.json({ error: "Узел не найден" }, { status: 404 });
  }

  await db.journalGuideNode.delete({ where: { id } });

  await recordAuditLog({
    request,
    session: auth.session,
    organizationId,
    action: "settings.journal-guides.node.delete",
    entity: "JournalGuideNode",
    entityId: id,
    details: { templateCode: code, title: node.title },
  });

  const tree = await loadGuideTree(organizationId, code);
  return NextResponse.json({ tree });
}
