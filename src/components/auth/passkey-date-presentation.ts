import { formatCalendarDate } from "@/i18n/calendar-date";
import type { Locale } from "@/i18n/locales";

/** Keep passkey timestamps in the viewer's host timezone and native RU/EN format. */
export function formatPasskeyDate(value: string, locale: Locale): string {
  const date = new Date(value);
  if (locale !== "uz" || Number.isNaN(date.getTime())) {
    return date.toLocaleDateString(locale);
  }
  return formatCalendarDate(
    "uz-Latn-UZ",
    date,
    new Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
}
