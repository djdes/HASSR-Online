import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { checkCronSecret } from "@/lib/cron-auth";
import { NOT_AUTO_SEEDED } from "@/lib/journal-entry-filters";
import {
  notifyEmployee,
  notifyOrganization,
  escapeTelegramHtml as esc,
} from "@/lib/telegram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET/POST /api/cron/shift-watcher?secret=$CRON_SECRET
 *
 * Каждые 30 минут (рекомендуется 06:00-22:00 MSK) проверяет
 * запланированные смены сегодня — если сотрудник числится в
 * `WorkShift.status="scheduled"`, но за «час окончания вчерашней
 * смены» не сделал ни одной записи в журналах, эскалирует:
 *   - 30 мин без активности → push руководству «Иван на смене?»;
 *   - 2 ч без активности → status="absent" + повторный push;
 *   - 4 ч без активности (но не absent) → friendly DM самому
 *     сотруднику: «{greeting}, {name}! Всё ок? Журналы пустые».
 *     Цель — не давление, а напоминание для тех, кто реально на
 *     смене, но забыл заполнить.
 *
 * Дедупликация — через `AuditLog` с `entity="work_shift"`,
 * `entityId=shift.id`, action ∈ {`shift_watcher.notify_30`,
 * `shift_watcher.mark_absent`, `shift_watcher.staff_check_in_240`}.
 * Повторно не пингуем ту же смену на ту же стадию.
 *
 * INFRA NEXT: настроить cron на cron-job.org каждые 30 мин,
 * 06:00-22:00 MSK, на /api/cron/shift-watcher.
 */
