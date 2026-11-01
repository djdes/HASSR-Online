import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyTaskFillToken } from "@/lib/task-fill-token";
import { getActiveCloseEvent, documentBuildingId, utcDayStart } from "@/lib/journal-close-events";
import { journalEntryPointWhere } from "@/lib/point-filters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/task-fill/<taskId>/status?token=...
 *
 * Возвращает мета-информацию для TasksFlow UI:
 *   - taskScope (personal | shared)
 *   - allowNoEvents, allowFreeTextReason, noEventsReasons
 *   - todaysEntryCount — сколько записей сегодня (для shared с
 *     счётчиком "N записей")
 *   - closeEvent — есть ли активное закрытие (kind, reason, closedAt)
 *   - alreadyCompleted — статус TF link
 *
 * Используется TF при открытии task'и: если shared — показать UI
 * счётчика и кнопку «Не требуется», если personal — обычный flow.
 */
export async function GET(
  request: Request,
  ctx: { params: Promise<{ taskId: string }> }
) {
  const { taskId: taskIdRaw } = await ctx.params;
  const taskId = Number(taskIdRaw);
  if (!Number.isFinite(taskId) || taskId <= 0) {
    return NextResponse.json({ errorCode: "badTaskId", error: "Bad taskId" }, { status: 400 });
  }

  const { searchParams } = new URL(request.url);
  const token = searchParams.get("token");
  if (!token) {
    return NextResponse.json({ errorCode: "missingToken", error: "token required" }, { status: 400 });
  }

  const candidates = await db.tasksFlowTaskLink.findMany({
    where: { tasksflowTaskId: taskId },
    include: { integration: true },
  });
  if (candidates.length === 0) {
    return NextResponse.json({ errorCode: "taskNotFound", error: "Task not found" }, { status: 404 });
  }
  let link: (typeof candidates)[number] | null = null;
  for (const c of candidates) {
    const v = verifyTaskFillToken(token, c.integration.webhookSecret);
    if (v.ok && v.taskId === taskId) {
      link = c;
      break;
    }
  }
  if (!link) {
    return NextResponse.json({ errorCode: "invalidToken", error: "Invalid token" }, { status: 401 });
  }

  const template = await db.journalTemplate.findFirst({
    where: { code: link.journalCode },
    select: {
      id: true,
      taskScope: true,
      allowNoEvents: true,
      noEventsReasons: true,
      allowFreeTextReason: true,
    },
  });
  if (!template) {
    return NextResponse.json({ errorCode: "templateNotFound", error: "Template not found" }, { status: 400 });
  }

  const today = new Date();
  const todayStart = utcDayStart(today);
  const todayEnd = new Date(todayStart);
  todayEnd.setUTCDate(todayEnd.getUTCDate() + 1);

  // Count today's entries для shared-task — показывается как бейдж
  // «N записей сегодня» в TF UI. Учитываем и JournalDocumentEntry и
  // JournalEntry (legacy field-based журналы тоже могут быть shared).
  // Точка документа задачи (аудит 2026-11-01): записи field-журнала других
  // точек в бейдж не попадают.
  const buildingId = await documentBuildingId(link.journalDocumentId);
  const [docEntryCount, legacyEntryCount, closeEvent] = await Promise.all([
    db.journalDocumentEntry.count({
      where: {
        documentId: link.journalDocumentId,
        date: { gte: todayStart, lt: todayEnd },
      },
    }),
    db.journalEntry.count({
      where: {
        organizationId: link.integration.organizationId,
        templateId: template.id,
        createdAt: { gte: todayStart, lt: todayEnd },
        ...journalEntryPointWhere(buildingId),
      },
    }),
    getActiveCloseEvent(link.integration.organizationId, template.id, today, buildingId),
  ]);

  const todaysEntryCount = docEntryCount + legacyEntryCount;

  return NextResponse.json({
    ok: true,
    taskScope: template.taskScope,
    allowNoEvents: template.allowNoEvents,
    allowFreeTextReason: template.allowFreeTextReason,
    noEventsReasons: Array.isArray(template.noEventsReasons)
      ? (template.noEventsReasons as unknown[]).filter(
          (r): r is string => typeof r === "string"
        )
      : [],
    todaysEntryCount,
    alreadyCompleted: link.remoteStatus === "completed",
    closeEvent: closeEvent
      ? {
          id: closeEvent.id,
          kind: closeEvent.kind,
          reason: closeEvent.reason,
          closedAt: closeEvent.createdAt,
        }
      : null,
  });
}
