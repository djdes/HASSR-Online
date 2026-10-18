import { existsSync } from "node:fs";
import path from "node:path";

import type { SiteLocale } from "@/i18n/site-locale";

import type { NarratedVideo } from "./video-lightbox";

/** Где лежит отрендеренное видео (`npm run video:render`). */
export const NARRATED_VIDEO_DIR = "landing/video";
export const NARRATED_VIDEO_BASENAME = "qr-tour";

/**
 * Видео «Как работает QR» с голосом — только на русской главной (озвучка
 * пока одна) и только если MP4 лежит в `public/landing/video/`: без файла
 * кнопки «Смотреть видео со звуком» нет.
 */
export function narratedVideoFor(locale: SiteLocale, publicDir = path.join(process.cwd(), "public")): NarratedVideo | null {
  if (locale !== "ru") return null;
  const base = `${NARRATED_VIDEO_DIR}/${NARRATED_VIDEO_BASENAME}-${locale}`;
  const has = (extension: string) => existsSync(path.join(publicDir, `${base}.${extension}`));
  if (!has("mp4")) return null;
  return {
    src: `/${base}.mp4`,
    ...(has("jpg") ? { poster: `/${base}.jpg` } : {}),
    ...(has("vtt") ? { captions: `/${base}.vtt` } : {}),
  };
}
