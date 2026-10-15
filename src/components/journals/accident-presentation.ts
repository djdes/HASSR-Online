import type { useTranslations } from "next-intl";
import { formatDate, type Locale } from "@/i18n/locales";
import { presentDocumentTitle } from "@/i18n/journal-document-presentation";
import { ACCIDENT_DOCUMENT_TITLE } from "@/lib/accident-document";

export type AccidentTranslator = ReturnType<typeof useTranslations<"accidentJournal">>;
export function accidentDate(value: string, locale: Locale) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return value;
  return formatDate(locale, date, "UTC", { day: "2-digit", month: "2-digit", year: "numeric" });
}
export function accidentDateTime(value: string, hour: string, minute: string, locale: Locale) {
  return `${accidentDate(value, locale)}\n${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;
}
export function accidentTitle(title: string, dateFrom: string, locale: Locale, t: AccidentTranslator) {
  return presentDocumentTitle({ title, templateCode: "accident_journal", sourceNames: [ACCIDENT_DOCUMENT_TITLE], localizedName: t("title"), dateFrom, dateTo: dateFrom, locale, formatTitle: (name, period) => t("generatedTitle", { name, period }) });
}
