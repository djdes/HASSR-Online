import { createTranslator } from "use-intl/core";
import type { Locale } from "@/i18n/locales";
import ru from "@/i18n/messages/ru.json";
import en from "@/i18n/messages/en.json";
import uz from "@/i18n/messages/uz.json";
import { defaultUvSpecification, formatControlFrequencyLabel, type UvSpecification } from "@/lib/uv-lamp-runtime-document";

type TrackedUvKey = keyof typeof ru.trackedUvPdf;
export function trackedUvPdfCopy(locale: Locale = "ru") {
  return createTranslator({ locale, messages: { ru, en, uz }[locale].trackedUvPdf });
}
export function trackedPdfTitle(value: string, code: string, locale: Locale = "ru") {
  if (value) return value;
  const key = `tracked_${code}`;
  return trackedUvPdfCopy(locale)(Object.hasOwn(ru.trackedUvPdf, key) ? key as TrackedUvKey : "tracked_critical_limit_check");
}
export function trackedPdfBoolean(value: unknown, original: string, locale: Locale = "ru") {
  if (value == null || value === "") return original;
  return trackedUvPdfCopy(locale)(value === true || value === "true" || value === "yes" ? "yes" : "no");
}
function has(source: unknown, field: string) {
  return Boolean(source && typeof source === "object" && !Array.isArray(source) && Object.hasOwn(source, field));
}
function isAbsentSpecField(source: unknown, field: string) {
  if (!has(source, "spec")) return true;
  const spec = (source as { spec: unknown }).spec;
  // Explicit invalid spec is not proof of a source-owned default.
  return Boolean(spec && typeof spec === "object" && !Array.isArray(spec) && !has(spec, field));
}
export function uvPdfFreeText(value: string, source: unknown, field: "microorganismType" | "controlFrequency", locale: Locale = "ru") {
  const original = field === "controlFrequency" ? formatControlFrequencyLabel(value) : value;
  if (locale === "ru" || !isAbsentSpecField(source, field) || value !== defaultUvSpecification()[field]) return original;
  return trackedUvPdfCopy(locale)(field === "controlFrequency" ? "defaultFrequency" : "defaultMicroorganism");
}
export function uvPdfObject(spec: Pick<UvSpecification, "disinfectionAir" | "disinfectionSurface">, locale: Locale = "ru") {
  const t = trackedUvPdfCopy(locale);
  return spec.disinfectionAir && spec.disinfectionSurface ? t("objectBoth") : spec.disinfectionAir ? t("objectAir") : spec.disinfectionSurface ? t("objectSurface") : "—";
}
