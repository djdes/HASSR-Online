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
 * POST /api/settings/journal-pipelines/[code]/clear-custom
 *
 * Удаляет ВСЕ custom-узлы в шаблоне, оставляя только pinned. Используется
 * когда админ заигрался с custom-шагами и хочет «откат к минимуму». UI
 * должен подтверждать через typeToConfirm — это destructive.
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
    where: { templateId: template.id, kind: "custom" },
  });

  await recordAuditLog({
    request,
    session: auth.session,
    organizationId,
    action: "settings.journal-pipelines.clear-custom",
    entity: "JournalPipelineTemplate",
    entityId: template.id,
    details: { templateCode: code, removed: result.count },
  });

  const tree = await loadPipelineTree(organizationId, code);
  return NextResponse.json({ tree, removed: result.count });
}
