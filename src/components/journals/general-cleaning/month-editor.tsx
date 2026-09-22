"use client";

import { useState, type ReactNode, type RefObject } from "react";
import {
  CalendarCheck2,
  CalendarPlus,
  ChevronDown,
  ChevronLeft,
  Info,
  Link2,
  Loader2,
  Sparkles,
  TriangleAlert,
  X,
} from "lucide-react";

import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { WheelDatePicker } from "@/components/ui/wheel-date-picker";
import { GC_CHIP_TONE, GC_STATUS_LABEL } from "@/components/journals/general-cleaning/month-cell";
import { useInlineConfirm } from "@/components/journals/general-cleaning/use-inline-confirm";
import {
  describeGeneralSchedule,
  scheduledDatesInMonth,
  type RoomGeneralSchedule,
} from "@/lib/general-cleaning-schedule";
import type { GeneralCleaningOp } from "@/lib/general-cleaning-ops";
import {
  cleaningStatus,
  monthCleanings,
  sanitationMonthKey,
  summarizeCleanings,
  type SanitationCleaning,
  type SanitationRoomRow,
} from "@/lib/sanitation-day-document";
import { useIsNarrowViewport } from "@/lib/use-narrow-viewport";
import { cn } from "@/lib/utils";
import {
  MONTH_NAMES_RU,
  WEEKDAY_FULL_RU,
  buildDayOptions,
  daysInMonth,
  formatDayMonth,
  formatDayMonthWeekday,
  isoDate,
  weekdayIndex,
} from "@/lib/wheel-date";

const DAY_MS = 24 * 60 * 60 * 1000;

const PRIMARY_BUTTON =
  "inline-flex h-10 items-center justify-center gap-2 rounded-2xl bg-[#5566f6] px-4 text-[14px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors duration-150 hover:bg-[#4a5bf0] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none";
const OUTLINE_BUTTON =
  "inline-flex h-10 items-center justify-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 disabled:cursor-not-allowed disabled:opacity-50";
const SMALL_BUTTON =
  "inline-flex h-9 items-center justify-center gap-1.5 rounded-xl px-3 text-[13px] font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 disabled:cursor-not-allowed disabled:opacity-50";
const SMALL_SOFT = `${SMALL_BUTTON} bg-[#eef1ff] text-[#3848c7] hover:bg-[#e2e7ff]`;
const SMALL_DONE = `${SMALL_BUTTON} bg-[#ecfdf5] text-[#116b2a] hover:bg-[#d9f7ea]`;
const SMALL_GHOST = `${SMALL_BUTTON} text-[#3c4053] hover:bg-[#f5f6ff]`;
const SMALL_DANGER = `${SMALL_BUTTON} text-[#a13a32] hover:bg-[#fff4f2]`;

