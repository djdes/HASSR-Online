import fs from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/setup-helper/download — APK приложения «Сетап помощник».
 *
 * Без входа: ссылку открывают с телефона (в том числе по QR со страницы
 * настроек), где человек ещё не вошёл на сайт, а приложение без учётной
 * записи всё равно ничего не умеет. Секретов в APK нет.
 *
 * Файл собирается из `mobile/setup-helper` и кладётся в
 * `resources/setup-helper/` (см. README приложения): у сервера нет
 * Android SDK, чтобы собирать его при деплое.
 */
const SETUP_HELPER_APK = path.join(process.cwd(), "resources", "setup-helper", "setup-helper.apk");

export async function GET() {
  let file: Buffer;
  try {
    file = await fs.readFile(SETUP_HELPER_APK);
  } catch {
    return NextResponse.json({ error: "Файл приложения не найден на сервере" }, { status: 404 });
  }

  return new Response(new Uint8Array(file), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.android.package-archive",
      "Content-Disposition": 'attachment; filename="setup-helper.apk"',
      "Content-Length": String(file.length),
      "Cache-Control": "no-cache",
    },
  });
}
