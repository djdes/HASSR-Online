import { createTranslator } from "use-intl/core";
import { FORMAT_LOCALES, type Locale } from "@/i18n/locales";
import ru from "@/i18n/messages/ru.json";
import en from "@/i18n/messages/en.json";
import uz from "@/i18n/messages/uz.json";
import { DEFAULT_EXAMINATIONS, DEFAULT_VACCINATIONS, EXAMINATION_REFERENCE_DATA, MED_BOOK_PRELIMINARY_PERIODIC_ROWS, VACCINATION_REFERENCE_DATA } from "@/lib/med-book-document";
import { MONTH_KEYS, MONTH_LABELS } from "@/lib/equipment-maintenance-document";
import { getPpeIssuanceRecipientLabel, type PpeIssuanceRow } from "@/lib/ppe-issuance-document";
import { normalizeUserRole } from "@/lib/user-roles";
import type { PersonDisplayUser } from "@/lib/approver-display";

export type PersonnelPdfKey = keyof typeof ru.personnelMaintenancePdf;
export function personnelPdfCopy(locale: Locale = "ru") {
  return createTranslator({ locale, messages: { ru, en, uz }[locale].personnelMaintenancePdf });
}

/** Presence, not value equality, controls provenance. Explicit empty/invalid values remain explicit. */
export function personnelSourceHas(source: unknown, key: string) {
  return Boolean(source && typeof source === "object" && !Array.isArray(source) && Object.hasOwn(source, key));
}

export function personnelPdfTitle(value: string, key: "medTitle" | "planTitle" | "staffTitle" | "ppeTitle" | "maintenanceTitle", locale: Locale = "ru") {
  return value || personnelPdfCopy(locale)(key);
}

const examIds = ["gynecologist", "dentist", "psychiatrist", "ent", "physician", "neurologist", "addiction", "dermatologist", "helminths", "occupational", "fluorography", "staphylococcus", "dysentery", "typhoid", "hygieneTraining"] as const;
const defaultExamIds = ["gynecologist", "dentist", "psychiatrist", "ent", "physician", "neurologist", "addiction", "dermatologist", "fluorography", "mammography"] as const;
const vaccineIds = ["diphtheria", "measles", "sonne", "rubella", "hepatitisB", "hepatitisA", "influenza", "coronavirus"] as const;
const comparisonIds = ["bmi", "blood", "urine", "ecg", "pressure", "chest", "specialists", "gynecology", "mammography"] as const;

export function personnelMedColumn(kind: "examinations" | "vaccinations", value: string, source: unknown, locale: Locale = "ru") {
  if (locale === "ru" || personnelSourceHas(source, kind)) return value;
  const index = (kind === "examinations" ? DEFAULT_EXAMINATIONS : DEFAULT_VACCINATIONS).indexOf(value);
  if (index < 0) return value;
  const key = kind === "examinations" ? `exam_${defaultExamIds[index]}` : `vaccine_${vaccineIds[index]}`;
  return personnelPdfCopy(locale)(key as PersonnelPdfKey);
}

export function personnelMedComparisons(locale: Locale = "ru") {
  const t = personnelPdfCopy(locale);
  return MED_BOOK_PRELIMINARY_PERIODIC_ROWS.map((row, index) => locale === "ru" ? [row.preliminary, row.periodic] : [t(`preliminary_${comparisonIds[index]}` as PersonnelPdfKey), t(`periodic_${comparisonIds[index]}` as PersonnelPdfKey)]);
}
export function personnelExamReferences(locale: Locale = "ru") {
  const t = personnelPdfCopy(locale);
  return EXAMINATION_REFERENCE_DATA.map((row, index) => locale === "ru" ? [row.name, row.periodicity, row.note || "—"] : [t(`exam_${examIds[index]}` as PersonnelPdfKey), t(`examFrequency_${examIds[index]}` as PersonnelPdfKey), row.note ? t(`examNote_${examIds[index]}` as PersonnelPdfKey) : row.note || "—"]);
}
export function personnelVaccineReferences(locale: Locale = "ru") {
  const t = personnelPdfCopy(locale);
  return VACCINATION_REFERENCE_DATA.map((row, index) => locale === "ru" ? [row.name, row.periodicity] : [t(`vaccineReference_${vaccineIds[index]}` as PersonnelPdfKey), t(`vaccineFrequency_${vaccineIds[index]}` as PersonnelPdfKey)]);
}

