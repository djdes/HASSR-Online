import { existsSync } from "node:fs";
import path from "node:path";

import type { SiteLocale } from "@/i18n/site-locale";

import type { QrIndustry } from "./industries";
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
 * Видео по виду деятельности (правки 20.11.2026): у общепита — прежние файлы,
 * у медцентра и отеля — свои, когда их снимут. Первый найденный файл и
 * открывается.
 */
const VIDEO_BASENAMES: Record<QrIndustry, readonly string[]> = {
  food: [PRESENTATION_VIDEO_BASENAME, NARRATED_VIDEO_BASENAME],
  medical: [`${PRESENTATION_VIDEO_BASENAME}-medical`],
  hotel: [`${PRESENTATION_VIDEO_BASENAME}-hotel`],
};

/** Презентация в PDF по виду деятельности (только на русском). */
export const PRESENTATION_PDF: Record<QrIndustry, string> = {
  food: "landing/wesetup-presentation.pdf",
  medical: "landing/wesetup-presentation-medical.pdf",
  hotel: "landing/wesetup-presentation-hotel.pdf",
};

const PUBLIC_DIR = path.join(process.cwd(), "public");

/**
 * Видео «Как работает QR» с голосом — только на русской главной (озвучка
 * пока одна) и только если MP4 лежит в `public/landing/video/`: без файла
 * кнопки «Смотреть видео со звуком» нет.
 */
export function narratedVideoFor(locale: SiteLocale, publicDir = PUBLIC_DIR, industry: QrIndustry = "food"): NarratedVideo | null {
  if (locale !== "ru") return null;
  const file = (name: string, extension: string) => path.join(publicDir, `${NARRATED_VIDEO_DIR}/${name}-${locale}.${extension}`);
  const name = VIDEO_BASENAMES[industry].find((candidate) => existsSync(file(candidate, "mp4")));
  if (!name) return null;
  const base = `${NARRATED_VIDEO_DIR}/${name}-${locale}`;
  const has = (extension: string) => existsSync(file(name, extension));
  return {
    src: `/${base}.mp4`,
    ...(has("jpg") ? { poster: `/${base}.jpg` } : {}),
    ...(has("vtt") ? { captions: `/${base}.vtt` } : {}),
  };
}

/** Ссылка на PDF-презентацию вида деятельности: только русская главная и только если файл лежит. */
export function presentationPdfFor(locale: SiteLocale, industry: QrIndustry, publicDir = PUBLIC_DIR): string | null {
  if (locale !== "ru") return null;
  return existsSync(path.join(publicDir, PRESENTATION_PDF[industry])) ? `/${PRESENTATION_PDF[industry]}` : null;
}
