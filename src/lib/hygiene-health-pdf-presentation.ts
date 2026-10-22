import { createTranslator } from "use-intl/core";
import { formatDate, type Locale } from "@/i18n/locales";
import ru from "@/i18n/messages/ru.json";
import en from "@/i18n/messages/en.json";
import uz from "@/i18n/messages/uz.json";
import { coerceUtcDate, formatMonthLabel, getWeekdayShort, HYGIENE_DEMO_TEAM_V2, type HygieneRosterUser, type HygieneStatus } from "@/lib/hygiene-document";
import { normalizeUserRole } from "@/lib/user-roles";

export function hygieneHealthPdfCopy(locale: Locale = "ru") {
  return createTranslator({ locale, messages: { ru, en, uz }[locale].hygieneHealthPdf });
}

/** Explicit document titles are customer data, even when identical to a built-in. */
export function hygieneHealthPdfTitle(title: string, kind: "hygiene" | "health_check", locale: Locale = "ru") {
  return title || hygieneHealthPdfCopy(locale)(kind === "hygiene" ? "hygieneTitle" : "healthTitle");
}

export function hygieneHealthPdfMonth(from: Date | string, to: Date | string, locale: Locale = "ru") {
  if (locale === "ru") return formatMonthLabel(from, to);
  const start = coerceUtcDate(from), end = coerceUtcDate(to);
  if (start.getUTCFullYear() !== end.getUTCFullYear() || start.getUTCMonth() !== end.getUTCMonth()) return formatMonthLabel(from, to);
  return formatDate(locale, start, "UTC", { month: "long", year: "numeric" });
}

export function hygieneHealthPdfWeekday(dateKey: string, locale: Locale = "ru") {
  return locale === "ru" ? getWeekdayShort(dateKey) : formatDate(locale, new Date(`${dateKey}T00:00:00Z`), "UTC", { weekday: "short" }).replace(/\.$/, "");
}

export function hygieneHealthPdfStatus(status: HygieneStatus | null | undefined, locale: Locale = "ru") {
  const keys = { healthy: "healthyCode", day_off: "dayOffCode", sick_leave: "sickLeaveCode", suspended: "suspendedCode", vacation: "vacationCode" } as const;
  return status && Object.hasOwn(keys, status) ? hygieneHealthPdfCopy(locale)(keys[status]) : "";
}

/** Preserve explicit positions and demo-email overrides; project only the role fallback. */
export function hygieneHealthPdfPosition(user: HygieneRosterUser | undefined, original: string, locale: Locale = "ru") {
  if (!user || locale === "ru" || user.positionTitle || HYGIENE_DEMO_TEAM_V2.some(member => user.email && member.email === user.email)) return original;
  const role = normalizeUserRole(user.role);
  const t = hygieneHealthPdfCopy(locale);
  if (role === "manager" || role === "head_chef" || role === "cook" || role === "waiter") return t(role);
  return role ? original : t("employeeFallback");
}