async function handle(request: Request) {
  const cronAuth = checkCronSecret(request);
  if (cronAuth) return cronAuth;
  const now = new Date();
  const currentDayStart = new Date(now);
  currentDayStart.setUTCHours(0, 0, 0, 0);

  // 1. Все смены сегодня в статусе "scheduled".
  const shifts = await db.workShift.findMany({
    where: {
      date: currentDayStart,
      status: "scheduled",
    },
    select: {
      id: true,
      organizationId: true,
      userId: true,
      date: true,
      user: {
        select: {
          name: true,
          isActive: true,
          archivedAt: true,
        },
      },
    },
  });

  if (shifts.length === 0) {
    return NextResponse.json({
      ok: true,
      shiftsChecked: 0,
      notified: 0,
      markedAbsent: 0,
    });
  }

  let notified = 0;
  let markedAbsent = 0;
  let staffCheckIns = 0;

  for (const shift of shifts) {
    if (!shift.user.isActive || shift.user.archivedAt) continue;

    // Активность с начала суток.
    const [fieldEntry, docEntry] = await Promise.all([
      db.journalEntry.findFirst({
        where: {
          organizationId: shift.organizationId,
          filledById: shift.userId,
          createdAt: { gte: currentDayStart },
        },
        select: { id: true },
      }),
      db.journalDocumentEntry.findFirst({
        where: {
          employeeId: shift.userId,
          createdAt: { gte: currentDayStart },
          document: { organizationId: shift.organizationId },
          // Игнорируем _autoSeeded плейсхолдеры — bulk-assign сегодня
          // мог создать seeded-rows для этого юзера, но это не значит
          // что он реально работает. Иначе shift-watcher не пошлёт
          // реминд «начни смену» когда сотрудник ещё не начал.
          ...NOT_AUTO_SEEDED,
        },
        select: { id: true },
      }),
    ]);
    const hasActivity = Boolean(fieldEntry || docEntry);
    if (hasActivity) continue;

    // Сколько часов прошло с начала суток (proxy для "от старта смены").
    // Точное startTime у WorkShift не хранится — приближаем «начало
    // смены» = 9:00 локального времени (UTC+3 для РФ) = 06:00 UTC.
    // Если cron дёрнут до 06:00 UTC — пропускаем, ещё не смена.
    const SHIFT_START_HOUR_UTC = 6;
    const shiftStartedAt = new Date(currentDayStart);
    shiftStartedAt.setUTCHours(SHIFT_START_HOUR_UTC, 0, 0, 0);
    if (now < shiftStartedAt) continue;

    const minutesSinceStart = Math.floor(
      (now.getTime() - shiftStartedAt.getTime()) / (60 * 1000)
    );

    // Достаём существующие пинги для этой смены.
    const existingNotifications = await db.auditLog.findMany({
      where: {
        organizationId: shift.organizationId,
        entity: "work_shift",
        entityId: shift.id,
        action: {
          in: [
            "shift_watcher.notify_30",
            "shift_watcher.mark_absent",
            "shift_watcher.staff_check_in_240",
          ],
        },
      },
      select: { action: true },
    });
    const alreadyNotified = existingNotifications.some(
      (l) => l.action === "shift_watcher.notify_30"
    );
    const alreadyMarkedAbsent = existingNotifications.some(
      (l) => l.action === "shift_watcher.mark_absent"
    );
    const alreadyStaffCheckedIn = existingNotifications.some(
      (l) => l.action === "shift_watcher.staff_check_in_240"
    );

    // Stage 2: 2+ часа без активности → mark absent.
    if (minutesSinceStart >= 120 && !alreadyMarkedAbsent) {
      await db.workShift.update({
        where: { id: shift.id },
        data: { status: "absent" },
      });
      await db.auditLog.create({
        data: {
          organizationId: shift.organizationId,
          action: "shift_watcher.mark_absent",
          entity: "work_shift",
          entityId: shift.id,
          details: {
            userId: shift.userId,
            userName: shift.user.name,
            minutesSinceStart,
          },
        },
      });
      const message =
        `🚨 <b>Сотрудник не вышел на смену?</b>\n\n` +
        `${esc(shift.user.name)} числится сегодня на смене, но за ` +
        `${Math.floor(minutesSinceStart / 60)} ч не заполнил ни одного ` +
        `журнала. Статус смены автоматически переведён на «absent». ` +
        `Если это ошибка — поправьте в графике.`;
      await notifyOrganization(shift.organizationId, message, ["owner"]);
      markedAbsent += 1;
      continue;
    }

    // Stage 3: 4+ часа без активности → friendly DM самому
    // сотруднику. Это не давление, а тихая подсказка тем, кто
    // реально работает, но забыл открыть журнал. Только один раз
    // за смену — повторно не пингуем.
    //
    // Раньше здесь стояло `&& !alreadyMarkedAbsent`. Из-за этого
    // Stage 3 был unreachable: Stage 2 на тике 120мин всегда
    // помечает absent + `continue`, а на следующем тике
    // `!alreadyMarkedAbsent` уже false → DM не уходит никогда.
    // Гейт убрали: даже отмеченному absent сотруднику отправим
    // одно вежливое сообщение «всё ок?» (telegram-уведомление,
    // если он реально работает — заполнит и статус автоматически
    // не вернётся, но руководство хотя бы будет знать что человек
    // на связи).
    if (minutesSinceStart >= 240 && !alreadyStaffCheckedIn) {
      await db.auditLog.create({
        data: {
          organizationId: shift.organizationId,
          action: "shift_watcher.staff_check_in_240",
          entity: "work_shift",
          entityId: shift.id,
          details: {
            userId: shift.userId,
            userName: shift.user.name,
            minutesSinceStart,
          },
        },
      });
      // {greeting} и {name} разворачивает personalizeMessage в
      // notifyEmployee — сотрудник увидит свой язык приветствия по
      // времени дня + своё имя.
      const message =
        `{greeting}, {name}! 👋\n\n` +
        `Сегодня вы числитесь на смене, но в журналах пока пусто. ` +
        `Если уже работаете — заполните хотя бы первое наблюдение, ` +
        `чтобы руководство видело активность. Если что-то не так — ` +
        `напишите менеджеру.`;
      await notifyEmployee(shift.userId, message, undefined, {
        // Это soft-pings, не critical alert — даём «Отложить 1ч».
        addSnoozeButton: true,
      });
      staffCheckIns += 1;
    }

    // Stage 1: 30+ минут без активности → soft-ping управление.
    if (minutesSinceStart >= 30 && !alreadyNotified) {
      await db.auditLog.create({
        data: {
          organizationId: shift.organizationId,
          action: "shift_watcher.notify_30",
          entity: "work_shift",
          entityId: shift.id,
          details: {
            userId: shift.userId,
            userName: shift.user.name,
            minutesSinceStart,
          },
        },
      });
      const message =
        `🟡 <b>${esc(shift.user.name)} на смене?</b>\n\n` +
        `Прошло ${minutesSinceStart} мин с начала смены, но он/она ` +
        `ещё не заполнил ни одного журнала. Возможно опаздывает или ` +
        `не отметился — проверьте.`;
      await notifyOrganization(shift.organizationId, message, ["owner"]);
      notified += 1;
    }
  }

  return NextResponse.json({
    ok: true,
    shiftsChecked: shifts.length,
    notified,
    markedAbsent,
    staffCheckIns,
  });
}

export const GET = handle;
export const POST = handle;
