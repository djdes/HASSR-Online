import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { recordAuditLog } from "@/lib/audit-log";
import { verifyTaskFillToken } from "@/lib/task-fill-token";
import { extractEmployeeId } from "@/lib/tasksflow-adapters/row-key";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Шаг pipeline'а в task-fill. Каждый раз когда worker подтверждает
 * «Сделал» на шаге wizard'а — клиент дёргает этот endpoint. Пишем
 * AuditLog'ом конкретный шаг с тайм-меткой и длительностью от
 * формы-открытия. Манагер видит полный trail: «Иванов прошёл шаг
 * «Защищенность ламп» 09:34, длительность 47 сек».
 *
 * Endpoint best-effort: даже если запись провалится, основной
 * submit задачи сработает (final POST /api/task-fill/[taskId] всё
 * равно сохранит весь pipeline в JournalDocumentEntry.data).
 *
 *   POST /api/task-fill/<taskId>/step
 *   Body: { token, stepId, stepIndex, stepTitle, totalSteps, msSinceFormOpen }
 *   Returns: { ok: true }
 */
const bodySchema = z.object({
  token: z.string().min(10),
  stepId: z.string().min(1).max(100),
  stepIndex: z.number().int().min(0).max(50),
  stepTitle: z.string().min(1).max(300),
  totalSteps: z.number().int().min(1).max(50),
  msSinceFormOpen: z.number().int().min(0).max(60 * 60 * 1000).optional(),
  /**
   * URL фото-доказательства (если шаг требовал requirePhoto). Должен
   * начинаться на /uploads/ — иначе явно не наш upload.
   */
  photoUrl: z
    .string()
    .min(2)
    .max(500)
    .regex(/^\/uploads\//)
    .optional(),
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

  let parsed: z.infer<typeof bodySchema>;
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

  // HMAC verify через все candidates с тем же tasksflowTaskId — как в
  // основном route.ts. Это защищает от подделки stepId с чужого аккаунта.
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
    if (!v.ok) continue;
    if (v.taskId !== taskId) continue;
    link = c;
    break;
  }
  if (!link) {
    return NextResponse.json({ errorCode: "invalidToken", error: "Invalid token" }, { status: 401 });
  }

  // Вытащим имя сотрудника для AuditLog'а — он покажет «Иванов И.И.»
  // вместо userId. Best-effort.
  const employeeId = extractEmployeeId(link.rowKey);
  let employeeName: string | null = null;
  if (employeeId) {
    const emp = await db.user.findUnique({
      where: { id: employeeId },
      select: { name: true },
    });
    employeeName = emp?.name ?? null;
  }

  // Достаём шаблон чтобы получить journal-readable label для UI'а
  // viewer'а. Templates меняются редко, кэш можно не делать.
  const template = await db.journalTemplate.findFirst({
    where: { code: link.journalCode },
    select: { name: true },
  });

  await recordAuditLog({
    request,
    session: employeeId
      ? { user: { id: employeeId, name: employeeName } }
      : null,
    organizationId: link.integration.organizationId,
    action: "journal.fill.step",
    entity: "journal_task",
    entityId: String(taskId),
    details: {
      taskId,
      journalCode: link.journalCode,
      journalLabel: template?.name ?? link.journalCode,
      documentId: link.journalDocumentId,
      stepId: parsed.stepId,
      stepIndex: parsed.stepIndex,
      stepTitle: parsed.stepTitle,
      totalSteps: parsed.totalSteps,
      msSinceFormOpen: parsed.msSinceFormOpen ?? null,
      photoUrl: parsed.photoUrl ?? null,
    },
  });

  return NextResponse.json({ ok: true });
}
