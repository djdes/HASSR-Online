"use client";

import { confirmAsync } from "@/components/ui/confirm-async";
import { describeDateOutsidePeriod } from "@/lib/date-in-period";
import { isPerpetualDateTo } from "@/lib/journal-period";
import type { useTranslations } from "next-intl";
import { formatDate, type Locale } from "@/i18n/locales";

/**
 * Перед сохранением строки со свободной датой: если дата вне периода
 * документа — спросить через наш ConfirmDialog. Внутри периода (или без
 * даты/периода) — сразу `true`, окно не появляется.
 */
export async function confirmDateInPeriod(
  dateKey: string | null | undefined,
  period: { dateFrom?: string | null; dateTo?: string | null },
  presentation: { locale: Locale; t: ReturnType<typeof useTranslations<"journalControls.dateInPeriod">> }
): Promise<boolean> {
  const warning = describeDateOutsidePeriod(dateKey, period);
  if (!warning) return true;
  const { locale, t } = presentation;
  const date = (value: string | null | undefined) => {
    const day = String(value ?? "").slice(0, 10), parsed = new Date(`${day}T00:00:00.000Z`);
    return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== day ? day : formatDate(locale, parsed, "UTC", { day: "2-digit", month: "2-digit", year: "numeric" });
  };
  const to = String(period.dateTo ?? "").slice(0, 10);
  return confirmAsync({
    locale,
    title: t("title"),
    description: /^\d{4}-\d{2}-\d{2}$/.test(to) && !isPerpetualDateTo(to)
      ? t("rangeDescription", { date: date(dateKey), from: date(period.dateFrom), to: date(to) })
      : t("sinceDescription", { date: date(dateKey), from: date(period.dateFrom) }),
    bullets: [{ label: t("printWarning"), tone: "warn" }, { label: t("correctDate"), tone: "info" }],
    variant: "warn", confirmLabel: t("saveAnyway"),
  });
}
