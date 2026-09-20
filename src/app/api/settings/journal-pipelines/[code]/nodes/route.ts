import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getActiveOrgId, requireApiAuth } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { recordAuditLog } from "@/lib/audit-log";
import {
  computeNextOrdering,
  ensurePipelineTemplate,
  loadPipelineTree,
} from "@/lib/journal-pipeline-tree";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createNodeSchema = z.object({
  parentId: z.string().nullable().optional(),
  title: z.string().min(1).max(200),
  detail: z.string().max(4000).optional().nullable(),
  hint: z.string().max(2000).optional().nullable(),
  photoMode: z.enum(["none", "optional", "required"]).optional(),
  requireComment: z.boolean().optional(),
  requireSignature: z.boolean().optional(),
});

/**
 * POST /api/settings/journal-pipelines/[code]/nodes
 *
 * Создаёт custom-узел в дереве pipeline'а. Pinned-узлы создаются
 * только через `/seed` endpoint (P1.2.b) или `/split` — нельзя
 * хитростью пометить custom как pinned через API. Если шаблона ещё
 * нет — он создаётся автоматически (`ensurePipelineTemplate`).
 *
 * Body: { parentId?: string|null, title, detail?, hint?, photoMode?, requireComment?, requireSignature? }
 */
export async function POST(
  request: Request,
  ctx: { params: Promise<{ code: string }> }
) {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;
  if (!hasFullWorkspaceAccess(auth.session.user)) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }
  const { code } = await ctx.params;
  const organizationId = getActiveOrgId(auth.session);

  let body: z.infer<typeof createNodeSchema>;
  try {
    body = createNodeSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Невалидный запрос" }, { status: 400 });
  }

  const template = await ensurePipelineTemplate(organizationId, code);

  if (body.parentId) {
    const parent = await db.journalPipelineNode.findUnique({
      where: { id: body.parentId },
      select: { id: true, templateId: true },
    });
    if (!parent || parent.templateId !== template.id) {
      return NextResponse.json(
        { error: "Родительский узел не найден" },
        { status: 404 }
      );
    }
  }

  const ordering = await computeNextOrdering(
    template.id,
    body.parentId ?? null
  );

  const node = await db.journalPipelineNode.create({
    data: {
      templateId: template.id,
      parentId: body.parentId ?? null,
      kind: "custom",
      title: body.title.trim(),
      detail: body.detail?.trim() || null,
      hint: body.hint?.trim() || null,
      ordering,
      photoMode: body.photoMode ?? "none",
      requireComment: body.requireComment ?? false,
      requireSignature: body.requireSignature ?? false,
    },
  });

  await recordAuditLog({
    request,
    session: auth.session,
    organizationId,
    action: "settings.journal-pipelines.node.create",
    entity: "JournalPipelineNode",
    entityId: node.id,
    details: {
      templateCode: code,
      title: node.title,
      parentId: node.parentId,
    },
  });

  const tree = await loadPipelineTree(organizationId, code);
  return NextResponse.json({ tree, nodeId: node.id });
}
