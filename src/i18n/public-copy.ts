import type { SiteLocale } from "./site-locale";
import { PUBLIC_EN } from "./public-en";

/** API errors are product copy; unknown errors use an explicit localized fallback. */
export function publicError(locale: SiteLocale, message: unknown, fallback: string): string {
  if (typeof message !== "string" || !message.trim()) return publicCopyFor(locale)(fallback);
  if (locale === "ru") return message;
  return PUBLIC_EN[message.trim()] ?? publicCopyFor(locale)(fallback);
}

/** Product-owned copy only. Never pass customer records or review bodies here. */
export function publicCopyFor(locale: SiteLocale) {
  return (source: string): string => {
    if (locale === "ru") return source;
    const key = source.trim();
    const translated = PUBLIC_EN[key];
    if (translated === undefined) return source;
    return source.slice(0, source.indexOf(key)) + translated + source.slice(source.indexOf(key) + key.length);
  };
}
