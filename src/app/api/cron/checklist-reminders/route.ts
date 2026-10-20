import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { checkCronSecret } from "@/lib/cron-auth";
import { NOT_DIRECTORY_ORG_WHERE } from "@/lib/master-directory";
import { buildMiniAppUrl, getMiniAppBaseUrlFromEnv } from "@/lib/journal-obligation-links";
import { checklistReminderMessage, formatMinutes, localClock, reminderPlan } from "@/lib/checklist-assignments";
import {
  completedDayKeysByAssignment,
  loadAssignmentContext,
  recipientsOf,
  scheduleOf,
  type AssignmentContext,
} from "@/lib/checklist-assignments.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Напоминания о назначенных чек-листах в Telegram («Чек-листы → Назначение»,
 * 2026-10-19). Без TasksFlow: ни задач, ни вызовов TF API.
 *
 * В день срока каждому получателю с привязанным Telegram — одно напоминание на
 * период (за 2 часа до срока; если крон опоздал — в тот же день после срока),
 * с кнопкой «Открыть чек-лист» в Mini App. Выполненным не напоминаем. Повтор
 * вызова не дублирует: период «занимается» в `lastReminderPeriodKey`
 * условным обновлением до отправки.
 *
 * Расписание: каждый час. Crontab сервера живёт по Москве (как соседние задачи):
 *   0 * * * * curl -s -m 120 -H "Authorization: Bearer <CRON_SECRET>" http://127.0.0.1:3002/api/cron/checklist-reminders
 *
 * `?dryRun=1` — ничего не отправлять и не отмечать, только показать, кому ушло бы.
 */
async function handle(request: Request) {
  const cronAuth = checkCronSecret(request);
  if (cronAuth) return cronAuth;

  try {
    const dryRun = new URL(request.url).searchParams.get("dryRun") === "1";
    const now = new Date();
    const assignments = await db.checklistAssignment.findMany({
      where: {
        active: true,
        remindTelegram: true,
        template: { archived: false },
        organization: NOT_DIRECTORY_ORG_WHERE,
      },
      include: { template: { select: { title: true } } },
    });

    const contexts = new Map<string, AssignmentContext>();
    const miniBase = getMiniAppBaseUrlFromEnv();
    const planned: {
      assignmentId: string;
      organizationId: string;
      template: string;
      periodKey: string;
      dueTime: string;
      overdue: boolean;
      recipients: { userId: string; name: string }[];
      withoutTelegram: number;
    }[] = [];
    let sent = 0;
    let claimedPeriods = 0;
    let recipientsTotal = 0;
    let skippedClaimed = 0;

    for (const assignment of assignments) {
      try {
        let context = contexts.get(assignment.organizationId);
        if (!context) {
          context = await loadAssignmentContext(assignment.organizationId);
          contexts.set(assignment.organizationId, context);
        }
        const recipients = recipientsOf(assignment, context);
        const done = await completedDayKeysByAssignment([assignment], context.timeZone, now);
        const plan = reminderPlan({
          assignment: {
            active: assignment.active,
            remindTelegram: assignment.remindTelegram,
            lastReminderPeriodKey: assignment.lastReminderPeriodKey,
            schedule: scheduleOf(assignment),
            startedAt: localClock(assignment.createdAt, context.timeZone),
          },
          clock: localClock(now, context.timeZone),
          completedDayKeys: done.get(assignment.id) ?? [],
          recipients,
        });
        if (!plan) continue;
        const names = new Map(recipients.map((person) => [person.id, person.name]));
        planned.push({
          assignmentId: assignment.id,
          organizationId: assignment.organizationId,
          template: assignment.template.title,
          periodKey: plan.periodKey,
          dueTime: formatMinutes(plan.dueMinutes),
          overdue: plan.overdue,
          recipients: plan.send.map((item) => ({ userId: item.userId, name: names.get(item.userId) ?? "" })),
          withoutTelegram: recipients.length - plan.send.length,
        });
        if (dryRun) continue;

        // Занимаем период до отправки: параллельный или повторный вызов не дублирует.
        const claimed = await db.checklistAssignment.updateMany({
          where: {
            id: assignment.id,
            OR: [{ lastReminderPeriodKey: null }, { lastReminderPeriodKey: { not: plan.periodKey } }],
          },
          data: { lastReminderPeriodKey: plan.periodKey, lastRemindedAt: now },
        });
        if (claimed.count === 0) {
          skippedClaimed += 1;
          continue;
        }
        claimedPeriods += 1;
        recipientsTotal += plan.send.length;
        if (plan.send.length === 0) continue;

        const { sendTelegramMessage } = await import("@/lib/telegram");
        const url = buildMiniAppUrl(miniBase, `/checklists/templates?assignment=${assignment.id}`);
        const html = checklistReminderMessage({
          templateTitle: assignment.template.title,
          dueTime: assignment.dueTime,
          overdue: plan.overdue,
        });
        const results = await Promise.allSettled(
          plan.send.map((item) =>
            sendTelegramMessage(item.chatId, html, {
              userId: item.userId,
              ...(url ? { reply_markup: { inline_keyboard: [[{ text: "Открыть чек-лист", web_app: { url } }]] } } : {}),
              delivery: {
                organizationId: assignment.organizationId,
                kind: "checklist_reminder",
                dedupeKey: `checklist:${assignment.id}:${plan.periodKey}:${item.userId}`,
              },
            }),
          ),
        );
        sent += results.filter((result) => result.status === "fulfilled" && result.value).length;
      } catch (error) {
        console.error(`[cron/checklist-reminders] assignment ${assignment.id}`, error);
      }
    }

    return NextResponse.json(
      dryRun
        ? { dryRun: true, assignments: assignments.length, reminders: planned }
        : {
            assignments: assignments.length,
            periods: claimedPeriods,
            recipients: recipientsTotal,
            sent,
            skippedClaimed,
          },
    );
  } catch (error) {
    console.error("[cron/checklist-reminders]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
