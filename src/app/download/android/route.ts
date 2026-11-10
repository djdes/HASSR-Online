import { NextResponse } from "next/server";

import { ANDROID_APK_URL } from "@/lib/app-links";

export const dynamic = "force-static";

/**
 * GET /download/android — постоянная ссылка на подписанный APK приложения
 * WeSetup для Android. Файл лежит в выпуске GitHub (его собирает workflow
 * «APK на сайт»), сайт только перенаправляет: 6 МБ незачем гонять через
 * сервер и хранить в репозитории.
 */
export function GET() {
  return NextResponse.redirect(ANDROID_APK_URL, {
    status: 302,
    headers: { "Cache-Control": "no-store" },
  });
}
