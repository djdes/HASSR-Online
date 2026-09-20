import { NextResponse } from "next/server";
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
 * POST /api/settings/journal-pipelines/[code]/clear-all
 *
 * Удаляет ВСЕ узлы (pinned + custom) — полная очистка дерева.
 * После этого можно заново нажать «Создать из колонок» чтобы получить
 * чистый шаблон. UI должен подтверждать через typeToConfirm — это
 * максимально destructive operation для редактора.
 *
 * Отличается от `/clear-custom` тем, что НЕ оставляет pinned-узлы.
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

  const template = await findPipelineTemplate(organizationId, code);
  if (!template) {
    return NextResponse.json({ error: "Шаблон не найден" }, { status: 404 });
  }

  const result = await db.journalPipelineNode.deleteMany({
    where: { templateId: template.id },
  });

  await recordAuditLog({
    request,
    session: auth.session,
    organizationId,
    action: "settings.journal-pipelines.clear-all",
    entity: "JournalPipelineTemplate",
    entityId: template.id,
    details: { templateCode: code, removed: result.count },
  });

  const tree = await loadPipelineTree(organizationId, code);
  return NextResponse.json({ tree, removed: result.count });
}
