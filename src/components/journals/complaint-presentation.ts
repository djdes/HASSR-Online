import type { useTranslations } from "next-intl";
import { formatDate, type Locale } from "@/i18n/locales";
import { presentDocumentTitle } from "@/i18n/journal-document-presentation";
import { COMPLAINT_RECEIPT_OPTIONS, COMPLAINT_REGISTER_TITLE } from "@/lib/complaint-document";
import type { RegisterDocumentRow, RegisterField } from "@/lib/register-document";

export type ComplaintTranslator = ReturnType<typeof useTranslations<"complaintRegister">>;
const receiptKeys = ["receipt.post", "receipt.phone", "receipt.fax", "receipt.email", "receipt.feedbackBook"] as const;
const fieldLabels = {
  receiptDate: "Дата поступления", applicantName: "ФИО заявителя", complaintReceiptForm: "Форма поступления жалобы",
  applicantDetails: "Реквизиты заявителя", complaintContent: "Содержание жалобы", decisionDate: "Дата решения", decisionSummary: "Решение, краткое содержание",
} as const;

export function complaintDate(value: string, locale: Locale) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return value;
  return formatDate(locale, date, "UTC", { day: "2-digit", month: "2-digit", year: "numeric" });
}
export function complaintReceipt(value: string, t: ComplaintTranslator) {
  const index = COMPLAINT_RECEIPT_OPTIONS.findIndex(option => option.value === value);
  return index < 0 ? value : t(receiptKeys[index]);
}
export function complaintFieldLabel(field: RegisterField, t: ComplaintTranslator) {
  const key = field.key as keyof typeof fieldLabels;
  return Object.hasOwn(fieldLabels, key) && field.label === fieldLabels[key] ? t(`fields.${key}`) : field.label;
}
export function complaintFieldOptions(field: RegisterField, t: ComplaintTranslator): RegisterField {
  if (field.key !== "complaintReceiptForm") return field;
  return { ...field, options: field.options.map(option => ({ ...option, label: option.label === option.value ? complaintReceipt(option.value, t) : option.label })) };
}
export function complaintDecision(row: RegisterDocumentRow, locale: Locale, t: ComplaintTranslator) {
  const date = complaintDate(row.values.decisionDate || "", locale), summary = row.values.decisionSummary || "";
  return date && summary ? t("decisionCell", { date, summary }) : date || summary;
}
export function complaintTitle(title: string, dateFrom: string, locale: Locale, t: ComplaintTranslator) {
  return presentDocumentTitle({ title, templateCode: "complaint_register", sourceNames: [COMPLAINT_REGISTER_TITLE], localizedName: t("title"), dateFrom, dateTo: dateFrom, locale, formatTitle: (name, period) => t("generatedTitle", { name, period }) });
}
