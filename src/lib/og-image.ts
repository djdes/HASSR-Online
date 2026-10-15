/**
 * Адреса OG-картинок под страницу — чистые функции для метаданных и JSON-LD.
 * Картинку рисует маршрут `/og` (ImageResponse), здесь только URL и текст.
 */
import { isLocale, type Locale } from "@/i18n/locales";

export const OG_KINDS = ["page", "article", "journal", "feature", "landing", "changelog", "glossary", "compare", "calc"] as const;
export type OgKind = (typeof OG_KINDS)[number];
type OgInput = { title: string; subtitle?: string | null; kind?: OgKind; locale?: Locale };

const SITE = "https://wesetup.ru";

export function clampOgText(value: string | null | undefined, max: number): string {
  const text = (value ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

export function ogImageUrl(input: OgInput): string {
  const params = new URLSearchParams();
  params.set("t", clampOgText(input.title, 90));
  const subtitle = clampOgText(input.subtitle, 140);
  if (subtitle) params.set("s", subtitle);
  if (input.kind && input.kind !== "page") params.set("k", input.kind);
  if (isLocale(input.locale)) params.set("l", input.locale);
  return `${SITE}/og/image?${params.toString()}`;
}

export function ogImages(input: OgInput) {
  return [{ url: ogImageUrl(input), width: 1200, height: 630, alt: clampOgText(input.title, 90) }];
}

export function twitterImages(input: OgInput) {
  return [ogImageUrl(input)];
}
