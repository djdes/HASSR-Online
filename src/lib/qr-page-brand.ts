/**
 * Стиль страниц, которые сотрудник открывает по QR-наклейке (владелец,
 * 2026-11-21: фирменный стиль «глобальнее по сайту»): наклейка уже в цветах
 * и с логотипом компании — страница продолжает их, а не показывает шапку
 * WeSetup. Тот же акцент — у кабинета, если включён «Кабинет в цветах
 * компании» (`(dashboard)/layout.tsx`).
 *
 * Чистые функции, без БД и DOM.
 */

import { brandInk, hexToRgb, normalizeBrandColor, rgbToHex } from "@/lib/document-brand";
import { ORG_LOGO_PATH_PATTERN } from "@/lib/org-logo-file";

/** Белый текст на кнопках и шапке в цвете компании — не ниже WCAG AA. */
export const BRAND_ACCENT_MIN_CONTRAST = 4.5;

export type BrandAccent = { accent: string; hover: string };

/**
 * Акцент из основного цвета компании: тот же цвет, а если он светлый —
 * затемнённый до контраста ≥ 4,5:1 с белым текстом; наведение — темнее.
 */
export function brandAccent(color: string | null | undefined): BrandAccent | null {
  const hex = normalizeBrandColor(color);
  if (!hex) return null;
  const accent = brandInk(hex, BRAND_ACCENT_MIN_CONTRAST);
  const hover = rgbToHex(hexToRgb(accent).map((channel) => channel * 0.88) as [number, number, number]);
  return { accent, hover };
}

export type QrPageBrand = {
  logoUrl: string | null;
  accent: string | null;
  accentHover: string | null;
};

/** Логотип для страницы: загруженный файл или https-ссылка. */
function safeLogoUrl(raw: string | null | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  if (ORG_LOGO_PATH_PATTERN.test(value)) return value;
  return /^https:\/\/[^\s"'<>]+$/i.test(value) ? value : null;
}

/** Стиль QR-страницы организации; ничего не задано — `null`, шапка WeSetup. */
export function qrPageBrand(org: { logoUrl: string | null; brandColor: string | null }): QrPageBrand | null {
  const logoUrl = safeLogoUrl(org.logoUrl);
  const accent = brandAccent(org.brandColor);
  if (!logoUrl && !accent) return null;
  return { logoUrl, accent: accent?.accent ?? null, accentHover: accent?.hover ?? null };
}
