import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { getServerSession } from "@/lib/server-session";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { getUserRoleLabel } from "@/lib/user-roles";
import { hasCapability, effectivePreset } from "@/lib/permission-presets";
import { orgDayStartInstant } from "@/lib/timezone";
import { loadStaffAbsenceForDay } from "@/lib/staff-absence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/team — список «моих сотрудников» для заведующей.
 *
 * Использует ManagerScope:
 *   viewMode="all" — все active сотрудники организации
 *   viewMode="specific_users" — только из viewUserIds
 *   viewMode="job_positions" — все из viewJobPositionIds
 *   viewMode="none" — никого
 *
 * Для admin'а — возвращает всю команду. Заведующая видит scoped
 * subordinates. Остальным — 403.
 *
 * Per-сотрудник возвращает:
 *   - текущий active claim (если есть) → "В работе"
 *   - completed today count
 *   - WorkShift на сегодня (status: scheduled|off|vacation|sick|null)
 *   - StaffVacation / StaffSickLeave / StaffWorkOffDay в активном
 *     диапазоне
 *   - lastSeenAt (последний claim/complete)
 *
 * Используется UI «Моя команда» для заведующей: видно кто работает
 * прямо сейчас, кто закончил, кто ещё не начал.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }
  if (
    !hasCapability(session.user, "staff.view") &&
    !hasCapability(session.user, "tasks.verify") &&
    !hasCapability(session.user, "admin.full")
  ) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }

  const organizationId = getActiveOrgId(session);
  const myUserId = session.user.id;
  const isAdmin = hasCapability(session.user, "admin.full");

  // Resolve scope.
  let allowedUserIds: string[] | null = null; // null = все active в org
  let viewMode = "all";
  if (!isAdmin) {
    const scope = await db.managerScope.findFirst({
      where: { organizationId, managerId: myUserId },
    });
    if (scope) {
      viewMode = scope.viewMode;
      if (scope.viewMode === "none") {
        return NextResponse.json({
          viewMode,
          team: [],
        });
      }
      if (scope.viewMode === "specific_users") {
        allowedUserIds = scope.viewUserIds;
      } else if (scope.viewMode === "job_positions") {
        const usersByPos = await db.user.findMany({
          where: {
            organizationId,
            jobPositionId: { in: scope.viewJobPositionIds },
            isActive: true,
            archivedAt: null,
          },
          select: { id: true },
        });
        allowedUserIds = usersByPos.map((u) => u.id);
      }
      // "all" → null
    }
    // Если у заведующей нет ManagerScope — показываем всех её org'и (default).
  }

  const users = await db.user.findMany({
    where: {
      organizationId,
      isActive: true,
      archivedAt: null,
      ...(allowedUserIds ? { id: { in: allowedUserIds } } : {}),
      // Не показываем самого себя в team-list.
      NOT: { id: myUserId },
    },
    select: {
      id: true,
      name: true,
      role: true,
      permissionPreset: true,
      positionTitle: true,
      jobPosition: { select: { name: true } },
      telegramChatId: true,
    },
    orderBy: { name: "asc" },
  });

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  // Для сравнения с реальными метками времени (`completedAt`) нужна
  // местная полночь организации: от UTC-полуночи в Москве ночью в
  // «сегодня» попадал вчерашний вечер. Ключ смены (`WorkShift.date`)
  // остаётся UTC-полуночью — так он и хранится.
  const organization = await db.organization.findUnique({
    where: { id: organizationId },
    select: { timezone: true },
  });
  const dayStart = orgDayStartInstant(organization?.timezone ?? undefined);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

  const userIds = users.map((u) => u.id);

  const [activeClaims, completedToday, shifts, sickLeaves, vacations, offDays] =
    await Promise.all([
      db.journalTaskClaim.findMany({
        where: { organizationId, userId: { in: userIds }, status: "active" },
        select: {
          userId: true,
          scopeLabel: true,
          claimedAt: true,
          journalCode: true,
        },
      }),
      db.journalTaskClaim.findMany({
        where: {
          organizationId,
          userId: { in: userIds },
          status: "completed",
          completedAt: { gte: dayStart, lt: dayEnd },
        },
        select: {
          userId: true,
          completedAt: true,
        },
      }),
      db.workShift.findMany({
        where: { organizationId, userId: { in: userIds }, date: today },
        select: {
          userId: true,
          status: true,
          handoverAt: true,
          handoverNotes: true,
        },
      }),
      db.staffSickLeave.findMany({
        where: {
          userId: { in: userIds },
          dateFrom: { lte: today },
          dateTo: { gte: today },
        },
        select: { userId: true, dateFrom: true, dateTo: true },
      }),
      db.staffVacation.findMany({
        where: {
          userId: { in: userIds },
          dateFrom: { lte: today },
          dateTo: { gte: today },
        },
        select: { userId: true, dateFrom: true, dateTo: true },
      }),
      db.staffWorkOffDay.findMany({
        where: {
          userId: { in: userIds },
          date: today,
        },
        select: { userId: true, date: true },
      }),
    ]);

  // Постоянные выходные (`User.weeklyDaysOff`) жили только в
  // автозаполнении гигиены: в «Моей команде» человек в свой законный
  // выходной висел «ещё не начал». Берём тот же помощник.
  const absenceByUser = await loadStaffAbsenceForDay(db, {
    organizationId,
    employeeIds: userIds,
    dateKey: today.toISOString().slice(0, 10),
  });

  const activeByUser = new Map<string, (typeof activeClaims)[number]>();
  for (const c of activeClaims) activeByUser.set(c.userId, c);
  const doneCountByUser = new Map<string, number>();
  for (const c of completedToday) {
    doneCountByUser.set(c.userId, (doneCountByUser.get(c.userId) ?? 0) + 1);
  }
  const shiftByUser = new Map<string, (typeof shifts)[number]>();
  for (const s of shifts) shiftByUser.set(s.userId, s);
  const sickByUser = new Map<string, (typeof sickLeaves)[number]>();
  for (const s of sickLeaves) sickByUser.set(s.userId, s);
  const vacByUser = new Map<string, (typeof vacations)[number]>();
  for (const v of vacations) vacByUser.set(v.userId, v);
  const offByUser = new Map<string, (typeof offDays)[number]>();
  for (const o of offDays) offByUser.set(o.userId, o);

  // Last seen — из самого свежего claim'а (active или completed).
  const lastSeenByUser = new Map<string, Date>();
  for (const c of activeClaims) {
    const cur = lastSeenByUser.get(c.userId);
    if (!cur || cur < c.claimedAt) lastSeenByUser.set(c.userId, c.claimedAt);
  }
  for (const c of completedToday) {
    const cur = lastSeenByUser.get(c.userId);
    const t = c.completedAt ?? new Date(0);
    if (!cur || cur < t) lastSeenByUser.set(c.userId, t);
  }

  const team = users.map((u) => {
    const active = activeByUser.get(u.id);
    const sick = sickByUser.get(u.id);
    const vac = vacByUser.get(u.id);
    const off = offByUser.get(u.id);
    const shift = shiftByUser.get(u.id);
    const doneCount = doneCountByUser.get(u.id) ?? 0;
    const lastSeenAt = lastSeenByUser.get(u.id);

    let workStatus:
      | "working"
      | "completed_only"
      | "not_started"
      | "off_day"
      | "vacation"
      | "sick"
      | "shift_off"
      | "no_telegram" = "not_started";

    const absence = absenceByUser.get(u.id) ?? null;

    if (sick || absence?.status === "sick_leave") workStatus = "sick";
    else if (vac || absence?.status === "vacation") workStatus = "vacation";
    else if (off || absence?.status === "day_off") workStatus = "off_day";
    else if (shift?.status === "off") workStatus = "shift_off";
    else if (active) workStatus = "working";
    else if (doneCount > 0) workStatus = "completed_only";
    else if (!u.telegramChatId) workStatus = "no_telegram";
    else workStatus = "not_started";

    return {
      id: u.id,
      name: u.name,
      preset: effectivePreset({
        permissionPreset: u.permissionPreset,
        role: u.role,
      }),
      positionLabel:
        u.jobPosition?.name?.trim() ||
        u.positionTitle?.trim() ||
        getUserRoleLabel(u.role),
      hasTelegram: Boolean(u.telegramChatId),
      workStatus,
      activeClaim: active
        ? {
            scopeLabel: active.scopeLabel,
            journalCode: active.journalCode,
            claimedAt: active.claimedAt.toISOString(),
          }
        : null,
      doneCount,
      lastSeenAt: lastSeenAt ? lastSeenAt.toISOString() : null,
      sick: sick
        ? { dateFrom: sick.dateFrom, dateTo: sick.dateTo }
        : null,
      vacation: vac
        ? { dateFrom: vac.dateFrom, dateTo: vac.dateTo }
        : null,
      offDay: off ? { date: off.date } : null,
      shift: shift
        ? { status: shift.status, handoverAt: shift.handoverAt }
        : null,
    };
  });

  return NextResponse.json({ viewMode, team });
}
