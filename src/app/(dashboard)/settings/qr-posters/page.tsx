import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { getActiveBuildingId } from "@/lib/active-building";
import { getActiveOrgId, requireAuth } from "@/lib/auth-helpers";
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
 *   &origin=https://…              — домен ссылок (для проверки на стенде).
 */
export default async function QrPostersPage({ searchParams }: { searchParams: Promise<QrPostersSearch & { bw?: string | string[] }> }) {
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) redirect("/settings");
  const organizationId = getActiveOrgId(session);
  const search = await searchParams;
  const request = parseQrPostersRequest(search);
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
    mono: isMonoParam(search.bw),
  });
  return <QrPostersClient view={view} />;
}
