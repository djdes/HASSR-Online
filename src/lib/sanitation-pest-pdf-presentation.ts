import { createTranslator } from "use-intl/core";
import type { Locale } from "@/i18n/locales";
import ru from "@/i18n/messages/ru.json";
import en from "@/i18n/messages/en.json";
import uz from "@/i18n/messages/uz.json";
import { defaultSdcConfig } from "@/lib/sanitary-day-checklist-document";
import { getDefaultCleaningVentilationConfig } from "@/lib/cleaning-ventilation-checklist-document";
import { formatQuantityWithUnit, sumDisinfectantQuantities, MEASURE_UNIT_LABELS, type MeasureUnit } from "@/lib/disinfectant-document";
import { normalizeUserRole } from "@/lib/user-roles";

export type SanitationPdfKey = keyof typeof ru.sanitationPestPdf;
export function sanitationPdfCopy(locale: Locale = "ru") {
  return createTranslator({ locale, messages: { ru, en, uz }[locale].sanitationPestPdf });
}
export function sanitationHas(source: unknown, key: string) {
  return Boolean(source && typeof source === "object" && !Array.isArray(source) && Object.hasOwn(source, key));
}
export function sanitationTitle(title: string, key: "pestTitle" | "equipmentTitle" | "glassTitle" | "disinfectantTitle" | "ventilationTitle" | "sanitaryTitle", locale: Locale = "ru") {
  return title || sanitationPdfCopy(locale)(key);
}
export function sanitationDefault(value: string, source: unknown, field: string, key: SanitationPdfKey, locale: Locale = "ru") {
  return locale !== "ru" && !sanitationHas(source, field) && value === sanitationPdfCopy("ru")(key) ? sanitationPdfCopy(locale)(key) : value;
}
type Person = { role?: string | null; positionTitle?: string | null; jobPosition?: { name?: string | null } | null };
export function sanitationRole(value: string, user: Person | undefined, locale: Locale = "ru") {
  if (locale === "ru" || !user || user.positionTitle?.trim() || user.jobPosition?.name?.trim()) return value;
  const role = normalizeUserRole(user.role);
  return role === "manager" || role === "head_chef" || role === "cook" || role === "waiter" ? sanitationPdfCopy(locale)(role) : value;
}
export function sanitationUnboundResponsible(value: string, item: { id: string; userId: string }, source: unknown, locale: Locale = "ru") {
  if (locale === "ru" || value !== "Сотрудник" || !source || typeof source !== "object" || Array.isArray(source)) return value;
  const rows = (source as { responsibles?: unknown }).responsibles;
  if (!Array.isArray(rows)) return value;
  const candidates = rows.filter(row => row && typeof row === "object" && row.userId === item.userId && (!Object.hasOwn(row, "id") || row.id === item.id));
  return candidates.length === 1 && !Object.hasOwn(candidates[0], "title") ? sanitationPdfCopy(locale)("employee") : value;
}
export function sanitationDescriptions(ventilation: boolean, locale: Locale = "ru") {
  const t = sanitationPdfCopy(locale);
  return (["description0", "description1", "description2", "description3"] as const).filter((_, index) => index !== 1 || ventilation).map(key => t(key)).join("\n\n");
}
export function sanitationFrequencies(ventilation: boolean, locale: Locale = "ru") {
  const t = sanitationPdfCopy(locale);
  return (["frequency0", "frequency1", "frequency2"] as const).filter((_, index) => index !== 1 || ventilation).map(key => t(key));
}
export function sanitationProcedure(procedure: { id: string; label: string }, source: unknown, locale: Locale = "ru") {
  if (locale === "ru" || sanitationHas(source, "procedures")) return procedure.label;
  const original = getDefaultCleaningVentilationConfig().procedures.find(item => item.id === procedure.id);
  return original && original.label === procedure.label ? sanitationPdfCopy(locale)(original.id) : procedure.label;
}
export function sanitationSdcValue(kind: "zones" | "items" | "generalPrinciples", value: string, id: string | undefined, index: number, source: unknown, locale: Locale = "ru") {
  if (locale === "ru" || sanitationHas(source, kind)) return value;
  const defaults = defaultSdcConfig();
  const original = kind === "zones" ? defaults.zones[index] : kind === "items" ? defaults.items[index] : undefined;
  if (kind === "generalPrinciples" ? defaults.generalPrinciples[index] !== value : !original || original.id !== id || ("name" in original ? original.name : original.text) !== value) return value;
  const prefix = kind === "zones" ? "zone" : kind === "items" ? "item" : "principle";
  return sanitationPdfCopy(locale)(`${prefix}${index}` as SanitationPdfKey);
}
export function sanitationQuantity(quantity: number, unit: MeasureUnit, locale: Locale = "ru") {
  const original = formatQuantityWithUnit(quantity, unit);
  if (locale === "ru" || !original) return original;
  const t = sanitationPdfCopy(locale);
  return original.slice(0, -MEASURE_UNIT_LABELS[unit].length) + t(unit);
}
export function sanitationQuantityTotal(rows: Array<{ quantity: number; unit: MeasureUnit }>, locale: Locale = "ru") {
  const original = sumDisinfectantQuantities(rows);
  if (locale === "ru") return original;
  const t = sanitationPdfCopy(locale);
  return original.replace(/ (кг\.|л\.|фл\.)(?= · |$)/g, (_, unit: string) => " " + t(unit === "кг." ? "kg" : unit === "л." ? "l" : "bottle"));
}
