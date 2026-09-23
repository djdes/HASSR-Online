import { redirect } from "next/navigation";

import { getActiveBuildingId } from "@/lib/active-building";
import { getActiveOrgId, requireAuth } from "@/lib/auth-helpers";
import { parseQrPostersRequest, type QrPostersSearch } from "@/lib/qr-posters-request";
import { loadQrPostersView } from "@/lib/qr-posters-view";
import { resolveQrPosterOrigin } from "@/lib/qr-poster-origin";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { QrPostersClient } from "./qr-posters-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata = { title: "QR-коды" };

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
 *   &origin=https://…              — домен ссылок (для проверки на стенде).
 */
export default async function QrPostersPage({ searchParams }: { searchParams: Promise<QrPostersSearch> }) {
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) redirect("/settings");
  const organizationId = getActiveOrgId(session);
  const request = parseQrPostersRequest(await searchParams);
  const origin = resolveQrPosterOrigin({
    requested: request.origin,
    configured: process.env.NEXTAUTH_URL || process.env.PUBLIC_URL,
    production: process.env.NODE_ENV === "production",
  });
  const view = await loadQrPostersView({
    organizationId,
    request,
    origin,
    activeBuildingId: await getActiveBuildingId(session),
  });
  return <QrPostersClient view={view} />;
}
