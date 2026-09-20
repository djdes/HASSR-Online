import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getActiveOrgId, requireApiAuth } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { recordAuditLog } from "@/lib/audit-log";
import {
  findPipelineTemplate,
  loadPipelineTree,
} from "@/lib/journal-pipeline-tree";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const updateNodeSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  detail: z.string().max(4000).nullable().optional(),
  hint: z.string().max(2000).nullable().optional(),
  photoMode: z.enum(["none", "optional", "required"]).optional(),
  requireComment: z.boolean().optional(),
  requireSignature: z.boolean().optional(),
});

/**
 * PATCH /api/settings/journal-pipelines/[code]/nodes/[id]
 * Редактирование узла. Можно менять title/detail/hint/photoMode/
 * requireComment/requireSignature. `kind` и `linkedFieldKey` не
 * меняются через этот endpoint (kind задаётся при создании, lifecycle
 * pinned идёт через /seed и /split).
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

  const template = await findPipelineTemplate(organizationId, code);
  if (!template) {
    return NextResponse.json({ error: "Шаблон не найден" }, { status: 404 });
  }
  const node = await db.journalPipelineNode.findUnique({ where: { id } });
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
    hint?: string | null;
    photoMode?: string;
    requireComment?: boolean;
    requireSignature?: boolean;
  } = {};

  if (body.title !== undefined) data.title = body.title.trim();
  if (body.detail !== undefined)
    data.detail = body.detail === null ? null : body.detail.trim() || null;
  if (body.hint !== undefined)
    data.hint = body.hint === null ? null : body.hint.trim() || null;
  if (body.photoMode !== undefined) data.photoMode = body.photoMode;
  if (body.requireComment !== undefined)
    data.requireComment = body.requireComment;
  if (body.requireSignature !== undefined)
    data.requireSignature = body.requireSignature;

  if (Object.keys(data).length === 0) {
    return NextResponse.json(
      { error: "Нет полей для обновления" },
      { status: 400 }
    );
  }

  await db.journalPipelineNode.update({ where: { id }, data });

  await recordAuditLog({
    request,
    session: auth.session,
    organizationId,
    action: "settings.journal-pipelines.node.update",
    entity: "JournalPipelineNode",
    entityId: id,
    details: { templateCode: code, ...data },
  });

  const tree = await loadPipelineTree(organizationId, code);
  return NextResponse.json({ tree });
}

/**
 * DELETE /api/settings/journal-pipelines/[code]/nodes/[id]
 * Удаляет узел. Pinned (kind="pinned") нельзя удалять — 403.
 * Удаляет и всех children (cascade в schema).
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

  const template = await findPipelineTemplate(organizationId, code);
  if (!template) {
    return NextResponse.json({ error: "Шаблон не найден" }, { status: 404 });
  }
  const node = await db.journalPipelineNode.findUnique({ where: { id } });
  if (!node || node.templateId !== template.id) {
    return NextResponse.json({ error: "Узел не найден" }, { status: 404 });
  }
  if (node.kind === "pinned") {
    return NextResponse.json(
      { error: "Системный узел нельзя удалить" },
      { status: 403 }
    );
  }

  await db.journalPipelineNode.delete({ where: { id } });

  await recordAuditLog({
    request,
    session: auth.session,
    organizationId,
    action: "settings.journal-pipelines.node.delete",
    entity: "JournalPipelineNode",
    entityId: id,
    details: { templateCode: code, title: node.title },
  });

  const tree = await loadPipelineTree(organizationId, code);
  return NextResponse.json({ tree });
}
