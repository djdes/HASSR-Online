import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { getServerSession } from "@/lib/server-session";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { db } from "@/lib/db";
import { NOT_AUTO_SEEDED } from "@/lib/journal-entry-filters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/dashboard/staff-training-overdue
 *
 * Сотрудники у кого последнее обучение по гигиене > 365 дней назад
 * (или вообще нет). Берём данные из JournalDocumentEntry по journal
 * staff_training. Каждая entry data может содержать `traineeIds: []`
 * или `userId: '...'` — поддерживаем оба формата.
 *
 * Real life: СанПиН требует ежегодного гигиенического обучения для
 * каждого работника, контактирующего с пищей. Просрочка — штраф.
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

  const tpl = await db.journalTemplate.findUnique({
    where: { code: "staff_training" },
    select: { id: true },
  });
  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

  const [users, recentEntries] = await Promise.all([
    db.user.findMany({
      where: { organizationId, isActive: true, archivedAt: null },
      select: { id: true, name: true, role: true },
    }),
    tpl
      ? db.journalDocumentEntry.findMany({
          where: {
            document: { organizationId, templateId: tpl.id },
            date: { gte: oneYearAgo },
            ...NOT_AUTO_SEEDED,
          },
          select: { date: true, employeeId: true, data: true },
          orderBy: { date: "desc" },
        })
      : Promise.resolve([]),
  ]);

  // Last-trained-at per userId. employeeId (column) или userId/traineeIds в data.
  const lastTrainedAt = new Map<string, Date>();
  for (const e of recentEntries) {
    const ids = new Set<string>();
    if (e.employeeId) ids.add(e.employeeId);
    if (e.data && typeof e.data === "object") {
      const d = e.data as Record<string, unknown>;
      if (typeof d.userId === "string") ids.add(d.userId);
      if (Array.isArray(d.traineeIds)) {
        for (const t of d.traineeIds) if (typeof t === "string") ids.add(t);
      }
      if (Array.isArray(d.trainees)) {
        for (const t of d.trainees) {
          if (typeof t === "string") ids.add(t);
          else if (typeof t === "object" && t && "id" in t) {
            const v = (t as Record<string, unknown>).id;
            if (typeof v === "string") ids.add(v);
          }
        }
      }
    }
    for (const id of ids) {
      const cur = lastTrainedAt.get(id);
      if (!cur || cur < e.date) lastTrainedAt.set(id, e.date);
    }
  }

  const now = new Date();
  const rows = users.map((u) => {
    const last = lastTrainedAt.get(u.id);
    if (!last) return { userId: u.id, name: u.name, status: "missing" as const };
    const daysSince = Math.floor((now.getTime() - last.getTime()) / 86_400_000);
    if (daysSince > 365) {
      return {
        userId: u.id,
        name: u.name,
        status: "overdue" as const,
        lastTrainedAt: last.toISOString().slice(0, 10),
        daysSince,
      };
    }
    if (daysSince > 335) {
      return {
        userId: u.id,
        name: u.name,
        status: "warning" as const,
        lastTrainedAt: last.toISOString().slice(0, 10),
        daysSince,
      };
    }
    return {
      userId: u.id,
      name: u.name,
      status: "ok" as const,
      lastTrainedAt: last.toISOString().slice(0, 10),
      daysSince,
    };
  });

  rows.sort((a, b) => {
    const order = { overdue: 0, missing: 1, warning: 2, ok: 3 } as const;
    return order[a.status] - order[b.status];
  });

  return NextResponse.json({
    summary: {
      overdue: rows.filter((r) => r.status === "overdue").length,
      warning: rows.filter((r) => r.status === "warning").length,
      missing: rows.filter((r) => r.status === "missing").length,
      ok: rows.filter((r) => r.status === "ok").length,
    },
    rows,
  });
}
