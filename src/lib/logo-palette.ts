/**
 * Цвета из логотипа (владелец, 2026-11-21: «по цветам логотипу… чтобы вау
 * было»): основной — самый заметный цветной оттенок логотипа, дополнительный —
 * другой заметный оттенок. Прозрачное, белое, серое и почти чёрное не в счёт:
 * это фон и текст, а не фирменный цвет. Логотип без цвета — `null`.
 *
 * Чистая функция над пикселями RGBA (как их отдаёт canvas): без DOM, с тестами.
 * Чтение картинки в браузере — `logo-palette.client.ts`.
 */

import { hexToRgb, rgbToHex } from "@/lib/document-brand";

export type LogoPalette = { primary: string; secondary: string | null };

/** Оттенки — корзинами по 15°. */
const BINS = 24;
const BIN_DEGREES = 360 / BINS;
/** Полупрозрачное — край сглаживания, не цвет. */
const MIN_ALPHA = 128;
/** Ниже — серое (и белое), темнее — почти чёрное. */
const MIN_SATURATION = 0.25;
const MIN_VALUE = 0.2;
/** Цветного должно быть хотя бы столько от видимых пикселей, иначе логотип ч/б. */
const MIN_CHROMATIC_SHARE = 0.03;
const MIN_CHROMATIC_PIXELS = 8;
/** Дополнительный — не ближе 45° к основному и не меньше 12% от него. */
const SECONDARY_MIN_BINS = 3;
const SECONDARY_MIN_SHARE = 0.12;

function hsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let h = 0;
  if (delta > 0) {
    if (max === r) h = 60 * (((g - b) / delta) % 6);
    else if (max === g) h = 60 * ((b - r) / delta + 2);
    else h = 60 * ((r - g) / delta + 4);
  }
  if (h < 0) h += 360;
  return { h, s: max === 0 ? 0 : delta / max, v: max / 255 };
}

/** Оттенок цвета в градусах (0–360). */
export function hueOf(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return hsv(r, g, b).h;
}

/** Расстояние между оттенками двух цветов, 0–180°. */
export function hueDistance(a: string, b: string): number {
  const d = Math.abs(hueOf(a) - hueOf(b)) % 360;
  return d > 180 ? 360 - d : d;
}

const wrap = (bin: number) => ((bin % BINS) + BINS) % BINS;
const binDistance = (a: number, b: number) => {
  const d = Math.abs(a - b) % BINS;
  return d > BINS / 2 ? BINS - d : d;
};

export function paletteFromPixels(data: ArrayLike<number>): LogoPalette | null {
  const count = new Array<number>(BINS).fill(0);
  const sumR = new Array<number>(BINS).fill(0);
  const sumG = new Array<number>(BINS).fill(0);
  const sumB = new Array<number>(BINS).fill(0);
  let opaque = 0;
  let chromatic = 0;

  for (let i = 0; i + 3 < data.length; i += 4) {
    if (data[i + 3] < MIN_ALPHA) continue;
    opaque += 1;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const { h, s, v } = hsv(r, g, b);
    if (s < MIN_SATURATION || v < MIN_VALUE) continue;
    chromatic += 1;
    const bin = wrap(Math.floor(h / BIN_DEGREES));
    count[bin] += 1;
    sumR[bin] += r;
    sumG[bin] += g;
    sumB[bin] += b;
  }
  if (opaque === 0 || chromatic < Math.max(MIN_CHROMATIC_PIXELS, opaque * MIN_CHROMATIC_SHARE)) return null;

  // Кластер — корзина с соседями: градиент и сглаживание не дробят один цвет на два.
  const cluster = (bin: number) => count[wrap(bin - 1)] + count[bin] + count[wrap(bin + 1)];
  const average = (bins: number[]) => {
    let n = 0;
    let r = 0;
    let g = 0;
    let b = 0;
    for (const bin of bins) {
      n += count[bin];
      r += sumR[bin];
      g += sumG[bin];
      b += sumB[bin];
    }
    return rgbToHex([r / n, g / n, b / n]);
  };

  let primaryBin = 0;
  for (let bin = 1; bin < BINS; bin += 1) {
    const better = cluster(bin) > cluster(primaryBin) || (cluster(bin) === cluster(primaryBin) && count[bin] > count[primaryBin]);
    if (better) primaryBin = bin;
  }
  const primaryBins = [primaryBin - 1, primaryBin, primaryBin + 1].map(wrap);
  const primary = average(primaryBins);

  let secondaryBin: number | null = null;
  for (let bin = 0; bin < BINS; bin += 1) {
    if (count[bin] === 0 || binDistance(bin, primaryBin) < SECONDARY_MIN_BINS) continue;
    if (cluster(bin) < cluster(primaryBin) * SECONDARY_MIN_SHARE) continue;
    if (secondaryBin === null || cluster(bin) > cluster(secondaryBin)) secondaryBin = bin;
  }
  const secondary =
    secondaryBin === null
      ? null
      : average(
          [secondaryBin - 1, secondaryBin, secondaryBin + 1]
            .map(wrap)
            .filter((bin) => binDistance(bin, primaryBin) > 1 && count[bin] > 0),
        );

  return { primary, secondary };
}
