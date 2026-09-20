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
 * POST /api/settings/journal-pipelines/[code]/nodes/[id]/split
 *
 * Разделяет pinned-узел на два. Оба новых узла ссылаются на тот же
 * `linkedFieldKey` — worker заполнит их последовательно, и UI на
 * этапе сборки JournalDocumentEntry соберёт единое значение колонки
 * из обоих шагов (P1.4 generic-adapter merge).
 *
 * Бизнес-логика:
 * - Действует только на kind="pinned". Custom — 400.
 * - Title оригинала становится "{title} (часть 1)", создаётся новый
 *   "{title} (часть 2)" с ordering = original.ordering + 0.5.
 *   Использование Float-ordering позволяет вставить новый узел между
 *   текущим и следующим siblings без перетасовки.
 * - Если текущий title уже заканчивается на " (часть N)" — берётся
 *   базовый, и новый узел получает следующий номер.
 */
export async function POST(
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
  if (node.kind !== "pinned") {
    return NextResponse.json(
      { error: "Разделить можно только pinned-узел" },
      { status: 400 }
    );
  }

  const partSuffix = / \(часть (\d+)\)$/;
  const match = node.title.match(partSuffix);
  let baseTitle: string;
  let nextPartNumber: number;
  if (match) {
    baseTitle = node.title.replace(partSuffix, "");
    nextPartNumber = Number(match[1]) + 1;
  } else {
    baseTitle = node.title;
    nextPartNumber = 2;
  }

  const newOriginalTitle = match
    ? node.title
    : `${baseTitle} (часть 1)`;

  const [updatedOriginal, newNode] = await db.$transaction([
    db.journalPipelineNode.update({
      where: { id: node.id },
      data: { title: newOriginalTitle },
    }),
    db.journalPipelineNode.create({
      data: {
        templateId: template.id,
        parentId: node.parentId,
        kind: "pinned",
        linkedFieldKey: node.linkedFieldKey,
        title: `${baseTitle} (часть ${nextPartNumber})`,
        ordering: node.ordering + 0.5,
        photoMode: "none",
        requireComment: false,
        requireSignature: false,
      },
    }),
  ]);

  await recordAuditLog({
    request,
    session: auth.session,
    organizationId,
    action: "settings.journal-pipelines.node.split",
    entity: "JournalPipelineNode",
    entityId: newNode.id,
    details: {
      templateCode: code,
      originalNodeId: updatedOriginal.id,
      linkedFieldKey: node.linkedFieldKey,
      newPartNumber: nextPartNumber,
    },
  });

  const tree = await loadPipelineTree(organizationId, code);
  return NextResponse.json({
    tree,
    originalNodeId: updatedOriginal.id,
    newNodeId: newNode.id,
  });
}
