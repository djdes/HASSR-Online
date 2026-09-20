import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { getServerSession } from "@/lib/server-session";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/dashboard/med-books-expiry
 *
 * Сводка по срокам медкнижек (skill="med_book" в StaffCompetency).
 * Возвращает три категории:
 *   - expired:   просрочены (expiresAt < now)
 *   - warning:   < 30 дней до истечения
 *   - ok:        > 30 дней (counter)
 *   - missing:   сотрудник без записи о медкнижке вовсе
 *
 * Используется виджетом на дашборде. Manager видит «5 медкнижек
 * истекают на этой неделе → нужно отправить на медосмотр».
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

  const now = new Date();
  const in30 = new Date(now);
  in30.setDate(in30.getDate() + 30);

  const [users, certs] = await Promise.all([
    db.user.findMany({
      where: { organizationId, isActive: true, archivedAt: null },
      select: { id: true, name: true, role: true },
    }),
    db.staffCompetency.findMany({
      where: {
        organizationId,
        OR: [
          { skill: "med_book" },
          { skill: { contains: "медкнижка", mode: "insensitive" } },
        ],
      },
      select: {
        userId: true,
        certifiedAt: true,
        expiresAt: true,
        notes: true,
      },
      orderBy: { expiresAt: "asc" },
    }),
  ]);

  const certByUser = new Map(certs.map((c) => [c.userId, c]));

  const rows = users.map((u) => {
    const c = certByUser.get(u.id);
    if (!c) return { userId: u.id, name: u.name, status: "missing" as const };
    if (!c.expiresAt) return { userId: u.id, name: u.name, status: "no_expiry" as const };
    const exp = c.expiresAt;
    const daysLeft = Math.ceil((exp.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
    let status: "expired" | "warning" | "ok";
    if (exp < now) status = "expired";
    else if (exp < in30) status = "warning";
    else status = "ok";
    return {
      userId: u.id,
      name: u.name,
      status,
      expiresAt: exp.toISOString().slice(0, 10),
      daysLeft,
    };
  });

  rows.sort((a, b) => {
    const order = { expired: 0, warning: 1, missing: 2, no_expiry: 3, ok: 4 } as const;
    return order[a.status] - order[b.status];
  });

  const summary = {
    expired: rows.filter((r) => r.status === "expired").length,
    warning: rows.filter((r) => r.status === "warning").length,
    missing: rows.filter((r) => r.status === "missing").length,
    no_expiry: rows.filter((r) => r.status === "no_expiry").length,
    ok: rows.filter((r) => r.status === "ok").length,
  };

  return NextResponse.json({ summary, rows });
}
