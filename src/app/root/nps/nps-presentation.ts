import { FORMAT_LOCALES, formatDate, type Locale } from "@/i18n/locales";

/** Russian output is an explicit compatibility contract for this existing report. */
export function formatNpsTimestamp(date: Date, locale: Locale, invalidLabel: string): string {
  if (locale === "ru") return date.toLocaleString("ru-RU");
  if (!Number.isFinite(date.getTime())) return invalidLabel;

  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const dateText = formatDate(locale, date, timeZone, {
    year: "numeric",
    month: "numeric",
    day: "numeric",
  });
  const timeText = new Intl.DateTimeFormat(FORMAT_LOCALES[locale], {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).format(date);
  return `${dateText} ${timeText}`;
}
