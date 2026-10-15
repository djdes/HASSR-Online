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
  return new Intl.NumberFormat(FORMAT_LOCALES[locale], options).format(value);
}

export function formatDate(locale: Locale, value: Date | number, timeZone: string, options?: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat(FORMAT_LOCALES[locale], { ...options, timeZone }).format(value);
}
