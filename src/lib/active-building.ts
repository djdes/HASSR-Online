import { cache } from "react";
import { cookies } from "next/headers";
import type { Session } from "next-auth";
import { getActiveOrgId } from "@/lib/auth-helpers";
import {
  ACTIVE_BUILDING_COOKIE,
  ACTIVE_BUILDING_COOKIE_MAX_AGE_SEC,
  allowedBuildingsForUser,
  decodeBuildingCookie,
  encodeBuildingCookie,
  resolveActiveBuilding,
  type BuildingContext,
  type BuildingOption,
} from "@/lib/building-scope";
import { db } from "@/lib/db";

/**
 * Точки (2026-09-05): активная точка текущего запроса.
 *
 * Один источник для layout'а (переключатель в шапке), страниц журналов и
 * API: все читают контекст отсюда, поэтому список в шапке и фильтр
 * документов не расходятся. `cache` из React дедуплицирует вызовы в
 * рамках одного серверного рендера.
 *
 * Правила — в `resolveActiveBuilding` (src/lib/building-scope.ts):
 * флаг организации выключен или точек < 2 → `activeBuildingId = null`;
 * непустой `User.buildingIds` ограничивает выбор; cookie на недоступную
 * точку → первая доступная.
 */
export const loadBuildingContext = cache(
  async (session: Session): Promise<BuildingContext> => {
    const organizationId = getActiveOrgId(session);
    const [organization, buildings, user, cookieStore] = await Promise.all([
      db.organization.findUnique({
        where: { id: organizationId },
        select: { perLocationJournals: true },
      }),
      listOrganizationBuildings(organizationId),
      db.user.findUnique({
        where: { id: session.user.id },
        select: { organizationId: true, buildingIds: true, lastActiveBuildingId: true },
      }),
      cookies(),
    ]);
    // Ограничение «работает на точках» действует только в домашней
    // организации: партнёр в кабинете клиента и ROOT при импёрсонации
    // видят все точки той организации, в которую вошли.
    const homeOrg = Boolean(user && user.organizationId === organizationId);
    const userBuildingIds = homeOrg && user ? user.buildingIds : [];
    // Cookie — быстрый выбор на этом устройстве; без неё берём точку,
    // запомненную в аккаунте (новый телефон открывает ту же точку).
    const cookieBuildingId = decodeBuildingCookie(
      cookieStore.get(ACTIVE_BUILDING_COOKIE)?.value,
      organizationId,
    );
    return resolveActiveBuilding({
      enabled: organization?.perLocationJournals === true,
      buildings,
      userBuildingIds,
      cookieBuildingId:
        cookieBuildingId ?? (homeOrg && user ? user.lastActiveBuildingId : null),
    });
  },
);

/**
 * Точки, доступные человеку (2026-10-18): пункты «Мои точки» в меню раздела
 * «Торговые точки» и проверка страницы точки. Все точки организации в том же
 * порядке, что у переключателя в шапке, с учётом `User.buildingIds` в
 * домашней организации (как `loadBuildingContext`) — независимо от режима
 * «журналы по точкам». Партнёр и ROOT при импёрсонации видят все точки.
 */
export const listPersonBuildings = cache(
  async (session: Session): Promise<BuildingOption[]> => {
    const organizationId = getActiveOrgId(session);
    const [buildings, user] = await Promise.all([
      listOrganizationBuildings(organizationId),
      db.user.findUnique({
        where: { id: session.user.id },
        select: { organizationId: true, buildingIds: true },
      }),
    ]);
    const homeOrg = Boolean(user && user.organizationId === organizationId);
    return allowedBuildingsForUser(buildings, homeOrg && user ? user.buildingIds : []);
  },
);

/** Id активной точки для фильтра документов; null — без фильтра. */
export async function getActiveBuildingId(session: Session): Promise<string | null> {
  return (await loadBuildingContext(session)).activeBuildingId;
}

export async function listOrganizationBuildings(
  organizationId: string,
): Promise<BuildingOption[]> {
  return db.building.findMany({
    where: { organizationId },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true, address: true, kind: true },
  });
}

// Кроны и обязательства импортируют цели точек без next/headers.
export { buildingTargets } from "@/lib/building-targets";

/** Записать выбор точки в cookie (route handlers). */
export async function setActiveBuildingCookie(
  organizationId: string,
  buildingId: string,
): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_BUILDING_COOKIE, encodeBuildingCookie(organizationId, buildingId), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: ACTIVE_BUILDING_COOKIE_MAX_AGE_SEC,
  });
}
