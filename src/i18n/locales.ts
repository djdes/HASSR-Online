import { formatCalendarDate } from "./calendar-date";

export const LOCALES = ["ru", "en", "uz", "tg", "hy", "ky", "de", "fr"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "ru";
export const LOCALE_NAMES: Record<Locale, string> = {
  ru: "Русский",
  en: "English",
  uz: "O‘zbekcha",
  tg: "Тоҷикӣ",
  hy: "Հայերեն",
  ky: "Кыргызча",
  de: "Deutsch",
  fr: "Français",
};

/** Языки с полным ручным словарём; для остальных — `fallbackLocale`. */
export const BASE_LOCALES = ["ru", "en", "uz"] as const;
export type BaseLocale = (typeof BASE_LOCALES)[number];

/**
 * Язык, текстами которого закрываются ещё не переведённые строки и
 * контент, существующий только на ru/en/uz (статьи, FAQ, PDF-шаблоны).
 * Таджикский, армянский и киргизский — русский (его в этих странах знают),
 * немецкий и французский — английский.
 */
export const FALLBACK_LOCALE: Record<Locale, BaseLocale> = {
  ru: "ru", en: "en", uz: "uz", tg: "ru", hy: "ru", ky: "ru", de: "en", fr: "en",
};

export function baseLocale(locale: Locale): BaseLocale {
  return FALLBACK_LOCALE[locale] ?? "ru";
}

/**
 * Языки, которые предлагаем выбрать. 05.11.2026 узбекский убрали в резерв
 * («пока только русский и английский»); 22.11.2026 владелец вернул его в
 * переключатель («узбекского языка нет»): тексты, адреса /uz и сохранённый
 * выбор всё это время работали.
 */
export const OFFERED_LOCALES: readonly Locale[] = ["ru", "en", "uz", "tg", "hy", "ky", "de", "fr"];

/** Языки для переключателя; уже выбранный резервный язык не теряется из списка. */
export function offeredLocales(current?: Locale | null): Locale[] {
  return LOCALES.filter((locale) => OFFERED_LOCALES.includes(locale) || locale === current);
}

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/** An explicit public URL wins; cookies never override an authenticated user. */
export function resolveLocale(input: {
  publicLocale?: unknown;
  authenticated?: boolean;
  userLocale?: unknown;
  cookieLocale?: unknown;
  organizationLocale?: unknown;
}): Locale {
  if (isLocale(input.publicLocale)) return input.publicLocale;
  const personal = input.authenticated ? input.userLocale : input.cookieLocale;
  if (isLocale(personal)) return personal;
  return isLocale(input.organizationLocale) ? input.organizationLocale : DEFAULT_LOCALE;
}

/** Do not infer business timezone or currency from interface language. */
export const FORMAT_LOCALES: Record<Locale, string> = {
  ru: "ru-RU", en: "en-GB", uz: "uz-Latn-UZ", tg: "tg-TJ", hy: "hy-AM", ky: "ky-KG", de: "de-DE", fr: "fr-FR",
};

export function formatNumber(locale: Locale, value: number, options?: Intl.NumberFormatOptions) {
  const formatter = new Intl.NumberFormat(FORMAT_LOCALES[locale], options);
  if (locale !== "uz" || !Number.isFinite(value)) return formatter.format(value);
  // Keep Uzbek words and options while using consistent decimal separators.
  return formatter.formatToParts(value).map((part) =>
    part.type === "group" ? "\u00a0" : part.type === "decimal" ? "," : part.value
  ).join("");
}

export function formatDate(locale: Locale, value: Date | number, timeZone: string, options?: Intl.DateTimeFormatOptions) {
  return formatCalendarDate(FORMAT_LOCALES[locale], value, timeZone, options);
}
