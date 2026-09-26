import { NextResponse } from "next/server";

import { APP_BUNDLE_ID, buildAssetLinks, parseCertFingerprints } from "@/lib/app-links";

export const dynamic = "force-dynamic";

/**
 * Файл связи Android-приложения с доменом (App Links). Пока
 * `ANDROID_CERT_SHA256` не задан — пустой список: это корректный ответ
 * «связей нет», ссылки просто открываются в браузере.
 */
export function GET() {
  const prints = parseCertFingerprints(process.env.ANDROID_CERT_SHA256);
  const body = prints.length === 0 ? [] : buildAssetLinks(APP_BUNDLE_ID, prints);
  return NextResponse.json(body);
}
