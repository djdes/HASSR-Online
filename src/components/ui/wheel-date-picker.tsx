"use client";

import { useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";

import { WheelColumn, type WheelOption } from "@/components/ui/wheel-picker";
import { cn } from "@/lib/utils";
import {
  buildDayOptions,
  clampDay,
  daysInMonth,
  isoDate,
  nearestEnabledIndex,
  parseIsoDate,
  weekdayIndex,
} from "@/lib/wheel-date";

/**
 * Выбор даты барабаном.
 *
 *   mode="full" — три колонки «день | месяц | год»; смена месяца или
 *                 года подрезает день (31 → 30/28).
 *   mode="day"  — одна колонка дней заданного месяца с днём недели:
 *                 «25 пт». Так выбирают дату уборки внутри месяца.
 *
 * Значение — строка `YYYY-MM-DD`. `maxDate` / `minDate` закрывают дни
 * вне диапазона; `disabledDays` (режим day) — дни, которые выбрать нельзя
 * по смыслу, с подписью `disabledNote` («в плане»); `markedDays` — точка
 * у дней, которые уже что-то значат.
 */
export type WheelDatePickerProps = {
  value: string;
  onChange: (iso: string) => void;
  mode?: "full" | "day";
  /** Режим day: год и месяц (0..11) колонки. */
  year?: number;
  month?: number;
  minYear?: number;
  maxYear?: number;
  maxDate?: string | null;
  minDate?: string | null;
  markedDays?: Iterable<number>;
  disabledDays?: Iterable<number>;
  disabledNote?: string;
  /** «Сегодня» — для кнопки быстрого выбора; по умолчанию дата браузера. */
  todayKey?: string;
  /** Показать «Готово» и что делать по нажатию. */
  onDone?: () => void;
  doneLabel?: string;
  className?: string;
};

/** Localised month names ("January") and weekday names, Sunday first. */
function localizedNames(locale: string) {
  const month = new Intl.DateTimeFormat(locale, { month: "long", timeZone: "UTC" });
  const weekday = new Intl.DateTimeFormat(locale, { weekday: "long", timeZone: "UTC" });
  const capitalize = (s: string) => s.charAt(0).toLocaleUpperCase(locale) + s.slice(1);
  return {
    months: Array.from({ length: 12 }, (_, i) => capitalize(month.format(Date.UTC(2024, i, 1)))),
    // 2024-01-07 is a Sunday.
    weekdays: Array.from({ length: 7 }, (_, i) => weekday.format(Date.UTC(2024, 0, 7 + i))),
  };
}

function browserTodayKey(): string {
  const now = new Date();
  return isoDate(now.getFullYear(), now.getMonth(), now.getDate());
}

export function WheelDatePicker({
  value,
  onChange,
  mode = "full",
  year: yearProp,
  month: monthProp,
  minYear,
  maxYear,
  maxDate,
  minDate,
  markedDays,
  disabledDays,
  disabledNote,
  todayKey,
  onDone,
  doneLabel,
  className,
}: WheelDatePickerProps) {
  const t = useTranslations("sharedUi.wheelDatePicker");
  const locale = useLocale();
  const { months: monthNames, weekdays: weekdayNames } = useMemo(() => localizedNames(locale), [locale]);
  const today = todayKey || browserTodayKey();
  const parsed = parseIsoDate(value) ?? parseIsoDate(today)!;
  const year = mode === "day" ? yearProp ?? parsed.year : parsed.year;
  const monthIndex = mode === "day" ? monthProp ?? parsed.monthIndex : parsed.monthIndex;
  const day =
    mode === "day" && (parsed.year !== year || parsed.monthIndex !== monthIndex)
      ? 1
      : clampDay(year, monthIndex, parsed.day);

  const markedKey = markedDays ? [...markedDays].join(",") : "";
  const disabledKey = disabledDays ? [...disabledDays].join(",") : "";
  const dayOptions = useMemo<WheelOption<number>[]>(
    () =>
      buildDayOptions(year, monthIndex, {
        maxDate,
        minDate,
        ...(mode === "day"
          ? {
              markedDays: markedKey ? markedKey.split(",").map(Number) : [],
              disabledDays: disabledKey ? disabledKey.split(",").map(Number) : [],
              disabledNote,
            }
          : {}),
      }),
    [year, monthIndex, maxDate, minDate, mode, markedKey, disabledKey, disabledNote],
  );

  const firstYear = minYear ?? Math.min(year, parseIsoDate(today)!.year) - 5;
  const lastYear = maxYear ?? Math.max(year, parseIsoDate(today)!.year) + 5;
  const monthOptions = useMemo<WheelOption<number>[]>(
    () =>
      monthNames.map((name, index) => ({
        value: index,
        label: name,
        disabled:
          (maxDate ? isoDate(year, index, 1) > maxDate : false) ||
          (minDate ? isoDate(year, index, daysInMonth(year, index)) < minDate : false),
      })),
    [monthNames, year, maxDate, minDate],
  );
  const yearOptions = useMemo<WheelOption<number>[]>(
    () =>
      Array.from({ length: Math.max(1, lastYear - firstYear + 1) }, (_, i) => {
        const y = firstYear + i;
        return {
          value: y,
          label: String(y),
          disabled:
            (maxDate ? `${y}-01-01` > maxDate : false) || (minDate ? `${y}-12-31` < minDate : false),
        };
      }),
    [firstYear, lastYear, maxDate, minDate],
  );

  /** Собрать дату и увести день на ближайший доступный. */
  function emit(nextYear: number, nextMonth: number, nextDay: number) {
    const clamped = clampDay(nextYear, nextMonth, nextDay);
    const options = buildDayOptions(nextYear, nextMonth, { maxDate, minDate });
    const index = nearestEnabledIndex(options, clamped - 1);
    const safeDay = index >= 0 ? options[index].value : clamped;
    onChange(isoDate(nextYear, nextMonth, safeDay));
  }

  const todayParts = parseIsoDate(today)!;
  const todaySelectable =
    (!maxDate || today <= maxDate) &&
    (!minDate || today >= minDate) &&
    (mode === "full" ||
      (todayParts.year === year &&
        todayParts.monthIndex === monthIndex &&
        !dayOptions[todayParts.day - 1]?.disabled));

  const dayValueText = (option: WheelOption<number>) =>
    `${option.value}, ${weekdayNames[weekdayIndex(isoDate(year, monthIndex, option.value))]}`;

  return (
    <div className={cn("space-y-3", className)}>
      {mode === "day" ? (
        <WheelColumn
          ariaLabel={t("dayInMonth", { month: monthNames[monthIndex].toLocaleLowerCase(locale), year: String(year) })}
          options={dayOptions}
          value={day}
          onChange={(next) => onChange(isoDate(year, monthIndex, next))}
          valueText={dayValueText}
        />
      ) : (
        <div className="grid grid-cols-[1fr_1.45fr_1fr] gap-1">
          <WheelColumn
            ariaLabel={t("day")}
            options={dayOptions}
            value={day}
            onChange={(next) => emit(year, monthIndex, next)}
            valueText={dayValueText}
          />
          <WheelColumn
            ariaLabel={t("month")}
            options={monthOptions}
            value={monthIndex}
            onChange={(next) => emit(year, next, day)}
          />
          <WheelColumn
            ariaLabel={t("year")}
            options={yearOptions}
            value={year}
            onChange={(next) => emit(next, monthIndex, day)}
          />
        </div>
      )}
      {todaySelectable || onDone ? (
        <div className="flex items-center justify-between gap-2">
          {todaySelectable ? (
            <button
              type="button"
              onClick={() => onChange(today)}
              className="inline-flex h-9 items-center rounded-xl px-3 text-[13.5px] font-medium text-[#3848c7] transition-colors duration-150 hover:bg-[#f5f6ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
            >
              {t("today")}
            </button>
          ) : (
            <span />
          )}
          {onDone ? (
            <button
              type="button"
              onClick={onDone}
              className="inline-flex h-9 items-center rounded-xl bg-[#5566f6] px-4 text-[13.5px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors duration-150 hover:bg-[#4a5bf0] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
            >
              {doneLabel ?? t("done")}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
