import { formatDate, type Locale } from "@/i18n/locales";
import { coerceUtcDate } from "@/lib/hygiene-document";

/** Format date-only document bounds without shifting their calendar date by viewer timezone. */
export function formatHygienePeriodBounds(
  dateFrom: Date | string,
  dateTo: Date | string,
  locale: Locale,
) {
  const format = (value: Date) => formatDate(locale, value, "UTC", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  return {
    from: format(coerceUtcDate(dateFrom)),
    to: format(coerceUtcDate(dateTo)),
  };
}
