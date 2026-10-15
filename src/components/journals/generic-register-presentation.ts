import type { useTranslations } from "next-intl";
import { formatDate, type Locale } from "@/i18n/locales";
import { presentDocumentTitle } from "@/i18n/journal-document-presentation";
import { presentJournalField } from "@/i18n/journal-presentation";
import { getRegisterJournal } from "@/lib/register-journals";

export type GenericRegisterTranslator = ReturnType<typeof useTranslations<"genericRegister">>;
type FieldCopy = { label: string; placeholder?: string; options?: Record<string, string> };
export type RegisterPresentationMessages = {
  journalFields: Record<string, Record<string, FieldCopy>>;
  journals: { names: Record<string, string> };
  genericRegister: { journals: Record<string, { hint: string; description: string; emptyDescription: string }> };
};
type DisplayField = { key: string; label: string; type: string; placeholder?: string; options?: { value: string; label: string }[] };

/** Display-only copy; callers keep the original arrays in draft/normalization dependencies. */
export function presentRegisterField<T extends DisplayField>(code: string, field: T, messages: RegisterPresentationMessages) {
  const original = getRegisterJournal(code)?.fields.find(candidate => candidate.key === field.key && candidate.type === field.type);
  const copy = original ? messages.journalFields[code]?.[field.key] : undefined;
  const options = Object.fromEntries((field.options ?? []).flatMap(option => {
    const source = original?.options?.find(candidate => candidate.value === option.value);
    const label = source?.label === option.label ? copy?.options?.[option.value] : undefined;
    return label === undefined ? [] : [[option.value, label]];
  }));
  return {
    ...presentJournalField(field, { label: (original?.label === field.label ? copy?.label : undefined) ?? field.label, options }),
    displayPlaceholder: original?.placeholder === field.placeholder ? copy?.placeholder ?? field.placeholder : field.placeholder,
  };
}

export function registerDate(value: string, locale: Locale) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return value;
  return formatDate(locale, date, "UTC", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function registerCell(code: string, field: DisplayField, value: string, locale: Locale, messages: RegisterPresentationMessages) {
  if (field.type === "date") return registerDate(value, locale);
  if (field.type === "select") return presentRegisterField(code, field, messages).displayOptions?.find(option => option.value === value)?.label ?? value;
  return value;
}

export function registerName(code: string, original: string, messages: RegisterPresentationMessages) {
  return original === getRegisterJournal(code)?.name ? messages.journals.names[code] ?? original : original;
}

export function registerTitle(title: string, code: string, dateFrom: string, dateTo: string, locale: Locale, messages: RegisterPresentationMessages, t: GenericRegisterTranslator) {
  const journal = getRegisterJournal(code);
  if (!journal) return title;
  return presentDocumentTitle({ title, templateCode: code, sourceNames: [journal.name], localizedName: messages.journals.names[code] ?? journal.name, dateFrom, dateTo, locale, formatTitle: (name, period) => t("document.generatedTitle", { name, period }) });
}
