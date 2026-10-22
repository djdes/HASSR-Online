import { formatCalendarDate } from "@/i18n/calendar-date";
import { FORMAT_LOCALES, type Locale } from "@/i18n/locales";

export type PresentedStatusTimestamp =
  | { kind: "native"; text: string }
  | { kind: "localized"; date: string; time: string }
  | { kind: "invalid" };

/**
 * Keep the historical Russian native display, including host timezone,
 * seconds and Invalid Date. For valid EN/UZ values, stabilize only the
 * calendar date across ICU implementations and retain the host timezone.
 */
export function presentStatusTimestamp(value: string, locale: Locale): PresentedStatusTimestamp {
  const date = new Date(value);
  if (locale === "ru") return { kind: "native", text: date.toLocaleString("ru-RU") };
  if (!Number.isFinite(date.getTime())) return { kind: "invalid" };

  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const formattedDate = formatCalendarDate(FORMAT_LOCALES[locale], date, timeZone, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const formattedTime = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    numberingSystem: "latn",
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
  return { kind: "localized", date: formattedDate, time: formattedTime };
}
