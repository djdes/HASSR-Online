import { NextResponse } from "next/server";

import { APP_BUNDLE_ID, buildAppleAppSiteAssociation } from "@/lib/app-links";

export const dynamic = "force-dynamic";

/**
 * Файл связи iOS-приложения с доменом. Apple забирает его сам (через свой
 * CDN), без кук: ответ обязан быть 200 `application/json` без редиректов.
 * Пока `APPLE_TEAM_ID` не задан — 404, чтобы iOS не связывала домен с
 * чужим или пустым приложением.
 */
export function GET() {
  const teamId = process.env.APPLE_TEAM_ID?.trim();
  if (!teamId) {
    return NextResponse.json({ error: "not configured" }, { status: 404 });
  }
  return NextResponse.json(buildAppleAppSiteAssociation(teamId, APP_BUNDLE_ID));
}
