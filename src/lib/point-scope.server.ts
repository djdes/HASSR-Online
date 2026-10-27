import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { pointScopeForUser } from "@/lib/building-scope";
import { db } from "@/lib/db";
import { STAFF_OUT_OF_SCOPE_ERROR, isPointScoped, staffInScope } from "@/lib/point-scope";
import { bumpSessionVersion } from "@/lib/session-version";
import { getDbRoleValuesWithLegacy, MANAGEMENT_ROLES } from "@/lib/user-roles";

/**
 * Точки руководителя точки в его домашней организации (фаза 2 «Офис и
 * точки»); null — работает на всю компанию. Лишний запрос — только тем,
 * кто закреплён за местами.
 */
export async function computePointScope(
  user: { organizationId: string; buildingIds: readonly string[] },
): Promise<string[] | null> {
  if (user.buildingIds.length === 0) return null;
  const org = await db.organization.findUnique({
    where: { id: user.organizationId },
    select: { perLocationJournals: true, buildings: { select: { id: true, kind: true } } },
  });
  if (!org) return null;
  return pointScopeForUser({
    enabled: org.perLocationJournals,
    buildings: org.buildings,
    userBuildingIds: user.buildingIds,
  });
}

/** То же по id человека — для выдачи токена. ROOT и чужие — null. */
export async function computePointScopeForUserId(userId: string): Promise<string[] | null> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { organizationId: true, buildingIds: true, isRoot: true },
  });
  if (!user || user.isRoot) return null;
  return computePointScope(user);
}

/**
 * Точки руководителя лежат и в токене — по ним proxy закрывает общие
 * разделы. Токен не перевыпускается на каждый запрос, поэтому, когда
 * деление меняется (выделили офис, включили или выключили журналы по
 * точкам), сессии руководителей с местами закрываем: новый вход возьмёт
 * актуальное (как при смене «Разрешения менять настройки»).
 */
export async function closePointManagerSessions(organizationId: string, exceptUserId?: string): Promise<number> {
  const managers = await db.user.findMany({
    where: {
      organizationId,
      isActive: true,
      NOT: [{ buildingIds: { isEmpty: true } }, ...(exceptUserId ? [{ id: exceptUserId }] : [])],
      OR: [{ role: { in: getDbRoleValuesWithLegacy(MANAGEMENT_ROLES) } }, { canManageSettings: true }],
    },
    select: { id: true },
  });
  for (const manager of managers) await bumpSessionVersion(manager.id).catch(() => null);
  return managers.length;
}

/**
 * Ответ 403, если руководитель точки трогает человека не со своих точек
 * (фаза 2 «Офис и точки»); иначе null. Человека не нашли — тоже null:
 * «не найден» отвечает сам маршрут.
 */
export async function staffOutOfScopeResponse(session: Session, userId: string): Promise<NextResponse | null> {
  if (!isPointScoped(session.user)) return null;
  const target = await db.user.findFirst({
    where: { id: userId, organizationId: getActiveOrgId(session) },
    select: { buildingIds: true },
  });
  if (!target || staffInScope(session.user, target.buildingIds)) return null;
  return NextResponse.json({ error: STAFF_OUT_OF_SCOPE_ERROR }, { status: 403 });
}
