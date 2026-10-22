import { createTranslator } from "use-intl/core";
import type { Locale } from "@/i18n/locales";
import ru from "@/i18n/messages/ru.json";
import en from "@/i18n/messages/en.json";
import uz from "@/i18n/messages/uz.json";
import { HYGIENE_DEMO_TEAM_V2, getHygieneUserPositionLabel, type HygieneRosterUser } from "@/lib/hygiene-document";
import { normalizeUserRole } from "@/lib/user-roles";

export type SpecializedPdfKey = keyof typeof ru.specializedHygieneGlassPdf;
export function specializedPdfCopy(locale: Locale = "ru") {
  return createTranslator({ locale, messages: { ru, en, uz }[locale].specializedHygieneGlassPdf });
}
export function specializedPdfTitle(value: string, kind: "hygiene" | "glass", locale: Locale = "ru") {
  return value || specializedPdfCopy(locale)(kind === "hygiene" ? "hygieneTitle" : "glassTitle");
}
export function specializedDefault(value: string, source: unknown, field: string, key: SpecializedPdfKey, locale: Locale = "ru") {
  const explicit = Boolean(source && typeof source === "object" && !Array.isArray(source) && Object.hasOwn(source, field));
  return locale !== "ru" && !explicit && value === specializedPdfCopy("ru")(key) ? specializedPdfCopy(locale)(key) : value;
}
export function specializedHygienePosition(user: HygieneRosterUser, locale: Locale = "ru") {
  // An explicit position is customer data, including a value identical to a demo default.
  if (user.positionTitle) return user.positionTitle;
  const original = getHygieneUserPositionLabel(user);
  if (locale === "ru") return original;
  const demo = HYGIENE_DEMO_TEAM_V2.findIndex(member => Boolean(user.email) && member.email === user.email);
  if (demo >= 0) return specializedPdfCopy(locale)(`demo${demo}` as SpecializedPdfKey);
  const role = normalizeUserRole(user.role);
  return role === "manager" || role === "head_chef" || role === "cook" || role === "waiter" ? specializedPdfCopy(locale)(role) : original;
}
export function specializedHygieneMark(value: string, locale: Locale = "ru") {
  return value === "✓" ? specializedPdfCopy(locale)("yes") : value === "✗" ? specializedPdfCopy(locale)("no") : value;
}
