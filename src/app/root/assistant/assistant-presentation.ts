import type { Locale } from "@/i18n/locales";

/** Exact host-zone numeric profile; persisted timestamps and native invalid dates stay unchanged. */
export function formatAssistantDate(date: Date, locale: Locale): string {
  const nativeLocale = locale === "ru" ? "ru-RU" : locale === "en" ? "en-GB" : "uz-Latn-UZ";
  return date.toLocaleString(locale === "uz" && Number.isFinite(date.getTime()) ? "en-GB" : nativeLocale);
}

/** Only failed application responses reach this adapter; arbitrary Zod/provider prose stays hidden. */
export function assistantSaveErrorKey(value: unknown) {
  return value === "Некорректные данные" ? "invalidData" : "saveFailed";
}
