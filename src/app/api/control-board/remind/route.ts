import { NextResponse } from "next/server";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { getServerSession } from "@/lib/server-session";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { hasCapability } from "@/lib/permission-presets";
import { notifyEmployee } from "@/lib/telegram";
import { orgDayStartInstant } from "@/lib/timezone";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/control-board/remind
 *
 *   body: { userIds?: string[], message?: string, scopeLabel?: string }
 *
 * Заведующая отправляет Telegram-напоминание сотрудникам:
 *   - userIds=[id1, id2, ...] — точечно
 *   - userIds опущен — всем своим subordinates без active claim сегодня
 *
 * Если задан scopeLabel — кастомное сообщение «не забудь {scopeLabel}».
 * Иначе общее «начни смену, возьми задачи».
 */
const bodySchema = z.object({
  userIds: z.array(z.string()).optional(),
  message: z.string().max(500).optional(),
  scopeLabel: z.string().optional(),
});

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  if (
    !hasCapability(session.user, "tasks.verify") &&
    !hasCapability(session.user, "admin.full")
  ) {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Невалидный запрос" }, { status: 400 });
  }

  const organizationId = getActiveOrgId(session);
  const myUserId = session.user.id;

  async function allActiveUserIds(): Promise<Set<string>> {
    const all = await db.user.findMany({
      where: { organizationId, isActive: true, archivedAt: null },
      select: { id: true },
    });
    return new Set(all.map((u) => u.id));
  }

  // Кому можно напомнить — по «Иерархии управления» (ManagerScope).
  let allowedIds: Set<string>;
  if (hasCapability(session.user, "admin.full")) {
    allowedIds = await allActiveUserIds();
  } else {
    const scope = await db.managerScope.findFirst({
      where: { organizationId, managerId: myUserId },
    });
    if (!scope) {
      // Правила иерархии вообще не заводили. Везде в коде это значит
      // «видит всю организацию» (см. `filterSubordinates` и
      // `canAssignJournal` в `lib/manager-scope.ts`), и только здесь
      // раньше стояло 403 «Нет scope»: у заведующей не работали
      // «Тыкнуть» и «Напомнить всем» — главные кнопки её экрана.
      allowedIds = await allActiveUserIds();
    } else if (scope.viewMode === "all") {
      allowedIds = await allActiveUserIds();
    } else if (scope.viewMode === "specific_users") {
      allowedIds = new Set(scope.viewUserIds);
    } else if (scope.viewMode === "job_positions") {
      const u = await db.user.findMany({
        where: {
          organizationId,
          jobPositionId: { in: scope.viewJobPositionIds },
        },
        select: { id: true },
      });
      allowedIds = new Set(u.map((x) => x.id));
    } else {
      allowedIds = new Set();
    }
  }

  let targetUserIds: string[];
  // Почему никому не отправили. Интерфейс раньше показывал «Напоминание
  // отправлено» даже когда отправлять было некому — человек думал, что
  // сотрудника уже тыкнули.
  let reason: RemindReason | null = null;

  if (body.userIds && body.userIds.length > 0) {
    const inScope = body.userIds.filter((id) => allowedIds.has(id));
    if (inScope.length === 0) {
      targetUserIds = [];
      reason = "out_of_scope";
    } else {
      // Без Telegram отправлять некуда — это не ошибка, но и не успех.
      const reachable = await db.user.findMany({
        where: {
          id: { in: inScope },
          telegramChatId: { not: null },
          isActive: true,
          archivedAt: null,
        },
        select: { id: true },
      });
      targetUserIds = reachable.map((u) => u.id);
      if (targetUserIds.length === 0) reason = "no_telegram";
    }
  } else {
    // Default: все subordinates с TG, у которых нет active claim сегодня.
    // «Сегодня» — по часовому поясу организации: от UTC-полуночи в Москве
    // ночью напоминание летело тем, кто уже отметился после 00:00.
    const organization = await db.organization.findUnique({
      where: { id: organizationId },
      select: { timezone: true },
    });
    const today = orgDayStartInstant(organization?.timezone ?? undefined);
    const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);

    const activeClaimUserIds = await db.journalTaskClaim.findMany({
      where: {
        organizationId,
        status: "active",
        userId: { in: [...allowedIds] },
      },
      select: { userId: true },
    });
    const completedTodayUserIds = await db.journalTaskClaim.findMany({
      where: {
        organizationId,
        status: "completed",
        userId: { in: [...allowedIds] },
        completedAt: { gte: today, lt: tomorrow },
      },
      select: { userId: true },
    });
    const busy = new Set([
      ...activeClaimUserIds.map((c) => c.userId),
      ...completedTodayUserIds.map((c) => c.userId),
    ]);
    const idle = await db.user.findMany({
      where: {
        id: { in: [...allowedIds] },
        telegramChatId: { not: null },
        isActive: true,
        archivedAt: null,
      },
      select: { id: true },
    });
    targetUserIds = idle.map((u) => u.id).filter((id) => !busy.has(id));
    if (targetUserIds.length === 0) {
      reason =
        allowedIds.size === 0
          ? "no_subordinates"
          : idle.length === 0
            ? "no_telegram_all"
            : "all_busy";
    }
  }

  const text =
    body.message?.trim() ||
    (body.scopeLabel
      ? `📌 Напоминание: <b>${escape(body.scopeLabel)}</b> — нужно выполнить.`
      : `🔔 Заведующая просит начать смену — открой Wesetup и возьми задачи.`);

  let sent = 0;
  let failed = 0;
  for (const id of targetUserIds) {
    try {
      await notifyEmployee(id, text);
      sent += 1;
    } catch {
      failed += 1;
    }
  }

  if (sent === 0 && failed > 0) reason = "send_failed";

  return NextResponse.json({
    sent,
    failed,
    total: targetUserIds.length,
    reason,
    // Текст сразу готовый: интерфейсу не нужно знать наши коды, а
    // человеку нельзя показывать ни «scope», ни «0 из 0».
    reasonText: reason ? REMIND_REASON_TEXT[reason] : null,
  });
}

/** Почему напоминание никому не ушло. */
type RemindReason =
  | "out_of_scope"
  | "no_telegram"
  | "no_telegram_all"
  | "no_subordinates"
  | "all_busy"
  | "send_failed";

const REMIND_REASON_TEXT: Record<RemindReason, string> = {
  out_of_scope:
    "Этот сотрудник не в вашей зоне ответственности. Попросите управляющего добавить его в разделе «Иерархия управления».",
  no_telegram:
    "У сотрудника не подключён Telegram — напоминание отправить некуда.",
  no_telegram_all:
    "Ни у кого из сотрудников не подключён Telegram — напоминания отправлять некуда.",
  no_subordinates:
    "Вам не назначены сотрудники для контроля. Попросите управляющего настроить это в разделе «Иерархия управления».",
  all_busy: "Напоминать некому: все уже взяли задачи или отметились сегодня.",
  send_failed:
    "Telegram не принял сообщение. Попробуйте ещё раз через пару минут.",
};

function escape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
