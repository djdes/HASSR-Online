import { existsSync } from "node:fs";
import path from "node:path";

import type { SiteLocale } from "@/i18n/site-locale";

import type { NarratedVideo } from "./video-lightbox";

/** Где лежит отрендеренное видео (`npm run video:render`). */
export const NARRATED_VIDEO_DIR = "landing/video";
export const NARRATED_VIDEO_BASENAME = "qr-tour";
/**
 * Презентация с голосом Максима (правки 05.11.2026: «заменить на презентацию
 * с „Максимом“»). Готовый MP4 со стороны, не из `npm run video:render`, поэтому
 * отдельным файлом: есть он — кнопка «Смотреть видео со звуком» открывает его,
 * нет — прежний ролик `qr-tour`. Субтитры сняты по таймингам речи.
 */
export const PRESENTATION_VIDEO_BASENAME = "presentation";

/**
 * Видео «Как работает QR» с голосом — только на русской главной (озвучка
 * пока одна) и только если MP4 лежит в `public/landing/video/`: без файла
 * кнопки «Смотреть видео со звуком» нет.
 */
export function narratedVideoFor(locale: SiteLocale, publicDir = path.join(process.cwd(), "public")): NarratedVideo | null {
  if (locale !== "ru") return null;
  const file = (name: string, extension: string) => path.join(publicDir, `${NARRATED_VIDEO_DIR}/${name}-${locale}.${extension}`);
  const name = existsSync(file(PRESENTATION_VIDEO_BASENAME, "mp4")) ? PRESENTATION_VIDEO_BASENAME : NARRATED_VIDEO_BASENAME;
  const base = `${NARRATED_VIDEO_DIR}/${name}-${locale}`;
  const has = (extension: string) => existsSync(file(name, extension));
  if (!has("mp4")) return null;
  return {
    src: `/${base}.mp4`,
    ...(has("jpg") ? { poster: `/${base}.jpg` } : {}),
    ...(has("vtt") ? { captions: `/${base}.vtt` } : {}),
  };
}
