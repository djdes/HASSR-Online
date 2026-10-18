/**
 * Фирменный цвет организации в документах и на плакатах (2026-10-17).
 *
 * Решение плана «Моя компания»: корпоративный цвет клиента — только в
 * печатных документах и плакатах, интерфейс кабинета остаётся в стиле
 * WeSetup. Печать по-прежнему рассчитана на ч/б принтеры (правило
 * 2026-09-27, `print-colors.test.ts`), поэтому цвет — необязательный акцент:
 * появляется, только если организация задала `brandColor`, не несёт смысла
 * и на ч/б листе уходит в серый. Текст и линии таблиц остаются чёрными.
 *
 * Чистые функции: без БД и DOM — их зовут и jsPDF-генераторы, и серверные
 * React-листы, и клиентская форма.
 */

export type Rgb = [number, number, number];

/** Фирменные данные организации для документа. */
export type DocumentBrand = {
  /** Адрес логотипа для `<img>` (загруженный файл или внешняя ссылка). */
  logoUrl: string | null;
  /** Фирменный цвет `#rrggbb` или null — документ без цветового акцента. */
  color: string | null;
};

/** Акцент WeSetup — там, где цвет был и раньше (ППК, плакаты ППК). */
export const WESETUP_ACCENT = "#5566f6";

const SHORT_HEX = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i;
const LONG_HEX = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i;

/**
 * `#abc`, `#aabbcc`, `#aabbccdd` → `#aabbcc` (нижний регистр). Альфа
 * отбрасывается: на бумаге полупрозрачности нет. Всё прочее → null.
 */
export function normalizeBrandColor(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  const short = SHORT_HEX.exec(value);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toLowerCase();
  const long = LONG_HEX.exec(value);
  return long ? `#${long[1]}`.toLowerCase() : null;
}

export function hexToRgb(hex: string): Rgb {
  const value = normalizeBrandColor(hex) ?? "#000000";
  return [1, 3, 5].map((index) => parseInt(value.slice(index, index + 2), 16)) as Rgb;
}

export function rgbToHex([r, g, b]: Rgb): string {
  return `#${[r, g, b].map((part) => Math.round(part).toString(16).padStart(2, "0")).join("")}`;
}

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Относительная яркость по WCAG 2.1. */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** Контраст двух цветов по WCAG 2.1 (1…21). */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Тёмный текст плакатов и листов — тот же, что у дизайн-системы. */
export const DOCUMENT_INK = "#0b1024";

/** Цвет текста на заливке фирменным цветом: белый или тёмный — что контрастнее. */
export function brandOnColor(hex: string): string {
  return contrastRatio(hex, "#ffffff") >= contrastRatio(hex, DOCUMENT_INK) ? "#ffffff" : DOCUMENT_INK;
}

/**
 * Цвет для тонких линий и маркеров на белом листе: фирменный, а если он
 * слишком светлый (жёлтый, пастель) — затемнённый до контраста `min` с
 * белым, иначе полоса толщиной в миллиметр пропадает на бумаге.
 */
export function brandInk(hex: string, min = 3): string {
  const base = hexToRgb(hex);
  for (let step = 0; step <= 20; step += 1) {
    const k = 1 - step * 0.05;
    const candidate = rgbToHex([base[0] * k, base[1] * k, base[2] * k]);
    if (contrastRatio(candidate, "#ffffff") >= min) return candidate;
  }
  return DOCUMENT_INK;
}

/** Светлая подложка из фирменного цвета: доля цвета `amount` поверх белого. */
export function brandTint(hex: string, amount = 0.12): Rgb {
  const [r, g, b] = hexToRgb(hex);
  const mix = (c: number) => Math.round(255 - (255 - c) * amount);
  return [mix(r), mix(g), mix(b)];
}

/**
 * Палитра акцента документа. `color: null` — организация цвет не задавала:
 * ч/б документы остаются ч/б, а листы с цветом WeSetup берут `fallback`.
 */
export type BrandPalette = {
  /** Заливка (маркеры, полоса). */
  fill: string;
  /** Текст поверх заливки. */
  onFill: string;
  /** Тонкие линии и акцентный текст на белом. */
  ink: string;
  /** Светлая подложка (шапки таблиц). */
  tint: string;
};

export function brandPalette(color: string | null | undefined, fallback = WESETUP_ACCENT): BrandPalette {
  const fill = normalizeBrandColor(color) ?? normalizeBrandColor(fallback) ?? WESETUP_ACCENT;
  return {
    fill,
    onFill: brandOnColor(fill),
    ink: brandInk(fill),
    tint: rgbToHex(brandTint(fill)),
  };
}
