import { createTranslator } from "use-intl/core";
import type { Locale } from "@/i18n/locales";
import ru from "@/i18n/messages/ru.json";
import en from "@/i18n/messages/en.json";
import uz from "@/i18n/messages/uz.json";
import { getAuditPlanDefaultConfig, getAuditPlanPrintDateLabel, type AuditPlanConfig } from "@/lib/audit-plan-document";
import { getDefaultAuditProtocolConfig } from "@/lib/audit-protocol-document";
import { normalizeUserRole } from "@/lib/user-roles";
import type { PersonDisplayUser } from "@/lib/approver-display";

type AuditPdfKey = keyof typeof ru.auditTraceabilityPdf;
export function auditPdfCopy(locale: Locale = "ru") {
  return createTranslator({ locale, messages: { ru, en, uz }[locale].auditTraceabilityPdf });
}
export function auditHas(source: unknown, field: string) {
  return Boolean(source && typeof source === "object" && !Array.isArray(source) && Object.hasOwn(source, field));
}
export function auditPdfTitle(value: string, key: "planTitle" | "protocolTitle" | "reportTitle" | "traceTitle", locale: Locale = "ru") {
  return value || auditPdfCopy(locale)(key);
}
export function auditDefault(value: string, source: unknown, field: string, key: AuditPdfKey, locale: Locale = "ru") {
  return locale !== "ru" && !auditHas(source, field) && value === auditPdfCopy("ru")(key) ? auditPdfCopy(locale)(key) : value;
}
export function auditTraceTitle(normalized: string, title: string, source: unknown, locale: Locale = "ru") {
  // Explicit config (including normalized empty/invalid values) keeps its original priority.
  if (auditHas(source, "documentTitle")) return normalized || title;
  return title || auditDefault(normalized, source, "documentTitle", "traceTitle", locale);
}
export function auditPlanValue(kind: "sections" | "rows" | "columns", item: { id: string; title?: string; text?: string }, source: unknown, locale: Locale = "ru") {
  const value = kind === "rows" ? item.text || "" : item.title || "";
  if (locale === "ru" || auditHas(source, kind)) return value;
  const defaults = getAuditPlanDefaultConfig();
  const index = defaults[kind].findIndex(candidate => candidate.id === item.id);
  const original = defaults[kind][index];
  if (!original || ("text" in original ? original.text : original.title) !== value) return value;
  const t = auditPdfCopy(locale);
  if (kind === "columns") return t("planColumn", { number: String(index + 1), organization: t("organization") });
  return t(`${kind === "rows" ? "planRow" : "planSection"}${index}` as AuditPdfKey);
}
export function auditProtocolSection(value: string, index: number, source: unknown, locale: Locale = "ru") {
  if (locale === "ru" || auditHas(source, "sections")) return value;
  return getDefaultAuditProtocolConfig().sections[index]?.title === value ? auditPdfCopy(locale)(`protocolSection${index}` as AuditPdfKey) : value;
}
export function auditSignatureValue(value: string, index: number, key: "leadAuditor" | "auditor", source: unknown, locale: Locale = "ru") {
  return index === 0 ? auditDefault(value, source, "signatures", key, locale) : value;
}
export function auditApproverRole(value: string, config: AuditPlanConfig, source: unknown, users: readonly PersonDisplayUser[] | undefined, locale: Locale = "ru") {
  if (locale === "ru") return value;
  const user = users?.find(candidate => candidate.id === config.approveEmployeeId?.trim());
  if (!user) return auditDefault(value, source, "approveRole", "manager", locale);
  if (user.positionTitle?.trim() || user.jobPosition?.name?.trim()) return value;
  const role = normalizeUserRole(user.role);
  return role === "manager" || role === "head_chef" || role === "cook" || role === "waiter" ? auditPdfCopy(locale)(role) : value;
}
export function auditApprovalDate(value: string, locale: Locale = "ru") {
  if (locale === "ru") return getAuditPlanPrintDateLabel(value);
  const [year, month, day] = value.split("-");
  if (!year || !month || !day) return value;
  const date = new Date(`${year}-${month}-${day}T00:00:00`);
  // Match the existing local-calendar parser, including its invalid-date behavior.
  const monthName = date.toLocaleDateString(locale === "en" ? "en-US" : "uz-Latn-UZ", { month: "long" });
  return auditPdfCopy(locale)("approvalDate", { day, month: monthName, year });
}
