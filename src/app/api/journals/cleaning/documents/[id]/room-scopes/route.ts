import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getActiveOrgId, requireApiAuth } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { recordAuditLog } from "@/lib/audit-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/journals/cleaning/documents/[id]/room-scopes
 *
 * Sync строк из room-edit dialog (`currentScope[]` / `generalScope[]`)
 * в `JournalChecklistItem` записи. Эти items потом подгружаются в
 * TasksFlow task-fill flow как чек-лист подзадач (см.
 * /api/task-fill/[taskId]/checklist).
 *
 * Семантика:
 *   • Удаляем (soft-archive) existing items с category="current" или
 *     "general" для этой (org, journalCode='cleaning', roomId).
 *   • Создаём новые items по строкам, sortOrder из array index.
 *   • Items без category (legacy/manually managed через
 *     /settings/journal-checklists) НЕ трогаем.
 *
 * Body: { roomId: string, currentScope: string[], generalScope: string[] }
 */

const Body = z.object({
  roomId: z.string().min(1),
  currentScope: z.array(z.string()).default([]),
  generalScope: z.array(z.string()).default([]),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;
  if (!hasFullWorkspaceAccess(auth.session.user)) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }
  const { id: documentId } = await params;
  const organizationId = getActiveOrgId(auth.session);

  // Проверяем что документ принадлежит этой орге и это cleaning.
  const doc = await db.journalDocument.findFirst({
    where: { id: documentId, organizationId },
    select: { id: true, template: { select: { code: true } } },
  });
  if (!doc) {
    return NextResponse.json({ error: "Документ не найден" }, { status: 404 });
  }
  if (doc.template.code !== "cleaning") {
    return NextResponse.json(
      { error: "Sync доступен только для журнала уборки" },
      { status: 400 },
    );
  }

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await request.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: err.issues[0]?.message ?? "Некорректные данные" },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: "Некорректные данные" }, { status: 400 });
  }

  const cleanLines = (lines: string[]): string[] =>
    lines
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .slice(0, 50); // safety cap

  const current = cleanLines(body.currentScope);
  const general = cleanLines(body.generalScope);

  // Cleaning unification 2026-05-08: используем общий helper.
  // Этот endpoint теперь — backwards-compat shim для старых клиентов;
  // новый канонический путь — PATCH /api/settings/rooms/[id] с
  // currentScope/generalScope (через RoomEditor).
  const { syncRoomChecklistItems } = await import(
    "@/lib/cleaning-room-checklist-sync"
  );
  await syncRoomChecklistItems({
    organizationId,
    roomId: body.roomId,
    currentScope: current,
    generalScope: general,
    createdByUserId: auth.session.user.id,
  });

  await recordAuditLog({
    request,
    session: auth.session,
    organizationId,
    action: "cleaning.room_scopes.sync",
    entity: "JournalChecklistItem",
    entityId: body.roomId,
    details: {
      documentId,
      roomId: body.roomId,
      currentCount: current.length,
      generalCount: general.length,
    },
  });

  return NextResponse.json({
    ok: true,
    currentCount: current.length,
    generalCount: general.length,
  });
}
