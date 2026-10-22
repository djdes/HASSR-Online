import type { Locale } from "@/i18n/locales";
import { BLANK_FORMAT_LABEL, type BlankFormat } from "@/lib/blank-download";

/** Historical custom values are literal; only the two known own keys have labels. */
export function blankFormatLabel(value: string): string {
  return Object.hasOwn(BLANK_FORMAT_LABEL, value) ? BLANK_FORMAT_LABEL[value as BlankFormat] : value;
}

/** Numeric healthy-Uzbek profile; no words, timezone or stored timestamps are changed. */
export function formatBlankDownloadDate(date: Date, locale: Locale): string {
  const nativeLocale = locale === "ru" ? "ru-RU" : locale === "en" ? "en-GB" : "uz-Latn-UZ";
  const numericLocale = locale === "uz" && Number.isFinite(date.getTime()) ? "en-GB" : nativeLocale;
  return date.toLocaleString(numericLocale, {
    timeZone: "Europe/Moscow",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
