import fs from "fs/promises";
import path from "path";
import { parseReleaseManifest, type SetupHelperRelease } from "@/lib/setup-helper";

/**
 * Файлы выпуска «Сетап помощника» на сервере. Их собирает и кладёт задача
 * Gradle `publishRelease` (mobile/setup-helper): у сервера нет Android SDK,
 * поэтому APK приезжает в архиве деплоя готовым.
 */
export const SETUP_HELPER_DIR = path.join(process.cwd(), "resources", "setup-helper");
export const SETUP_HELPER_APK = path.join(SETUP_HELPER_DIR, "setup-helper.apk");
export const SETUP_HELPER_MANIFEST = path.join(SETUP_HELPER_DIR, "version.json");

/** Текущий выпуск или null: файла нет или он испорчен. */
export async function readSetupHelperRelease(): Promise<SetupHelperRelease | null> {
  let raw: string;
  try {
    raw = await fs.readFile(SETUP_HELPER_MANIFEST, "utf8");
  } catch {
    return null;
  }
  try {
    return parseReleaseManifest(JSON.parse(raw));
  } catch {
    return null;
  }
}
