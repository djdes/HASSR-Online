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

/**
 * PATCH /api/settings/journal-pipelines/[code]/nodes/[id]/move
 *
 * Body: { parentId: string|null, ordering: number }
 *
 * Используется при drag-drop: UI считает новое значение `ordering` как
 * (предыдущий_сосед + следующий_сосед) / 2 чтобы не перетасовывать
 * остальных. parentId меняется когда узел переносится в другую группу.
 *
 * Гарантии:
 * - Узел и его новый parent должны принадлежать одному template'у.
 * - Нельзя сделать узел потомком самого себя или своего descendant'а
 *   (защита от циклов в дереве).
 */
const moveSchema = z.object({
  parentId: z.string().nullable(),
  ordering: z.number().finite(),
});

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

  let body: z.infer<typeof moveSchema>;
  try {
    body = moveSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Невалидный запрос" }, { status: 400 });
  }

  if (body.parentId === id) {
    return NextResponse.json(
      { error: "Узел не может быть собственным родителем" },
      { status: 400 }
    );
  }

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
    // Защита от цикла: проверяем что новый parent не среди descendant'ов.
    const allNodes = await db.journalPipelineNode.findMany({
      where: { templateId: template.id },
      select: { id: true, parentId: true },
    });
    const descendants = new Set<string>([id]);
    let added = true;
    while (added) {
      added = false;
      for (const n of allNodes) {
        if (
          n.parentId &&
          descendants.has(n.parentId) &&
          !descendants.has(n.id)
        ) {
          descendants.add(n.id);
          added = true;
        }
      }
    }
    if (descendants.has(body.parentId)) {
      return NextResponse.json(
        { error: "Нельзя сделать узел потомком его потомка" },
        { status: 400 }
      );
    }
  }

  await db.journalPipelineNode.update({
    where: { id },
    data: { parentId: body.parentId, ordering: body.ordering },
  });

  await recordAuditLog({
    request,
    session: auth.session,
    organizationId,
    action: "settings.journal-pipelines.node.move",
    entity: "JournalPipelineNode",
    entityId: id,
    details: {
      templateCode: code,
      parentId: body.parentId,
      ordering: body.ordering,
    },
  });

  const tree = await loadPipelineTree(organizationId, code);
  return NextResponse.json({ tree });
}
