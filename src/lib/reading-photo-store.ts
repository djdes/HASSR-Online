import crypto from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { sniffImageMime } from "@/lib/ai-vision/temp-store";
import {
  READING_PHOTO_SUBDIR,
  readingPhotoFileName,
  readingPhotoPathSegments,
} from "@/lib/reading-photos";
import { resolveUploadPath, uploadsDir } from "@/lib/uploads-path";

/**
 * Хранение снимков замеров (`src/lib/reading-photos.ts`): тот же каталог
 * загрузок, что у остальных фото журналов (`uploadsDir()`, отдаёт маршрут
 * `/uploads/**`), подкаталог `readings/`, случайное имя из 32 hex.
 * Расширение — по сигнатуре файла, а не по имени и заголовку: под видом
 * JPEG не положить ни разметку, ни скрипт.
 */

/** Предел снимка на сервере; клиент заранее ужимает до ~1600 px JPEG (200–600 КБ). */
export const READING_PHOTO_MAX_BYTES = 6 * 1024 * 1024;

const EXT_BY_MIME = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" } as const;

type BaseDirOption = { baseDir?: string };

/** Сохранить снимок. null — не JPEG/PNG/WEBP. */
export async function saveReadingPhoto(bytes: Uint8Array, options: BaseDirOption = {}): Promise<{ url: string } | null> {
  const mime = sniffImageMime(bytes);
  if (!mime) return null;
  const name = readingPhotoFileName(crypto.randomBytes(16).toString("hex"), EXT_BY_MIME[mime]);
  const dir = path.join(options.baseDir ?? uploadsDir(), READING_PHOTO_SUBDIR);
  // На свежей выкладке подкаталога нет — без mkdir первый снимок падал бы с ENOENT.
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, name), bytes, { flag: "wx" });
  return { url: `/uploads/${READING_PHOTO_SUBDIR}/${name}` };
}

function photoPath(url: string, options: BaseDirOption): string | null {
  const segments = readingPhotoPathSegments(url);
  return segments ? resolveUploadPath(segments, options.baseDir ?? uploadsDir()) : null;
}

/** Снимок по ссылке существует (сохранение замера не принимает выдуманные ссылки). */
export async function readingPhotoExists(url: string, options: BaseDirOption = {}): Promise<boolean> {
  const file = photoPath(url, options);
  if (!file) return false;
  try {
    return (await stat(file)).isFile();
  } catch {
    return false;
  }
}

/** Байты снимка для распознавания; null — нет файла, чужая ссылка или больше предела. */
export async function readReadingPhoto(url: string, options: BaseDirOption = {}): Promise<Uint8Array | null> {
  const file = photoPath(url, options);
  if (!file) return null;
  try {
    const info = await stat(file);
    if (!info.isFile() || info.size > READING_PHOTO_MAX_BYTES) return null;
    return new Uint8Array(await readFile(file));
  } catch {
    return null;
  }
}
