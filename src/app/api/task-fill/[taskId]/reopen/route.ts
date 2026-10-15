import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { verifyTaskFillToken } from "@/lib/task-fill-token";
import { extractEmployeeId } from "@/lib/tasksflow-adapters/row-key";
import { reopenJournalForDay, documentBuildingId } from "@/lib/journal-close-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/task-fill/<taskId>/reopen
 *
 * Body: { token }
 *
 * Используется когда журнал был закрыт как «не требуется сегодня», но
 * потом случилось событие (пришла поставка после того как кладовщик
 * закрыл журнал). Сотрудник нажимает «Открыть заново» в TF — закрытие
 * аннулируется, status вернётся в active, можно добавлять записи.
 *
 * Audit trail: на JournalCloseEvent заполняется reopenedAt +
 * reopenedByUserId. Сама запись не удаляется (для истории).
 */
const bodySchema = z.object({
  token: z.string().min(10),
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

  const template = await db.journalTemplate.findFirst({
    where: { code: link.journalCode },
    select: { id: true },
  });
  if (!template) {
    return NextResponse.json({ errorCode: "templateNotFound", error: "Template not found" }, { status: 400 });
  }

  const actorId = extractEmployeeId(link.rowKey);
  if (!actorId) {
    return NextResponse.json(
      { errorCode: "employeeUnknown", error: "Не удалось определить сотрудника" },
      { status: 400 }
    );
  }

  const result = await reopenJournalForDay({
    organizationId: link.integration.organizationId,
    templateId: template.id,
    buildingId: await documentBuildingId(link.journalDocumentId),
    date: new Date(),
    reopenedByUserId: actorId,
  });

  if (!result.ok) {
    return NextResponse.json(
      { errorCode: "notClosed", error: "Журнал не был закрыт за сегодня" },
      { status: 404 }
    );
  }

  // Reactivate TF task (mark as active again).
  await db.tasksFlowTaskLink.update({
    where: { id: link.id },
    data: { remoteStatus: "active", lastDirection: "pull" },
  });

  return NextResponse.json({ ok: true, closeEventId: result.closeEventId });
}
