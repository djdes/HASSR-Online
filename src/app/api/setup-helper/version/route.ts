import { NextResponse } from "next/server";
import { setupHelperDownloadUrl } from "@/lib/setup-helper";
import { readSetupHelperRelease } from "@/lib/setup-helper-release";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/setup-helper/version — последняя версия приложения «Сетап помощник».
 *
 * Без входа: приложение проверяет обновления и до входа, и после отключения
 * телефона на сайте. Ответ — манифест выпуска и ссылка на APK; приложение
 * ставит обновление, только если `versionCode` больше его собственного, а
 * SHA-256 скачанного файла совпал с манифестом.
 */
export async function GET() {
  const release = await readSetupHelperRelease();
  if (!release) {
    return NextResponse.json(
      { error: "Версия приложения на сервере не найдена" },
      { status: 503, headers: { "Cache-Control": "no-cache" } },
    );
  }
  return NextResponse.json(
    { ...release, downloadUrl: `${setupHelperDownloadUrl()}?v=${release.versionCode}` },
    { headers: { "Cache-Control": "no-cache" } },
  );
}
