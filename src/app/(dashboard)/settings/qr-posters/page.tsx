import { forbidden } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { listPersonBuildings, loadBuildingContext } from "@/lib/active-building";
import { getActiveOrgId, requireAuth } from "@/lib/auth-helpers";
import { viewedPointId } from "@/lib/building-scope";
import { PLACE_ALL, PLACE_NONE, placeFilterParam } from "@/lib/place-filter";
import { buildingInScope } from "@/lib/point-scope";
import { isMonoParam } from "@/lib/print-brand";
import { parseQrPostersRequest, type QrPostersSearch } from "@/lib/qr-posters-request";
import { loadQrPostersView } from "@/lib/qr-posters-view";
import { resolveQrPosterOrigin } from "@/lib/qr-poster-origin";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { QrPostersClient } from "./qr-posters-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("settingsUi.qrPostersPage");
  return { title: t("metaTitle") };
}

/**
 * QR-коды для записи в журналы с телефона — основные (работают всегда),
 * дополнительные (на один документ, до конца его периода) и наклейки на
 * объекты. У каждой карточки своя галка и формат; печать одним заданием.
 *
 * Адрес разбирает `parseQrPostersRequest` (все старые входы — там же):
 *   ?journal=<код>[&doc=<id>]      — экран журнала (кнопка «QR-точка контроля»);
 *   ?kind=equipment|rooms[&ids=]   — наклейки справочников;
 *   ?kind=journals&ids=…           — старые ссылки: отмечены ровно эти id;
 *   &layout=poster|sheet           — формат по умолчанию (A4 / наклейка);
 *   &autoprint=1                   — печать сразу после загрузки;
 *   &bw=1                          — режим «Ч/б»: рамки и центр кода чёрные;
 *   &point=<id>|all|none           — место вместо точки из шапки (кнопки QR
 *                                    «Цехов» и «Оборудования» по фильтру над списком):
 *                                    точка или офис человека, вся организация (тем,
 *                                    кому она доступна), только цеха без точки;
 *   &origin=https://…              — домен ссылок (для проверки на стенде).
 */
export default async function QrPostersPage({
  searchParams,
}: {
  searchParams: Promise<QrPostersSearch & { bw?: string | string[]; point?: string | string[] }>;
}) {
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) forbidden();
  const organizationId = getActiveOrgId(session);
  const search = await searchParams;
  const request = parseQrPostersRequest(search);
  const origin = resolveQrPosterOrigin({
    requested: request.origin,
    configured: process.env.NEXTAUTH_URL || process.env.PUBLIC_URL,
    production: process.env.NODE_ENV === "production",
  });
  // Точка из шапки (скан 98): объекты и «Все журналы» — только её; «Вся
  // организация» или офис — вся организация. `?point=` — выбор в фильтре над
  // списком «Цехов» и «Оборудования»: точка или офис человека, `all` — тем,
  // кому доступна вся организация, `none` — только цеха без точки.
  const buildingContext = await loadBuildingContext(session);
  const pointParam = placeFilterParam(search.point);
  let activeBuildingId = viewedPointId(buildingContext);
  let looseOnly = false;
  if (pointParam === PLACE_ALL) {
    if (!buildingContext.enabled || buildingContext.canViewOrganization) activeBuildingId = null;
  } else if (pointParam === PLACE_NONE) {
    looseOnly = true;
    activeBuildingId = null;
  } else if (pointParam) {
    const point = (await listPersonBuildings(session)).find((building) => building.id === pointParam);
    if (point && buildingInScope(session.user, point.id)) activeBuildingId = point.id;
  }
  const view = await loadQrPostersView({
    organizationId,
    request,
    origin,
    activeBuildingId,
    looseOnly,
    mono: isMonoParam(search.bw),
  });
  return <QrPostersClient view={view} />;
}
