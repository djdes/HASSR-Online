import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { verifyTaskFillToken } from "@/lib/task-fill-token";
import { extractEmployeeId } from "@/lib/tasksflow-adapters/row-key";
import { closeJournalForDay, documentBuildingId } from "@/lib/journal-close-events";
import { TasksFlowError, tasksflowClientFor } from "@/lib/tasksflow-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/task-fill/<taskId>/close-no-events
 *
 * Body: { token, kind: "no-events" | "closed-with-events", reason?: string }
 *
 * Используется кнопками «Не требуется сегодня» и «Завершить смену»
 * в TasksFlow. Создаёт JournalCloseEvent для (template, today, org)
 * и помечает TF-задачу completed.
 *
 * Reason обязателен для kind="no-events" (UI присылает либо из
 * предложенного списка noEventsReasons, либо free-text если
 * allowFreeTextReason). Для kind="closed-with-events" — опционален
 * (просто «закрыли смену с N записями»).
 *
 * Auth — HMAC-token из URL (тот же что для submit формы).
 */
const bodySchema = z.object({
  token: z.string().min(10),
  kind: z.enum(["no-events", "closed-with-events"]),
  reason: z.string().max(500).optional(),
});

export async function POST(
  request: Request,
  ctx: { params: Promise<{ taskId: string }> }
) {
  const { taskId: taskIdRaw } = await ctx.params;
  const taskId = Number(taskIdRaw);
  if (!Number.isFinite(taskId) || taskId <= 0) {
    return NextResponse.json({ errorCode: "badTaskId", error: "Bad taskId" }, { status: 400 });
  }

  let parsed;
  try {
    parsed = bodySchema.parse(await request.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { errorCode: "invalidBody", error: err.issues[0]?.message ?? "Invalid body" },
        { status: 400 }
      );
    }
    return NextResponse.json({ errorCode: "invalidBody", error: "Invalid body" }, { status: 400 });
  }

  // Resolve link by HMAC signature
  const candidates = await db.tasksFlowTaskLink.findMany({
    where: { tasksflowTaskId: taskId },
    include: { integration: true },
  });
  if (candidates.length === 0) {
    return NextResponse.json({ errorCode: "taskNotFound", error: "Task not found" }, { status: 404 });
  }
  let link: (typeof candidates)[number] | null = null;
  for (const c of candidates) {
    const v = verifyTaskFillToken(parsed.token, c.integration.webhookSecret);
    if (v.ok && v.taskId === taskId) {
      link = c;
      break;
    }
  }
  if (!link) {
    return NextResponse.json({ errorCode: "invalidToken", error: "Invalid token" }, { status: 401 });
  }

  // Resolve template + permission to close-no-events
  const template = await db.journalTemplate.findFirst({
    where: { code: link.journalCode },
    select: {
      id: true,
      allowNoEvents: true,
      noEventsReasons: true,
      allowFreeTextReason: true,
    },
  });
  if (!template) {
    return NextResponse.json(
      { errorCode: "templateNotFound", error: `Шаблон «${link.journalCode}» не найден` },
      { status: 400 }
    );
  }

  // For "no-events" — verify reason is allowed (либо из списка, либо
  // если allowFreeTextReason разрешён — любой текст).
  if (parsed.kind === "no-events") {
    if (!template.allowNoEvents) {
      return NextResponse.json(
        { errorCode: "noEventsDisabled", error: "Для этого журнала нельзя нажать «Не требуется сегодня»" },
        { status: 403 }
      );
    }
    if (!parsed.reason || parsed.reason.trim() === "") {
      return NextResponse.json(
        { errorCode: "reasonRequired", error: "Укажите причину" },
        { status: 400 }
      );
    }
    const allowedReasons = Array.isArray(template.noEventsReasons)
      ? (template.noEventsReasons as unknown[]).filter(
          (r): r is string => typeof r === "string"
        )
      : [];
    if (
      !template.allowFreeTextReason &&
      !allowedReasons.includes(parsed.reason)
    ) {
      return NextResponse.json(
        {
          errorCode: "reasonNotAllowed", error:
            "Свободный текст причины не разрешён. Выберите из готового списка.",
        },
        { status: 400 }
      );
    }
  }

  // Resolve actor (rowKey owner) to attribute the close event.
  const actorId = extractEmployeeId(link.rowKey);

  const result = await closeJournalForDay({
    organizationId: link.integration.organizationId,
    templateId: template.id,
    journalDocumentId: link.journalDocumentId,
    buildingId: await documentBuildingId(link.journalDocumentId),
    date: new Date(),
    kind: parsed.kind,
    reason: parsed.reason ?? null,
    closedByUserId: actorId ?? null,
  });

  if (!result.ok) {
    return NextResponse.json(
      {
        errorCode: "alreadyClosed", error:
          "Журнал уже закрыт за сегодня. Если случилось событие — переоткройте.",
      },
      { status: 409 }
    );
  }

  // Mark TF task completed (best-effort, non-fatal on error).
  const client = tasksflowClientFor(link.integration);
  await client.completeTask(taskId).catch((err) => {
    if (!(err instanceof TasksFlowError)) throw err;
    console.warn(
      "[close-no-events] completeTask non-fatal",
      err.status,
      err.message
    );
  });

  await db.tasksFlowTaskLink.update({
    where: { id: link.id },
    data: {
      remoteStatus: "completed",
      completedAt: new Date(),
      lastDirection: "pull",
    },
  });

  return NextResponse.json({
    ok: true,
    closeEvent: result.closeEvent,
  });
}
