import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getActiveOrgId, requireApiAuth } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { tasksflowClientFor } from "@/lib/tasksflow-client";
import { parseScopeSteps } from "@/lib/cleaning-document";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/integrations/tasksflow/sync-room-photo-policy
 *
 * Когда менеджер меняет Room.requirePhoto или per-step requirePhoto в
 * редакторе помещения, существующие TF-задачи этого помещения
 * НЕ обновляются автоматически — bulk-assign-today и
 * syncCleaningCellOverride пушат requiresPhoto только при создании.
 *
 * Этот endpoint находит ВСЕ TF-задачи (TasksFlowTaskLink) для
 * (documentId, roomId) — и override-задачи (rowKey="cell-override::..."),
 * и race-mode bulk-assigned (rowKey="room::<id>::cleaner::*") — и
 * пушит updated requiresPhoto через TF PUT /api/tasks/:id.
 *
 * Effective requirePhoto:
 *   Room.requirePhoto OR любой scope-step имеет explicit requirePhoto=true.
 */
const Schema = z.object({
  documentId: z.string().min(1),
  roomId: z.string().min(1),
});

export async function POST(request: Request) {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;
  if (!hasFullWorkspaceAccess(auth.session.user)) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }
  const orgId = getActiveOrgId(auth.session);

  let body: z.infer<typeof Schema>;
  try {
    body = Schema.parse(await request.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: err.issues[0]?.message ?? "Bad input" },
        { status: 400 },
      );
    }
    throw err;
  }

  const integration = await db.tasksFlowIntegration.findUnique({
    where: { organizationId: orgId },
  });
  if (!integration || !integration.enabled) {
    return NextResponse.json({ ok: true, updated: 0, skipped: "no-integration" });
  }

  // Multi-tenant scope: документ должен принадлежать орге.
  const doc = await db.journalDocument.findFirst({
    where: { id: body.documentId, organizationId: orgId },
    select: { id: true },
  });
  if (!doc) {
    return NextResponse.json({ error: "Документ не найден" }, { status: 404 });
  }

  const room = await db.room.findFirst({
    where: { id: body.roomId, building: { organizationId: orgId } },
    select: {
      id: true,
      requirePhoto: true,
      currentScope: true,
      generalScope: true,
    },
  });
  if (!room) {
    return NextResponse.json({ error: "Помещение не найдено" }, { status: 404 });
  }

  const effectiveRequirePhoto =
    room.requirePhoto === true ||
    parseScopeSteps(room.currentScope).some((s) => s.requirePhoto === true) ||
    parseScopeSteps(room.generalScope).some((s) => s.requirePhoto === true);

  // Находим все TF-задачи этого помещения. RowKey-форматы:
  //   - "cell-override::{roomId}::{dateKey}" (legacy single)
  //   - "cell-override::{roomId}::{dateKey}::cleaner::{userId}" (new multi)
  //   - "room::{roomId}::cleaner::{userId}" (race-mode bulk-assign)
  // Все три захватываются через startsWith.
  const overridePrefix = `cell-override::${body.roomId}::`;
  const racePrefix = `room::${body.roomId}::cleaner::`;
  const links = await db.tasksFlowTaskLink.findMany({
    where: {
      integrationId: integration.id,
      journalDocumentId: body.documentId,
      OR: [
        { rowKey: { startsWith: overridePrefix } },
        { rowKey: { startsWith: racePrefix } },
      ],
    },
    select: { id: true, tasksflowTaskId: true, remoteStatus: true },
  });

  let client: ReturnType<typeof tasksflowClientFor>;
  try {
    client = tasksflowClientFor(integration);
  } catch (err) {
    console.error("[sync-room-photo-policy] decrypt failed", err);
    return NextResponse.json(
      { error: "Не удалось расшифровать ключ TasksFlow" },
      { status: 500 },
    );
  }

  let updated = 0;
  let skipped = 0;
  let failed = 0;
  for (const link of links) {
    // Завершённые задачи не трогаем — TF FINANCIAL_SAFETY запрещает
    // менять completed-задачи через PUT (баланс уже начислен).
    if (link.remoteStatus === "completed" || link.remoteStatus === "verified") {
      skipped += 1;
      continue;
    }
    try {
      await client.updateTask(link.tasksflowTaskId, {
        requiresPhoto: effectiveRequirePhoto,
      });
      updated += 1;
    } catch (err) {
      failed += 1;
      console.error(
        `[sync-room-photo-policy] update task=${link.tasksflowTaskId} failed`,
        err,
      );
    }
  }

  return NextResponse.json({
    ok: true,
    effectiveRequirePhoto,
    updated,
    skipped,
    failed,
    total: links.length,
  });
}
