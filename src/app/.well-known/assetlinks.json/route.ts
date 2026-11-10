import { NextResponse } from "next/server";

import { APP_BUNDLE_ID, androidCertFingerprints, buildAssetLinks } from "@/lib/app-links";

export const dynamic = "force-dynamic";

/**
 * Файл связи Android-приложения с доменом (App Links). Пока
 * `ANDROID_CERT_SHA256` не задан — пустой список: это корректный ответ
 * «связей нет», ссылки просто открываются в браузере.
 */
export function GET() {
  // Ключ загрузки зашит в коде: список не бывает пустым, даже если переменная на сервере не задана.
  return NextResponse.json(buildAssetLinks(APP_BUNDLE_ID, androidCertFingerprints(process.env.ANDROID_CERT_SHA256)));
}
