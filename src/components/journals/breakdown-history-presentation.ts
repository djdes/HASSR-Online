import type { useTranslations } from "next-intl";
import { formatDate, type Locale } from "@/i18n/locales";
import { presentDocumentTitle } from "@/i18n/journal-document-presentation";
import { BREAKDOWN_HISTORY_DOCUMENT_TITLE, type BreakdownRow } from "@/lib/breakdown-history-document";

export type BreakdownTranslator = ReturnType<typeof useTranslations<"breakdownHistory">>;

export function breakdownDate(value: string, locale: Locale) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return value;
  return formatDate(locale, date, "UTC", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function breakdownTime(hour: string, minute: string) {
  return `${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;
}

export function breakdownEnd(row: BreakdownRow, locale: Locale) {
  if (!row.endDate) return "";
  const date = breakdownDate(row.endDate, locale);
  if (!row.endHour && !row.endMinute) return date;
  return `${date} ${breakdownTime(row.endHour || "00", row.endMinute || "00")}`;
}

export function breakdownTitle(title: string, dateFrom: string, locale: Locale, t: BreakdownTranslator) {
  return presentDocumentTitle({ title, templateCode: "breakdown_history", sourceNames: [BREAKDOWN_HISTORY_DOCUMENT_TITLE], localizedName: t("title"), dateFrom, dateTo: dateFrom, locale, formatTitle: (name, period) => t("generatedTitle", { name, period }) });
}
