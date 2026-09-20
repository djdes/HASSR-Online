import { NextResponse, type NextRequest } from "next/server";
import { getActiveOrgId, requireApiAuth } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PUT /api/settings/positions/<id>/visible-users
 *
 * Body: { userIds: string[] }
 *
 * Перезаписывает `JobPosition.visibleUserIds` — список сотрудников,
 * которых ВИДЯТ все, кто на этой должности. Это per-position
 * аналог ManagerScope и работает СРАЗУ для:
 *   • TasksFlow scope-фильтра (через sync-hierarchy)
 *   • Telegram-бот видимости подчинённых
 *
 * Управляющие и admin only. Если пустой массив — должность не
 * видит никого (показывает только свои задачи). Если поле не
 * настраивалось вообще (default `[]`) — back-compat fallback на
 * ManagerScope или «видит всех».
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ positionId: string }> }
) {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;
  const session = auth.session;
  if (!hasFullWorkspaceAccess(session.user)) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }

  const { positionId } = await params;
  const organizationId = getActiveOrgId(session);

  // Только должность из текущей орги — никаких cross-org правок.
  const position = await db.jobPosition.findFirst({
    where: { id: positionId, organizationId },
    select: { id: true },
  });
  if (!position) {
    return NextResponse.json(
      { error: "Должность не найдена" },
      { status: 404 }
    );
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const raw = (body as { userIds?: unknown }).userIds;
  const userIds: string[] = Array.isArray(raw)
    ? raw.filter((v): v is string => typeof v === "string" && v.length > 0)
    : [];

  // Все user.id должны быть из той же орги — защита от
  // тривиального leak'а через guessing user-id из чужой компании.
  if (userIds.length > 0) {
    const valid = await db.user.findMany({
      where: { id: { in: userIds }, organizationId },
      select: { id: true },
    });
    if (valid.length !== userIds.length) {
      return NextResponse.json(
        { error: "Некоторые сотрудники не из вашей организации" },
        { status: 400 }
      );
    }
  }

  await db.jobPosition.update({
    where: { id: positionId },
    data: { visibleUserIds: userIds },
  });

  return NextResponse.json({ ok: true, count: userIds.length });
}
