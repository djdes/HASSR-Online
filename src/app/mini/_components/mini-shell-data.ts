import type { Session } from "next-auth";

import { loadBuildingContext } from "@/lib/active-building";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { askNpsFor } from "@/lib/nps-data";
import { deletionDueAt } from "@/lib/org-deletion";
import { getPartnerHintRates } from "@/lib/partners/partner-hint";
import { currentAnnouncement } from "@/lib/platform-status";
import { hasFullWorkspaceAccess } from "@/lib/role-access";

/**
 * Данные, которые нужны оболочке мини-приложения.
 *
 * Читаются одинаково для собственных экранов `/mini/*` и для страниц
 * сайта, открытых в оболочке: шапка, тема и баннеры должны выглядеть
 * одинаково, откуда бы человек ни пришёл (П-3).
 *
 * Здесь НЕТ ничего из того, что нужно только шапке сайта (тариф, число
 * сотрудников, список организаций, брендинг партнёра): в оболочке этой
 * шапки нет, и запрашивать их «на всякий случай» — лишние запросы на
 * каждой странице.
 */
export async function loadMiniShellData(session: Session | null) {
  const userId = session?.user?.id ?? null;

  // Тема из профиля — она же выбор человека. До входа её нет вовсе:
  // тогда разметка идёт со значением по умолчанию, а клиент подставит
  // тему самого Telegram (см. MiniThemeBootstrap / MiniThemeProvider).
  const [announcement, profileRow, askNps, deletionState] = await Promise.all([
    currentAnnouncement(),
    userId
      ? db.user
          .findUnique({
            where: { id: userId },
            select: { themePreference: true },
          })
          .catch(() => null)
      : Promise.resolve(null),
    session?.user ? askNpsFor(session).catch(() => false) : Promise.resolve(false),
    session?.user
      ? db.organization
          .findUnique({
            where: { id: getActiveOrgId(session) },
            select: { deletionRequestedAt: true },
          })
          .catch(() => null)
      : Promise.resolve(null),
  ]);

  const profileTheme: "light" | "dark" | null = profileRow
    ? profileRow.themePreference === "light"
      ? "light"
      : "dark"
    : null;

  // Точки: название активной точки в верхней панели на всех экранах —
  // зеркало пилюли в шапке сайта.
  const buildingContext =
    session && userId ? await loadBuildingContext(session).catch(() => null) : null;

  // Та же иконка партнёрской программы, что на сайте. В оболочке
  // white-label логотипа нет, поэтому условие про него всегда false.
  const partnerHint =
    session && userId
      ? await getPartnerHintRates({
          organizationId: getActiveOrgId(session),
          userId,
          hasWhiteLabelLogo: false,
        }).catch(() => null)
      : null;

  return {
    authed: Boolean(session?.user),
    initialTheme: (profileTheme ?? "dark") as "light" | "dark",
    profileTheme,
    announcement,
    askNps,
    deletionDue: deletionState?.deletionRequestedAt
      ? deletionDueAt(deletionState.deletionRequestedAt).toISOString()
      : null,
    canCancelDeletion: session?.user
      ? hasFullWorkspaceAccess(session.user)
      : false,
    locationName: buildingContext?.enabled
      ? buildingContext.activeBuilding?.name ?? null
      : null,
    partnerHint,
  };
}
