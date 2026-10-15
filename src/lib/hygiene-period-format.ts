import { FORMAT_LOCALES, type Locale } from "@/i18n/locales";
import { coerceUtcDate } from "@/lib/hygiene-document";

/** Format date-only document bounds without shifting their calendar date by viewer timezone. */
export function formatHygienePeriodBounds(
  dateFrom: Date | string,
  dateTo: Date | string,
  locale: Locale,
) {
  const format = new Intl.DateTimeFormat(FORMAT_LOCALES[locale], {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
  return {
    from: format.format(coerceUtcDate(dateFrom)),
    to: format.format(coerceUtcDate(dateTo)),
  };
}
