import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getActiveOrgId, requireApiAuth } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { recordAuditLog } from "@/lib/audit-log";
import {
  computeGuideNextOrdering,
  ensureGuideTemplate,
  loadGuideTree,
} from "@/lib/journal-guide-tree";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createNodeSchema = z.object({
  parentId: z.string().nullable().optional(),
  title: z.string().min(1).max(200),
  detail: z.string().max(4000).optional().nullable(),
  photoUrl: z.string().url().max(2000).optional().nullable(),
});

/**
 * POST /api/settings/journal-guides/[code]/nodes
 *
 * Создаёт узел гайда. Если шаблона ещё нет — он создаётся
 * автоматически (`ensureGuideTemplate`). Узлы образуют дерево через
 * parentId (можно делать вложенные подсекции, например «Холодильники
 * → Цех мяса → t°» и т.п.).
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

  const template = await ensureGuideTemplate(organizationId, code);

  if (body.parentId) {
    const parent = await db.journalGuideNode.findUnique({
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

  const ordering = await computeGuideNextOrdering(
    template.id,
    body.parentId ?? null
  );

  const node = await db.journalGuideNode.create({
    data: {
      templateId: template.id,
      parentId: body.parentId ?? null,
      title: body.title.trim(),
      detail: body.detail?.trim() || null,
      photoUrl: body.photoUrl?.trim() || null,
      ordering,
    },
  });

  await recordAuditLog({
    request,
    session: auth.session,
    organizationId,
    action: "settings.journal-guides.node.create",
    entity: "JournalGuideNode",
    entityId: node.id,
    details: {
      templateCode: code,
      title: node.title,
      parentId: node.parentId,
    },
  });

  const tree = await loadGuideTree(organizationId, code);
  return NextResponse.json({ tree, nodeId: node.id });
}