function addDays(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

function dayOf(iso: string): number {
  return Number(iso.slice(8, 10));
}

/** «25.09, пятница» */
function longDate(iso: string): string {
  return `${formatDayMonth(iso)}, ${WEEKDAY_FULL_RU[weekdayIndex(iso)]}`;
}

function pluralCleanings(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return `${count} уборка`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${count} уборки`;
  return `${count} уборок`;
}

/** «4 уборки · 2 выполнены · 1 просрочена» — для подписи месяца. */
export function describeMonthLoad(
  row: Pick<SanitationRoomRow, "cleanings">,
  year: number,
  monthIndex: number,
  todayKey: string,
): { text: string; overdue: number } {
  const month = monthCleanings(row, monthIndex, year);
  const planned = summarizeCleanings(month.planned, todayKey);
  const parts = [planned.planned > 0 ? pluralCleanings(planned.planned) : "нет в плане"];
  const done = planned.done + month.unplanned.length;
  if (done > 0) parts.push(`${done} ${done === 1 ? "выполнена" : "выполнены"}`);
  return { text: parts.join(" · "), overdue: planned.overdue };
}

type View =
  | { kind: "list" }
  | { kind: "add" }
  | { kind: "move"; slot: SanitationCleaning }
  | { kind: "markDone"; slot: SanitationCleaning }
  | { kind: "unplanned" }
  | { kind: "legacyDone" };

export type GeneralCleaningPanelProps = {
  row: SanitationRoomRow;
  year: number;
  monthIndex: number;
  /** Сегодня (`YYYY-MM-DD`). */
  todayKey: string;
  /** График генуборки помещения строки; null — не задан или строка без связи. */
  schedule: RoomGeneralSchedule | null;
  /** Строка связана с помещением справочника. */
  linked: boolean;
  tasksflowEnabled: boolean;
  /** «Заполнить по графику» — массовая правка, только руководителю. */
  canFillFromSchedule: boolean;
  /** Отправить операцию; true — сохранилось. */
  onOp: (op: GeneralCleaningOp) => Promise<boolean>;
  /** Годовой лист: вернуться к списку месяцев. */
  onBack?: () => void;
};

/**
 * Редактор одного месяца строки графика: что в плане, что выполнено,
 * и понятные действия — добавить дату, отметить выполненной,
 * перенести, внеплановая уборка. Даты выбираются барабаном дней месяца.
 * Каждое действие — одна операция на сервер (`general-cleaning-ops.ts`).
 */
export function GeneralCleaningMonthPanel({
  row,
  year,
  monthIndex,
  todayKey,
  schedule,
  linked,
  tasksflowEnabled,
  canFillFromSchedule,
  onOp,
  onBack,
}: GeneralCleaningPanelProps) {
  const [view, setView] = useState<View>({ kind: "list" });
  const [expanded, setExpanded] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const { confirm, element: confirmElement } = useInlineConfirm();

  const month = monthCleanings(row, monthIndex, year);
  const monthKey = sanitationMonthKey(monthIndex);
  const notes = row.legacyNotes?.[monthKey];
  const monthStart = isoDate(year, monthIndex, 1);
  const monthEnd = isoDate(year, monthIndex, daysInMonth(year, monthIndex));
  const plannedDates = new Set(month.planned.map((c) => c.planned as string));
  const plannedDays = [...plannedDates].map(dayOf);
  const doneDays = month.done.map((c) => dayOf(c.done as string));
  const scheduled = schedule ? scheduledDatesInMonth(schedule, year, monthIndex) : [];
  const futureScheduled = scheduled.filter((date) => date >= todayKey);
  const missing = futureScheduled.filter((date) => !plannedDates.has(date));
  const extra = month.planned
    .filter((c) => !c.done && (c.planned as string) >= todayKey && !scheduled.includes(c.planned as string))
    .map((c) => c.planned as string);
  const canMarkPast = monthStart <= todayKey;
  const busy = pending !== null;

  async function run(actionKey: string, op: GeneralCleaningOp, after?: () => void) {
    setPending(actionKey);
    try {
      if (await onOp(op)) after?.();
    } finally {
      setPending(null);
    }
  }

  function firstFreeDay(from: string): string | null {
    for (let day = dayOf(from < monthStart ? monthStart : from); day <= dayOf(monthEnd); day += 1) {
      const date = isoDate(year, monthIndex, day);
      if (!plannedDates.has(date)) return date;
    }
    return null;
  }

  function openWheel(next: View) {
    let initial = monthStart;
    if (next.kind === "add") {
      initial = missing[0] ?? firstFreeDay(todayKey) ?? firstFreeDay(monthStart) ?? monthStart;
    } else if (next.kind === "move") {
      initial = firstFreeDay(addDays(next.slot.planned as string, 1)) ?? firstFreeDay(monthStart) ?? monthStart;
    } else if (next.kind === "markDone") {
      const planned = next.slot.planned as string;
      initial = next.slot.done ?? (planned <= todayKey ? planned : todayKey);
      if (initial < monthStart) initial = monthStart;
      if (initial > monthEnd) initial = monthEnd;
    } else {
      initial = todayKey >= monthStart && todayKey <= monthEnd ? todayKey : monthEnd;
    }
    setDraft(initial);
    setView(next);
  }

  function back() {
    setView({ kind: "list" });
  }

  if (view.kind !== "list") {
    const wheel = wheelSpec(view);
    const options = buildDayOptions(year, monthIndex, {
      maxDate: wheel.maxDate,
      minDate: wheel.minDate,
      disabledDays: wheel.disabledDays,
    });
    const selectable = options.some((option) => !option.disabled);
    const draftOk =
      draft >= monthStart &&
      draft <= monthEnd &&
      !options[dayOf(draft) - 1]?.disabled;
    return (
      <div className="space-y-3">
        {confirmElement}
        <button
          type="button"
          onClick={back}
          className="inline-flex items-center gap-1 rounded-lg text-[13px] font-medium text-[#3848c7] transition-colors duration-150 hover:text-[#5566f6] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
        >
          <ChevronLeft className="size-4" />
          К месяцу
        </button>
        <div>
          <div className="text-[15px] font-semibold leading-snug text-[#0b1024]">{wheel.title}</div>
          <p className="mt-1 text-[12.5px] leading-[1.5] text-[#6f7282]">{wheel.explanation}</p>
        </div>
        {selectable ? (
          <WheelDatePicker
            mode="day"
            year={year}
            month={monthIndex}
            value={draft}
            onChange={setDraft}
            maxDate={wheel.maxDate}
            minDate={wheel.minDate}
            markedDays={wheel.markedDays}
            disabledDays={wheel.disabledDays}
            disabledNote={wheel.disabledNote}
            todayKey={todayKey}
          />
        ) : (
          <div className="rounded-2xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-4 py-5 text-center text-[13px] text-[#6f7282]">
            {wheel.emptyText}
          </div>
        )}
        <button
          type="button"
          disabled={!selectable || !draftOk || busy}
          onClick={() => void run(`wheel:${view.kind}`, wheel.op(draft), back)}
          className={cn(PRIMARY_BUTTON, "w-full")}
        >
          {pending ? <Loader2 className="size-4 animate-spin" /> : null}
          {draftOk ? wheel.confirmLabel(draft) : "Выберите день"}
        </button>
      </div>
    );
  }

  function wheelSpec(current: Exclude<View, { kind: "list" }>): {
    title: string;
    explanation: string;
    emptyText: string;
    maxDate?: string;
    minDate?: string;
    markedDays?: number[];
    disabledDays?: number[];
    disabledNote?: string;
    confirmLabel: (date: string) => string;
    op: (date: string) => GeneralCleaningOp;
  } {
    const taskHint = tasksflowEnabled && linked ? " В этот день исполнитель получит задачу в TasksFlow." : "";
    switch (current.kind) {
      case "add":
        return {
          title: `Новая дата в плане · ${MONTH_NAMES_RU[monthIndex]}`,
          explanation: `Дата появится в строке «План».${taskHint}`,
          emptyText: "Все дни месяца уже в плане.",
          markedDays: plannedDays,
          disabledDays: plannedDays,
          disabledNote: "в плане",
          confirmLabel: (date) => `Добавить ${formatDayMonthWeekday(date)}`,
          op: (date) => ({ type: "addPlanned", rowId: row.id, date }),
        };
      case "move": {
        const from = current.slot.planned as string;
        return {
          title: `Перенести уборку ${longDate(from)}`,
          explanation: `Выберите новый день — старая дата уйдёт из плана.${taskHint}`,
          emptyText: "Свободных дней в этом месяце нет.",
          markedDays: plannedDays,
          disabledDays: plannedDays,
          disabledNote: "в плане",
          confirmLabel: (date) => `Перенести на ${formatDayMonthWeekday(date)}`,
          op: (date) => ({ type: "movePlanned", rowId: row.id, from, to: date }),
        };
      }
      case "markDone": {
        const planned = current.slot.planned as string;
        return {
          title: current.slot.done
            ? `Когда провели уборку ${formatDayMonth(planned)}?`
            : `Отметить уборку ${longDate(planned)}`,
          explanation:
            "Выберите день, когда уборку провели, — он попадёт в строку «Факт». Будущим числом отметить нельзя, раньше плана — не больше чем на неделю.",
          emptyText: "Отметить эту уборку пока нельзя — до неё больше недели.",
          maxDate: todayKey,
          minDate: addDays(planned, -7),
          markedDays: [dayOf(planned)],
          confirmLabel: (date) => `Отметить ${formatDayMonthWeekday(date)}`,
          op: (date) => ({ type: "markDone", rowId: row.id, date: planned, doneDate: date }),
        };
      }
      case "unplanned":
        return {
          title: "Внеплановая уборка",
          explanation:
            "Уборка вне плана попадёт только в строку «Факт». Если на этот день была плановая — она отметится выполненной.",
          emptyText: "Этот месяц ещё не наступил.",
          maxDate: todayKey,
          markedDays: plannedDays,
          disabledDays: doneDays,
          disabledNote: "отмечено",
          confirmLabel: (date) => `Отметить ${formatDayMonthWeekday(date)}`,
          op: (date) => ({ type: "addUnplanned", rowId: row.id, date }),
        };
      case "legacyDone":
        return {
          title: `Заменить «${notes?.fact ?? ""}» датой`,
          explanation: "В старой записи вместо даты стоял знак. Выберите день уборки — знак заменится датой в строке «Факт».",
          emptyText: "Этот месяц ещё не наступил.",
          maxDate: todayKey,
          markedDays: plannedDays,
          confirmLabel: (date) => `Отметить ${formatDayMonthWeekday(date)}`,
          op: (date) => ({ type: "legacyNoteToDone", rowId: row.id, month: monthKey, date }),
        };
    }
  }

  async function removeDoneSlot(slot: SanitationCleaning) {
    const ok = await confirm({
      title: `Убрать ${formatDayMonth(slot.planned as string)} из плана?`,
      description: `Уборка уже отмечена выполненной ${formatDayMonth(slot.done as string)}.`,
      bullets: [
        { label: "Дата уйдёт из строки «План»", tone: "warn" },
        { label: `Отметка ${formatDayMonth(slot.done as string)} останется в «Факте» — внеплановой уборкой`, tone: "info" },
      ],
      confirmLabel: "Убрать из плана",
      variant: "warn",
    });
    if (ok) await run(`remove:${slot.id}`, { type: "removePlanned", rowId: row.id, date: slot.planned as string });
  }

  async function unmark(slot: SanitationCleaning) {
    if (slot.doneSource === "task") {
      const ok = await confirm({
        title: "Снять отметку, поставленную задачей?",
        description: `Отметку ${formatDayMonth(slot.done as string)} поставил исполнитель, закрыв задачу в TasksFlow. Задача в TasksFlow останется выполненной.`,
        confirmLabel: "Снять отметку",
        variant: "warn",
      });
      if (!ok) return;
    }
    await run(`unmark:${slot.id}`, { type: "unmarkDone", rowId: row.id, slotId: slot.id });
  }

  async function removeUnplanned(cleaning: SanitationCleaning) {
    const ok = await confirm({
      title: `Удалить уборку ${formatDayMonth(cleaning.done as string)}?`,
      description: "Внеплановая уборка исчезнет из строки «Факт».",
      confirmLabel: "Удалить",
      variant: "danger",
    });
    if (ok) {
      await run(`unplanned:${cleaning.id}`, {
        type: "removeUnplanned",
        rowId: row.id,
        date: cleaning.done as string,
      });
    }
  }

  async function clearFactNote() {
    const ok = await confirm({
      title: `Убрать «${notes?.fact ?? ""}» из факта?`,
      description: "Запись из старой ячейки удалится. Если уборка была — лучше отметить её датой.",
      confirmLabel: "Убрать",
      variant: "danger",
    });
    if (ok) await run("note:fact", { type: "clearLegacyNote", rowId: row.id, month: monthKey, kind: "fact" });
  }

  async function fillMonth() {
    if (extra.length > 0) {
      const ok = await confirm({
        title: "Привести месяц к графику помещения?",
        description: schedule ? `График: ${describeGeneralSchedule(schedule)}.` : undefined,
        bullets: [
          ...(missing.length > 0
            ? [{ label: `Добавятся: ${missing.map(formatDayMonth).join(", ")}`, tone: "info" as const }]
            : []),
          { label: `Уйдут из плана: ${extra.map(formatDayMonth).join(", ")}`, tone: "warn" as const },
          { label: "Прошедшие даты и отметки о выполнении не изменятся", tone: "default" as const },
        ],
        confirmLabel: "Привести к графику",
      });
      if (!ok) return;
    }
    await run("fill", {
      type: "fillFromSchedule",
      rowIds: [row.id],
      months: [monthIndex],
      mode: "replace-future",
      fromDate: todayKey,
    });
  }

  return (
    <div className="space-y-4">
      {confirmElement}
      {onBack ? (
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1 rounded-lg text-[13px] font-medium text-[#3848c7] transition-colors duration-150 hover:text-[#5566f6] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
        >
          <ChevronLeft className="size-4" />
          Все месяцы
        </button>
      ) : null}

      {!linked ? (
        <div className="flex gap-2.5 rounded-2xl border border-[#f5d0c9] bg-[#fff4f2] px-3.5 py-3 text-[12.5px] leading-[1.5] text-[#7a2c25]">
          <Link2 className="mt-0.5 size-4 shrink-0 text-[#a13a32]" />
          <div>
            <div className="font-semibold text-[#a13a32]">Строка не связана с помещением</div>
            График помещения и задачи TasksFlow работают только для помещений из справочника. Нажмите на
            название строки и свяжите её с помещением.
          </div>
        </div>
      ) : !schedule ? (
        <div className="flex gap-2.5 rounded-2xl border border-[#ececf4] bg-[#fafbff] px-3.5 py-3 text-[12.5px] leading-[1.5] text-[#3c4053]">
          <Info className="mt-0.5 size-4 shrink-0 text-[#5566f6]" />
          <div>
            <div className="font-semibold text-[#0b1024]">У помещения нет графика генуборки</div>
            Нажмите на название помещения, выберите дни генеральной уборки — план заполнится по ним.
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-[#ececf4] bg-[#fafbff] px-3.5 py-3">
          <div className="flex items-start gap-2.5">
            <CalendarCheck2 className="mt-0.5 size-4 shrink-0 text-[#5566f6]" />
            <div className="min-w-0 flex-1 text-[12.5px] leading-[1.5] text-[#3c4053]">
              По графику помещения: <span className="font-semibold text-[#0b1024]">{describeGeneralSchedule(schedule)}</span>
              {missing.length > 0 ? (
                <div className="text-[#6f7282]">Не в плане: {missing.map(formatDayMonth).join(", ")}</div>
              ) : null}
            </div>
          </div>
          {canFillFromSchedule && (missing.length > 0 || extra.length > 0) ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void fillMonth()}
              className={cn(SMALL_SOFT, "mt-2.5 w-full")}
            >
              {pending === "fill" ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
              Заполнить по графику
            </button>
          ) : null}
        </div>
      )}

      <section>
        <div className="mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#9b9fb3]">
          План на месяц
        </div>
        {month.planned.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-4 py-4 text-center text-[13px] text-[#6f7282]">
            В этом месяце уборок в плане нет
          </div>
        ) : (
          <ul className="space-y-1">
            {month.planned.map((slot) => {
              const planned = slot.planned as string;
              const status = cleaningStatus(slot, todayKey);
              const open = expanded === slot.id;
              const tooEarly = addDays(planned, -7) > todayKey;
              return (
                <li key={slot.id} className="rounded-2xl border border-[#ececf4] bg-white">
                  <button
                    type="button"
                    aria-expanded={open}
                    onClick={() => setExpanded(open ? null : slot.id)}
                    className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition-colors duration-150 hover:bg-[#f5f6ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
                  >
                    <span
                      className={cn(
                        "inline-flex size-8 shrink-0 items-center justify-center rounded-xl text-[13px] font-semibold tabular-nums",
                        GC_CHIP_TONE[status],
                      )}
                    >
                      {planned.slice(8, 10)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[14px] font-medium text-[#0b1024]">{longDate(planned)}</span>
                      <span
                        className={cn(
                          "block text-[12px]",
                          status === "done"
                            ? "text-[#116b2a]"
                            : status === "overdue"
                              ? "text-[#a13a32]"
                              : "text-[#6f7282]",
                        )}
                      >
                        {status === "done"
                          ? `Выполнена ${formatDayMonth(slot.done as string)}${slot.doneSource === "task" ? " · задачей TasksFlow" : ""}`
                          : GC_STATUS_LABEL[status][0].toUpperCase() + GC_STATUS_LABEL[status].slice(1)}
                      </span>
                    </span>
                    <ChevronDown
                      className={cn(
                        "size-4 shrink-0 text-[#9b9fb3] transition-transform duration-150",
                        open && "rotate-180",
                      )}
                    />
                  </button>
                  {open ? (
                    <div className="flex flex-wrap gap-1.5 px-3 pb-3">
                      {slot.done ? (
                        <>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => openWheel({ kind: "markDone", slot })}
                            className={SMALL_SOFT}
                          >
                            Изменить дату
                          </button>
                          <button type="button" disabled={busy} onClick={() => void unmark(slot)} className={SMALL_GHOST}>
                            {pending === `unmark:${slot.id}` ? <Loader2 className="size-4 animate-spin" /> : null}
                            Снять отметку
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void removeDoneSlot(slot)}
                            className={SMALL_DANGER}
                          >
                            Убрать из плана
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            disabled={busy || tooEarly}
                            title={tooEarly ? "Отметить можно не раньше чем за неделю до даты" : undefined}
                            onClick={() => openWheel({ kind: "markDone", slot })}
                            className={SMALL_DONE}
                          >
                            <CalendarCheck2 className="size-4" />
                            Отметить выполненной
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => openWheel({ kind: "move", slot })}
                            className={SMALL_GHOST}
                          >
                            Перенести
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              void run(`remove:${slot.id}`, { type: "removePlanned", rowId: row.id, date: planned })
                            }
                            className={SMALL_DANGER}
                          >
                            {pending === `remove:${slot.id}` ? <Loader2 className="size-4 animate-spin" /> : null}
                            Убрать из плана
                          </button>
                        </>
                      )}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {month.unplanned.length > 0 ? (
        <section>
          <div className="mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#9b9fb3]">
            Внеплановые уборки
          </div>
          <ul className="space-y-1">
            {month.unplanned.map((cleaning) => (
              <li
                key={cleaning.id}
                className="flex items-center gap-3 rounded-2xl border border-[#ececf4] bg-white px-3 py-2.5"
              >
                <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-xl border border-dashed border-[#116b2a]/45 bg-[#ecfdf5] text-[13px] font-semibold tabular-nums text-[#116b2a]">
                  {(cleaning.done as string).slice(8, 10)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] font-medium text-[#0b1024]">{longDate(cleaning.done as string)}</span>
                  <span className="block text-[12px] text-[#116b2a]">
                    Вне плана{cleaning.doneSource === "task" ? " · по QR или задаче" : ""}
                  </span>
                </span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void removeUnplanned(cleaning)}
                  className={SMALL_DANGER}
                >
                  Удалить
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {notes?.plan || notes?.fact ? (
        <section>
          <div className="mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#9b9fb3]">
            Из старой записи
          </div>
          <div className="space-y-1">
            {notes.plan ? (
              <div className="flex items-center gap-2 rounded-2xl border border-[#ececf4] bg-white px-3 py-2.5">
                <span className="min-w-0 flex-1 text-[13px] text-[#3c4053]">
                  План: <span className="italic text-[#6f7282]">{notes.plan}</span>
                </span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void run("note:plan", { type: "clearLegacyNote", rowId: row.id, month: monthKey, kind: "plan" })
                  }
                  className={SMALL_GHOST}
                >
                  Убрать
                </button>
              </div>
            ) : null}
            {notes.fact ? (
              <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-[#ececf4] bg-white px-3 py-2.5">
                <span className="min-w-0 flex-1 text-[13px] text-[#3c4053]">
                  Факт: <span className="italic text-[#6f7282]">{notes.fact}</span>
                </span>
                <button
                  type="button"
                  disabled={busy || !canMarkPast}
                  onClick={() => openWheel({ kind: "legacyDone" })}
                  className={SMALL_SOFT}
                >
                  Отметить датой
                </button>
                <button type="button" disabled={busy} onClick={() => void clearFactNote()} className={SMALL_DANGER}>
                  Убрать
                </button>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      <div className="grid grid-cols-2 gap-2">
        <button type="button" disabled={busy} onClick={() => openWheel({ kind: "add" })} className={PRIMARY_BUTTON}>
          <CalendarPlus className="size-4" />
          Добавить дату
        </button>
        <button
          type="button"
          disabled={busy || !canMarkPast}
          title={!canMarkPast ? "Месяц ещё не наступил" : undefined}
          onClick={() => openWheel({ kind: "unplanned" })}
          className={cn(OUTLINE_BUTTON, "px-3")}
        >
          Внеплановая уборка
        </button>
      </div>

      {tasksflowEnabled ? (
        linked ? (
          <p className="flex gap-2 text-[12px] leading-[1.5] text-[#3848c7]">
            <Info className="mt-0.5 size-3.5 shrink-0" />В день уборки исполнитель получит задачу в TasksFlow.
          </p>
        ) : (
          <p className="flex gap-2 text-[12px] leading-[1.5] text-[#a13a32]">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
            Свяжите строку с помещением — иначе задачи не придут.
          </p>
        )
      ) : null}
    </div>
  );
}

/** Точка привязки поповера — ячейка, по которой нажали. */
export type GeneralCleaningAnchor = { getBoundingClientRect(): DOMRect };

/**
 * Окно редактора месяца: на компьютере — поповер у нажатой ячейки, на
 * телефоне (< 640px) — лист снизу. Содержимое одно и то же.
 */
export function GeneralCleaningMonthEditor({
  open,
  onOpenChange,
  anchorRef,
  title,
  subtitle,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  anchorRef: RefObject<GeneralCleaningAnchor>;
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  const narrow = useIsNarrowViewport();
  if (narrow) {
    return (
      <BottomSheet open={open} onClose={() => onOpenChange(false)} title={title} subtitle={subtitle}>
        <div className="px-1 pb-3 pt-1">{children}</div>
      </BottomSheet>
    );
  }
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverAnchor virtualRef={anchorRef} />
      <PopoverContent
        side="bottom"
        align="center"
        collisionPadding={16}
        className="flex w-[360px] max-w-[calc(100vw-2rem)] flex-col p-0"
        style={{ maxHeight: "min(640px, var(--radix-popover-content-available-height))" }}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-[#f0f1f7] px-4 pb-3 pt-3.5">
          <div className="min-w-0">
            <div className="truncate text-[15px] font-semibold text-[#0b1024]">{title}</div>
            {subtitle ? <div className="truncate text-[12.5px] text-[#6f7282]">{subtitle}</div> : null}
          </div>
          <button
            type="button"
            aria-label="Закрыть"
            onClick={() => onOpenChange(false)}
            className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[#f5f6ff] text-[#6f7282] transition-colors duration-150 hover:bg-[#eef1ff] hover:text-[#0b1024] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">{children}</div>
      </PopoverContent>
    </Popover>
  );
}
