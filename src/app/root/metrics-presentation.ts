import type { useTranslations } from "next-intl";
import type { Messages } from "@/i18n/messages";
import type { Locale } from "@/i18n/locales";
import { FORMAT_LOCALES } from "@/i18n/locales";
import { ACTIVE_JOURNAL_CATALOG } from "@/lib/journal-catalog";
import { JOURNAL_TITLE_RENAMES } from "@/lib/journal-title-renames";

export type RootMetricsCopy = ReturnType<typeof useTranslations<"rootMetrics">>;
export type JournalSourceNames = Record<string, string>;

/** Locale changes wording only; preserve the existing local calendar/timezone basis. */
export function metricsDate(value: string, locale: Locale, options?: Intl.DateTimeFormatOptions, dateOnly = false) {
  const date = new Date(value);
  return dateOnly ? date.toLocaleDateString(FORMAT_LOCALES[locale], options) : date.toLocaleString(FORMAT_LOCALES[locale], options);
}

export function formatMetricsRelative(date: Date, now: number, t: RootMetricsCopy): string {
  const hours = Math.floor((now - date.getTime()) / (60 * 60 * 1000));
  if (hours < 1) return t("relative.justNow");
  if (hours < 24) return t("relative.hours", { count: hours });
  const days = Math.floor(hours / 24);
  if (days < 30) return t("relative.days", { count: days });
  return t("relative.months", { count: Math.floor(days / 30) });
}

export function metricsPlanLabel(plan: string, t: RootMetricsCopy) {
  const known = { free: "plans.free", trial: "plans.trial", standard: "plans.standard", premium: "plans.premium", paid: "plans.paid", pro: "plans.pro" } as const;
  return Object.hasOwn(known, plan) ? t(known[plan as keyof typeof known]) : plan;
}

/** Activity APIs supply source template names, but no custom-name provenance flag. */
export function metricsJournalName(locale: Locale, code: string, source: string, names: Messages["journals"]["names"], sourceNames: JournalSourceNames) {
  if (locale === "ru" || !Object.hasOwn(names, code)) return source;
  const catalog = ACTIVE_JOURNAL_CATALOG.find(item => item.code === code);
  const renamed = JOURNAL_TITLE_RENAMES.find(item => item.code === code);
  const known = sourceNames[code] === source || catalog?.name === source || renamed?.title === source || renamed?.legacyTitles.includes(source);
  return known ? names[code as keyof typeof names] : source;
}
