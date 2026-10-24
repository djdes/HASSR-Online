"use client";

import { useTranslations } from "next-intl";
import { TodayProgressStrip } from "@/components/journals/today-progress-strip";
import { COUNTS_UNBOUNDED_CODES } from "@/lib/daily-journal-codes";

/**
 * Полоса «Сегодня» для журналов с плавающим числом записей за смену.
 *
 * `TodayProgressStrip` считает «N из M», и это верно для матричных
 * журналов с фиксированным списком строк (сотрудники, холодильники,
 * помещения). Но у rolling-журналов — бракеражи, интенсивное охлаждение,
 * фритюр — заранее неизвестно, сколько записей будет за смену: по
 * `docs/JOURNAL-SPECS.md` это «5-50 раз/смену». Для них вопрос ровно
 * один: есть ли хоть одна запись за сегодня.
 *
 * Здесь это сводится к 1 из 1, так что зелёная плашка «Сегодня всё
 * заполнено» появляется по первой записи, а до неё висит напоминание.
 */
export function TodayStripForJournal({
  journalCode,
  todayCount,
  total,
  filled,
  label,
  onJumpToToday,
}: {
  journalCode: string;
  /** Сколько записей за сегодня уже есть (для rolling-журналов). */
  todayCount?: number;
  /** Сколько всего строк ожидается сегодня (для журналов с реестром). */
  total?: number;
  /** Сколько из них заполнено. */
  filled?: number;
  label?: string;
  onJumpToToday?: () => void;
}) {
  const t = useTranslations("journalUi.todayStrip");
  const unbounded = COUNTS_UNBOUNDED_CODES.has(journalCode);

  if (unbounded || total == null) {
    const has = (todayCount ?? 0) > 0;
    return (
      <TodayProgressStrip
        filled={has ? 1 : 0}
        total={1}
        label={label ?? t("defaultLabel")}
        onJumpToToday={onJumpToToday}
      />
    );
  }

  return (
    <TodayProgressStrip
      filled={filled ?? 0}
      total={total}
      label={label}
      onJumpToToday={onJumpToToday}
    />
  );
}
