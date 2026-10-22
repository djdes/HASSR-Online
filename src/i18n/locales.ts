import { formatCalendarDate } from "./calendar-date";

export const LOCALES = ["ru", "en", "uz"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "ru";
export const LOCALE_NAMES: Record<Locale, string> = {
  ru: "Русский",
  en: "English",
  uz: "O‘zbekcha",
};

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
  ru: "ru-RU", en: "en-GB", uz: "uz-Latn-UZ",
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
