import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { pointScopeForUser, type BuildingKindRef } from "@/lib/building-scope";
import { db } from "@/lib/db";
import { STAFF_OUT_OF_SCOPE_ERROR, isPointScoped, staffInScope, type PointScopeActor } from "@/lib/point-scope";
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

/**
 * Человек в пределах руководителя точки (правило владельца, 2026-11-01):
 * работает хотя бы на одной его точке и сам не «вся компания». Офис, люди
 * без точки и закреплённые за всеми точками (`pointScopeForUser` = null)
 * ведёт руководство компании — даже если среди их мест есть точка
 * руководителя. Без ограничения — любой. Чистое решение при известных
 * точках организации, без БД; для запроса — `loadStaffScopeCheck`.
 */
export function staffInManagerScope(
  actor: PointScopeActor | null | undefined,
  organization: { enabled: boolean; buildings: readonly BuildingKindRef[] },
  userBuildingIds: readonly string[],
): boolean {
  if (!isPointScoped(actor)) return true;
  const companyWide =
    pointScopeForUser({ enabled: organization.enabled, buildings: organization.buildings, userBuildingIds }) === null;
  return !companyWide && staffInScope(actor, userBuildingIds);
}

/**
 * `staffInManagerScope` для запроса: точки организации читаются один раз
 * (как в `computePointScope`), дальше — проверка любого числа людей. Без
 * ограничения — без запроса, любой.
 */
export async function loadStaffScopeCheck(session: Session): Promise<(userBuildingIds: readonly string[]) => boolean> {
  if (!isPointScoped(session.user)) return () => true;
  const org = await db.organization.findUnique({
    where: { id: getActiveOrgId(session) },
    select: { perLocationJournals: true, buildings: { select: { id: true, kind: true } } },
  });
  const organization = { enabled: org?.perLocationJournals === true, buildings: org?.buildings ?? [] };
  return (userBuildingIds) => staffInManagerScope(session.user, organization, userBuildingIds);
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
 * (фаза 2 «Офис и точки») или человека всей компании (2026-11-01,
 * `staffInManagerScope`); иначе null. Человека не нашли — тоже null:
 * «не найден» отвечает сам маршрут.
 */
export async function staffOutOfScopeResponse(session: Session, userId: string): Promise<NextResponse | null> {
  if (!isPointScoped(session.user)) return null;
  const target = await db.user.findFirst({
    where: { id: userId, organizationId: getActiveOrgId(session) },
    select: { buildingIds: true },
  });
  if (!target) return null;
  const inScope = await loadStaffScopeCheck(session);
  if (inScope(target.buildingIds)) return null;
  return NextResponse.json({ error: STAFF_OUT_OF_SCOPE_ERROR }, { status: 403 });
}
