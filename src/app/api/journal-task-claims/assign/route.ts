import { NextResponse } from "next/server";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { getServerSession } from "@/lib/server-session";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { hasCapability } from "@/lib/permission-presets";
import { claimJournalTask } from "@/lib/journal-task-claims";
import { mirrorClaimToTasksFlow } from "@/lib/tasksflow-claim-mirror";
import { notifyEmployee } from "@/lib/telegram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/journal-task-claims/assign
 *
 *   body: { journalCode, scopeKey, scopeLabel, dateKey, userId, parentHint?, message? }
 *
 * Admin (или TasksFlow-интеграция от имени admin'а) принудительно
 * назначает задачу конкретному сотруднику. Это создаёт
 * JournalTaskClaim status=active от его имени и шлёт ему TG-уведомление
 * «вам поручена задача X». Также видно у заведующей в /verifications
 * как in_progress сразу.
 *
 * One-active-task rule обходится — admin может назначить даже если у
 * сотрудника уже есть active claim (bypassActiveCheck=true).
 *
 * Доступ: admin.full.
 */
const bodySchema = z.object({
  journalCode: z.string().min(1),
  scopeKey: z.string().min(1),
  scopeLabel: z.string().min(1),
  dateKey: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  userId: z.string().min(1),
  parentHint: z.string().nullish(),
  message: z.string().max(500).optional(),
});

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }
  if (!hasCapability(session.user, "admin.full")) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Невалидный запрос" }, { status: 400 });
  }

  const organizationId = getActiveOrgId(session);

  // Проверка что user существует в org.
  const target = await db.user.findUnique({
    where: { id: body.userId },
    select: { organizationId: true, name: true, telegramChatId: true },
  });
  if (!target || target.organizationId !== organizationId) {
    return NextResponse.json({ error: "Сотрудник не найден" }, { status: 404 });
  }

  const dateKey = new Date(`${body.dateKey}T00:00:00.000Z`);
  if (!Number.isFinite(dateKey.getTime())) {
    return NextResponse.json({ error: "Некорректная дата" }, { status: 400 });
  }
  const result = await claimJournalTask({
    organizationId,
    journalCode: body.journalCode,
    scopeKey: body.scopeKey,
    scopeLabel: body.scopeLabel,
    dateKey,
    userId: body.userId,
    parentHint: body.parentHint ?? null,
    bypassActiveCheck: true,
  });

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, reason: result.reason },
      { status: 409 }
    );
  }

  // TG mirror в TasksFlow (если applicable).
  void mirrorClaimToTasksFlow({
    organizationId,
    journalCode: body.journalCode,
    scopeKey: body.scopeKey,
    userId: body.userId,
    event: "claim",
  })
    .then(async (m) => {
      if (m.tasksFlowTaskId) {
        await db.journalTaskClaim
          .update({
            where: { id: result.claim.id },
            data: { tasksFlowTaskId: String(m.tasksFlowTaskId) },
          })
          .catch(() => null);
      }
    })
    .catch(() => null);

  // TG-уведомление сотруднику.
  if (target.telegramChatId) {
    const text =
      body.message?.trim() ||
      `📌 Вам назначена новая задача: <b>${escape(body.scopeLabel)}</b>\n\nОткрой /start в боте чтобы выполнить.`;
    await notifyEmployee(body.userId, text).catch(() => null);
  }

  return NextResponse.json({ ok: true, claim: result.claim });
}

function escape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
