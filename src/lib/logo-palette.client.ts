/**
 * Цвета логотипа в браузере: картинка → уменьшенная копия на canvas →
 * пиксели → `paletteFromPixels`. Только для клиентских компонентов.
 *
 * Загруженный в кабинете файл (`/api/org-assets/…`) — того же сайта, его
 * пиксели читаются всегда. Ссылка на чужой сайт без CORS «пачкает» canvas —
 * тогда `ok: false` и цвета не подбираются.
 */

import { paletteFromPixels, type LogoPalette } from "@/lib/logo-palette";

/** Длинная сторона копии: цвета ещё видны, пикселей немного. */
const SAMPLE_SIDE = 160;

export type LogoPaletteResult = { ok: true; palette: LogoPalette | null } | { ok: false };

export async function extractLogoPalette(url: string): Promise<LogoPaletteResult> {
  try {
    const image = new window.Image();
    image.decoding = "async";
    if (/^https?:\/\//i.test(url)) image.crossOrigin = "anonymous";
    image.src = url;
    await image.decode();
    // У SVG без размеров natural* бывают нулевыми — берём пропорции знака.
    const width = image.naturalWidth || 320;
    const height = image.naturalHeight || 160;
    const scale = SAMPLE_SIDE / Math.max(width, height);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return { ok: false };
    // Без сглаживания: чистые цвета, а не смесь с фоном на краях букв.
    context.imageSmoothingEnabled = false;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    return { ok: true, palette: paletteFromPixels(data) };
  } catch {
    return { ok: false };
  }
}
