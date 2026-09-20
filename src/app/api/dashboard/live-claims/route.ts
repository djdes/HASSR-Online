import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { getServerSession } from "@/lib/server-session";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { db } from "@/lib/db";
import { orgDayStartInstant } from "@/lib/timezone";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/dashboard/live-claims — что сейчас в работе по организации.
 *
 * Используется live-widget'ом на дашборде. Возвращает:
 *   - activeNow: список active-claim'ов (что сотрудник в данный момент
 *                выполняет) с "сколько минут назад взял";
 *   - completedToday: completed-claims за сегодня;
 *   - byJournal: counts per journalCode для bar-chart.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }
  if (
    !hasFullWorkspaceAccess({
      role: session.user.role,
      isRoot: session.user.isRoot,
    })
  ) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }
  const organizationId = getActiveOrgId(session);
  // «Сегодня» — по часовому поясу организации: от UTC-полуночи в Москве
  // с 00:00 до 03:00 в ленту попадал вчерашний вечер, а свежие отметки нет.
  const organization = await db.organization.findUnique({
    where: { id: organizationId },
    select: { timezone: true },
  });
  const todayStart = orgDayStartInstant(organization?.timezone ?? undefined);

  const [active, completedToday] = await Promise.all([
    db.journalTaskClaim.findMany({
      where: { organizationId, status: "active" },
      include: { user: { select: { id: true, name: true } } },
      orderBy: { claimedAt: "desc" },
      take: 50,
    }),
    db.journalTaskClaim.findMany({
      where: {
        organizationId,
        status: "completed",
        completedAt: { gte: todayStart },
      },
      include: { user: { select: { id: true, name: true } } },
      orderBy: { completedAt: "desc" },
      take: 50,
    }),
  ]);

  const byJournal = new Map<string, { active: number; completed: number }>();
  for (const c of active) {
    const cur = byJournal.get(c.journalCode) ?? { active: 0, completed: 0 };
    cur.active += 1;
    byJournal.set(c.journalCode, cur);
  }
  for (const c of completedToday) {
    const cur = byJournal.get(c.journalCode) ?? { active: 0, completed: 0 };
    cur.completed += 1;
    byJournal.set(c.journalCode, cur);
  }

  return NextResponse.json({
    activeNow: active.map((c) => ({
      id: c.id,
      journalCode: c.journalCode,
      scopeKey: c.scopeKey,
      scopeLabel: c.scopeLabel,
      userName: c.user.name,
      userId: c.userId,
      claimedAt: c.claimedAt,
    })),
    completedToday: completedToday.map((c) => ({
      id: c.id,
      journalCode: c.journalCode,
      scopeLabel: c.scopeLabel,
      userName: c.user.name,
      completedAt: c.completedAt,
    })),
    byJournal: Array.from(byJournal.entries()).map(([code, counts]) => ({
      code,
      ...counts,
    })),
  });
}
