"use client";

import type { MouseEvent } from "react";

import { cn } from "@/lib/utils";
import {
  cleaningStatus,
  monthCleanings,
  monthFactMarks,
  sanitationMonthKey,
  type CleaningStatus,
  type SanitationRoomRow,
} from "@/lib/sanitation-day-document";
import { MONTH_NAMES_RU, formatDayMonth, formatDayMonthWeekday } from "@/lib/wheel-date";

/**
 * Цвета дат уборок — одни и те же в ячейке таблицы, в редакторе месяца
 * и в годовом листе на телефоне.
 */
export const GC_CHIP_TONE: Record<CleaningStatus, string> = {
  done: "bg-[#ecfdf5] text-[#116b2a]",
  overdue: "bg-[#fff4f2] text-[#a13a32]",
  today: "bg-[#f5f6ff] text-[#3848c7] ring-1 ring-[#5566f6]",
  planned: "bg-[#f5f6ff] text-[#3848c7]",
};

export const GC_STATUS_LABEL: Record<CleaningStatus, string> = {
  done: "выполнена",
  overdue: "просрочена",
  today: "сегодня по плану",
  planned: "запланирована",
};

const CHIP_CLASS =
  "inline-flex h-5 min-w-[22px] items-center justify-center rounded-md px-1 text-[11px] font-semibold leading-none tabular-nums";

type Chip = { key: string; label: string; tone: string; title: string; dashed?: boolean };

/**
 * Ячейка месяца графика генуборок: даты уборок цветными чипами.
 *
 *   «План»  — плановые даты: выполнена (зелёная), просрочена (красная),
 *             сегодня (с обводкой), впереди (индиго);
 *   «Факт»  — дни, когда уборку провели; внеплановая — пунктирной рамкой.
 *
 * Текст старой ячейки, который не разобрался на даты, — серым курсивом.
 * На печати — обычный текст проекции («04, 11, 18»), как на бумаге.
 * Нажатие открывает редактор месяца.
 */
export function GeneralCleaningMonthCell({
  row,
  year,
  monthIndex,
  kind,
  todayKey,
  readOnly,
  onOpen,
}: {
  row: SanitationRoomRow;
  year: number;
  monthIndex: number;
  kind: "plan" | "fact";
  todayKey: string;
  readOnly: boolean;
  onOpen?: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
  const key = sanitationMonthKey(monthIndex);
  const note = row.legacyNotes?.[key]?.[kind];
  const chips: Chip[] =
    kind === "plan"
      ? monthCleanings(row, monthIndex, year).planned.map((cleaning) => {
          const status = cleaningStatus(cleaning, todayKey);
          const date = cleaning.planned as string;
          return {
            key: cleaning.id,
            label: date.slice(8, 10),
            tone: GC_CHIP_TONE[status],
            title: `${formatDayMonthWeekday(date)} — ${GC_STATUS_LABEL[status]}${
              cleaning.done ? ` ${formatDayMonth(cleaning.done)}` : ""
            }`,
          };
        })
      : monthFactMarks(row, year, monthIndex).map(({ cleaning, label }) => ({
          key: cleaning.id,
          label,
          tone: GC_CHIP_TONE.done,
          dashed: !cleaning.planned,
          title: cleaning.planned
            ? `${formatDayMonthWeekday(cleaning.done as string)} — уборка по плану ${formatDayMonth(cleaning.planned)}`
            : `${formatDayMonthWeekday(cleaning.done as string)} — внеплановая уборка`,
        }));

  const summary = chips.map((chip) => chip.label).join(", ");
  const ariaLabel = `${MONTH_NAMES_RU[monthIndex]}, ${row.roomName || "помещение"}: ${
    kind === "plan" ? "план" : "выполнено"
  } — ${summary || "пусто"}${note ? `, заметка «${note}»` : ""}. Открыть редактор месяца`;

  const content = (
    <>
      {chips.map((chip) => (
        <span
          key={chip.key}
          title={chip.title}
          className={cn(CHIP_CLASS, chip.tone, chip.dashed && "border border-dashed border-[#116b2a]/45")}
        >
          {chip.label}
        </span>
      ))}
      {note ? (
        <span className="max-w-full truncate text-[10.5px] italic leading-tight text-[#6f7282]" title={note}>
          {note}
        </span>
      ) : null}
      {chips.length === 0 && !note ? (
        <span className="text-[12px] text-[#c3c6d4] transition-colors duration-150 group-hover:text-[#5566f6]">
          —
        </span>
      ) : null}
    </>
  );

  return (
    <>
      <span className="hidden print:inline">{row[kind][key]}</span>
      {readOnly || !onOpen ? (
        <div className="flex min-h-[28px] flex-wrap items-center justify-center gap-0.5 print:hidden">
          {content}
        </div>
      ) : (
        <button
          type="button"
          onClick={onOpen}
          aria-label={ariaLabel}
          className="group flex min-h-[28px] w-full flex-wrap items-center justify-center gap-0.5 rounded-lg px-0.5 py-0.5 transition-colors duration-150 hover:bg-[#f5f6ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 print:hidden"
        >
          {content}
        </button>
      )}
    </>
  );
}