export function personnelMonth(key: string, locale: Locale = "ru") {
  const index = MONTH_KEYS.indexOf(key as typeof MONTH_KEYS[number]);
  if (locale === "ru" || index < 0) return MONTH_LABELS[key] ?? key;
  return new Intl.DateTimeFormat(FORMAT_LOCALES[locale], { month: "short", timeZone: "UTC" }).format(new Date(Date.UTC(2000, index, 1))).replace(/\.$/, "");
}

export function personnelApprovalDate(dateKey: string, year: number, original: string, locale: Locale = "ru") {
  if (locale === "ru") return original;
  const day = String(dateKey || "").slice(8, 10);
  const index = Number(String(dateKey || "").slice(5, 7)) - 1;
  const month = index >= 0 && index <= 11 ? new Intl.DateTimeFormat(FORMAT_LOCALES[locale], { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2000, index, 1))) : "";
  const dateYear = /^\d{4}-\d{2}-\d{2}$/.test(String(dateKey || "")) ? dateKey.slice(0, 4) : String(year);
  return personnelPdfCopy(locale)("approvalDate", { day, month, year: dateYear });
}

/** A matched live person's explicit job title always wins over enum presentation. */
export function personnelRole(value: string, user: Partial<PersonDisplayUser> | undefined, locale: Locale = "ru") {
  if (locale === "ru" || !user || user.jobPosition?.name?.trim() || user.positionTitle?.trim()) return value;
  const role = normalizeUserRole(user.role);
  return role === "manager" || role === "head_chef" || role === "cook" || role === "waiter" ? personnelPdfCopy(locale)(role) : value;
}

export function personnelInjectedRole(value: string, field: string, source: unknown, boundId: string | null | undefined, defaultKey: "manager" | "head_chef", locale: Locale = "ru") {
  if (locale === "ru" || boundId || personnelSourceHas(source, field)) return value;
  return value === personnelPdfCopy("ru")(defaultKey) ? personnelPdfCopy(locale)(defaultKey) : value;
}

export function personnelPlanTopic(topic: { id: string; name: string }, source: unknown, locale: Locale = "ru") {
  if (locale === "ru" || personnelSourceHas(source, "topics")) return topic.name;
  const id = topic.id;
  if (id !== "kkt" && id !== "sanitation" && id !== "duties" && id !== "safety" && id !== "fire") return topic.name;
  return topic.name === personnelPdfCopy("ru")(id) ? personnelPdfCopy(locale)(id) : topic.name;
}
export function personnelPlanPosition(row: { id: string; positionName: string }, source: unknown, locale: Locale = "ru") {
  if (locale === "ru" || personnelSourceHas(source, "rows")) return row.positionName;
  const role = ({ "row-1": "head_chef", "row-2": "cook", "row-3": "waiter" } as const)[row.id as "row-1" | "row-2" | "row-3"];
  return role && row.positionName === personnelPdfCopy("ru")(role) ? personnelPdfCopy(locale)(role) : row.positionName;
}

export function personnelPpeRecipient(row: PpeIssuanceRow, users: readonly PersonDisplayUser[], locale: Locale = "ru") {
  const original = getPpeIssuanceRecipientLabel(row, [...users]);
  const user = users.find(item => item.id === row.recipientUserId);
  if (locale === "ru" || !user || user.positionTitle?.trim() || user.jobPosition?.name?.trim()) return original;
  const title = personnelRole("", user, locale), name = user.name || row.recipientName || "";
  if (original === name) return original;
  return title ? [title === name ? "" : title, name].filter(Boolean).join(", ") : original;
}
