export function sanitationMonthShortLabel(monthIndex: number, locale: string): string {
  const formatLocale = locale === "uz" ? "uz-Latn-UZ" : locale;
  return new Intl.DateTimeFormat(formatLocale, {
    month: "short",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(2024, monthIndex, 1)));
}

/** Translate only the application-provided default; preserve custom/saved titles. */
export function sanitationRoleDisplayTitle(title: string, translatedDefault: string): string {
  return title === "Управляющий" ? translatedDefault : title;
}
