"use client";

import { useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { ChecklistAssignmentFrequency } from "@/lib/checklist-assignments";

/**
 * Подписи сроков и периодичности на языке интерфейса: «Сегодня до 12:00»,
 * «Каждый понедельник до 18:00». Дни — ключи `YYYY-MM-DD` по часам
 * организации; форматируем их как даты UTC, чтобы пояс браузера не сдвигал день.
 */
export function useChecklistFormat() {
  const locale = useLocale();
  const t = useTranslations("checklistPages.common");
  return useMemo(() => {
    const dayFormat = new Intl.DateTimeFormat(locale, { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });
    const weekdayFormat = new Intl.DateTimeFormat(locale, { weekday: "long", timeZone: "UTC" });
    const toUtc = (dayKey: string) => {
      const [y, m, d] = dayKey.split("-").map(Number);
      return new Date(Date.UTC(y, m - 1, d));
    };
    const day = (dayKey: string) => dayFormat.format(toUtc(dayKey));
    // 2024-01-01 — понедельник: 1 = пн … 7 = вс.
    const weekday = (n: number) => weekdayFormat.format(new Date(Date.UTC(2024, 0, n)));
    const dateTime = (iso: string, timeZone: string) => {
      try {
        return new Intl.DateTimeFormat(locale, { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone }).format(new Date(iso));
      } catch {
        return new Intl.DateTimeFormat(locale, { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
      }
    };
    return {
      day,
      weekday,
      dateTime,
      dueLabel: (dayKey: string, time: string, today: boolean) =>
        today ? t("dueToday", { time }) : t("dueOn", { date: day(dayKey), time }),
      schedule: (input: { frequency: ChecklistAssignmentFrequency; onceDate: string | null; weekday: number | null; monthDay: number | null; dueTime: string }) => {
        switch (input.frequency) {
          case "once":
            return t("schedule.once", { date: input.onceDate ? day(input.onceDate) : "—", time: input.dueTime });
          case "daily":
            return t("schedule.daily", { time: input.dueTime });
          case "weekly":
            return t("schedule.weekly", { weekday: input.weekday ? weekday(input.weekday) : "—", time: input.dueTime });
          case "monthly":
            return t("schedule.monthly", { day: String(input.monthDay ?? 1), time: input.dueTime });
        }
      },
    };
  }, [locale, t]);
}
