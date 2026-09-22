/**
 * Правки «Графика и учета генеральных уборок» — по одной операции.
 *
 * Раньше каждая ячейка месяца уходила целым конфигом (PATCH), и две
 * вкладки / задача TasksFlow затирали друг друга. Теперь экран шлёт
 * операцию («добавить 25.09 в план», «отметить 11.09 выполненной»), а
 * сервер применяет её к СВЕЖЕМУ конфигу под блокировкой документа
 * (`withDocumentConfigLock`). Функция чистая: тот же редьюсер считает
 * живой предпросмотр «Заполнить по графику» в браузере.
 *
 * Правила дат:
 *   • все даты — в году документа;
 *   • «выполнено» — не позже сегодняшнего дня (по поясу организации) и
 *     не раньше плана больше чем на неделю;
 *   • «по графику» никогда не трогает прошедшие дни и отметки.
 */
import { z } from "zod";

import {
  scheduledDatesInRange,
  type RoomGeneralSchedule,
} from "@/lib/general-cleaning-schedule";
import {
  SANITATION_MONTHS,
  normalizeSanitationDayConfig,
  reprojectSanitationRow,
  sanitationCleaningId,
  shiftCleaningsToYear,
  type SanitationCleaning,
  type SanitationDayConfig,
  type SanitationMonthKey,
  type SanitationRoomRow,
} from "@/lib/sanitation-day-document";
import { parseIsoDate } from "@/lib/wheel-date";

const ISO_DATE = z.string().refine((value) => parseIsoDate(value) !== null, "Некорректная дата");
const MONTH_KEY = z.enum(SANITATION_MONTHS.map((m) => m.key) as [SanitationMonthKey, ...SanitationMonthKey[]]);
const ROW_ID = z.string().min(1).max(200);

const OP_SCHEMA = z.discriminatedUnion("type", [
  z.object({ type: z.literal("addPlanned"), rowId: ROW_ID, date: ISO_DATE }),
  z.object({
    type: z.literal("removePlanned"),
    rowId: ROW_ID,
    date: ISO_DATE,
    dropDone: z.boolean().optional(),
  }),
  z.object({ type: z.literal("movePlanned"), rowId: ROW_ID, from: ISO_DATE, to: ISO_DATE }),
  z.object({ type: z.literal("markDone"), rowId: ROW_ID, date: ISO_DATE, doneDate: ISO_DATE }),
  z.object({
    type: z.literal("unmarkDone"),
    rowId: ROW_ID,
    slotId: z.string().regex(/^[pu]:\d{4}-\d{2}-\d{2}$/),
  }),
  z.object({ type: z.literal("addUnplanned"), rowId: ROW_ID, date: ISO_DATE }),
  z.object({ type: z.literal("removeUnplanned"), rowId: ROW_ID, date: ISO_DATE }),
  z.object({
    type: z.literal("clearLegacyNote"),
    rowId: ROW_ID,
    month: MONTH_KEY,
    kind: z.enum(["plan", "fact"]),
  }),
  z.object({ type: z.literal("legacyNoteToDone"), rowId: ROW_ID, month: MONTH_KEY, date: ISO_DATE }),
  z.object({
    type: z.literal("fillFromSchedule"),
    rowIds: z.array(ROW_ID).max(500).optional(),
    months: z.array(z.number().int().min(0).max(11)).max(12).optional(),
    mode: z.enum(["fill-empty", "replace-future"]),
    fromDate: ISO_DATE,
  }),
  z.object({ type: z.literal("shiftYear"), year: z.number().int().min(2000).max(2100) }),
]);

export type GeneralCleaningOp = z.infer<typeof OP_SCHEMA>;

/** Операции, доступные только руководителю: массовые правки плана. */
export const MANAGEMENT_ONLY_GENERAL_CLEANING_OPS: ReadonlySet<GeneralCleaningOp["type"]> = new Set([
  "fillFromSchedule",
  "shiftYear",
]);

export function parseGeneralCleaningOp(raw: unknown): GeneralCleaningOp | null {
  const parsed = OP_SCHEMA.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export type GeneralCleaningOpContext = {
  /** Сегодня по поясу организации, `YYYY-MM-DD`. */
  todayKey: string;
  /** Кто правит — пишется в `doneBy` ручных отметок. */
  userId: string | null;
  /** roomId → график генуборки помещения (null — не задан). */
  schedules: ReadonlyMap<string, RoomGeneralSchedule | null>;
};

export type GeneralCleaningOpResult = {
  config: SanitationDayConfig;
  changed: boolean;
  /** Даты, которые операция добавила, убрала или отметила. */
  touchedDates: string[];
};

/** Понятная человеку причина отказа — уходит в ответ 400. */
export class GeneralCleaningOpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GeneralCleaningOpError";
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** Отметка может опередить план не больше чем на неделю. */
const EARLY_DONE_DAYS = 7;

function addDays(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

function monthIndexOf(iso: string): number {
  return Number(iso.slice(5, 7)) - 1;
}

function assertInYear(date: string, year: number) {
  if (!date.startsWith(`${year}-`)) {
    throw new GeneralCleaningOpError(`Дата должна быть в ${year} году — это год документа`);
  }
}

function assertNotFuture(date: string, todayKey: string, message: string) {
  if (date > todayKey) throw new GeneralCleaningOpError(message);
}

function planned(date: string, done: string | null = null, meta: Partial<SanitationCleaning> = {}): SanitationCleaning {
  const out: SanitationCleaning = { id: sanitationCleaningId(date, done), planned: date, done };
  if (done && meta.doneBy) out.doneBy = meta.doneBy;
  if (done && meta.doneSource) out.doneSource = meta.doneSource;
  return out;
}

function unplanned(done: string, meta: Partial<SanitationCleaning> = {}): SanitationCleaning {
  const out: SanitationCleaning = { id: sanitationCleaningId(null, done), planned: null, done };
  if (meta.doneBy) out.doneBy = meta.doneBy;
  if (meta.doneSource) out.doneSource = meta.doneSource;
  return out;
}

function manualMark(ctx: GeneralCleaningOpContext): Partial<SanitationCleaning> {
  return { doneBy: ctx.userId, doneSource: "manual" };
}

/**
 * Отметить уборку днём `date`: открытая плановая этого дня закрывается,
 * если день уже отмечен — ничего, иначе — внеплановая.
 */
function markDay(
  cleanings: SanitationCleaning[],
  date: string,
  meta: Partial<SanitationCleaning>,
): SanitationCleaning[] {
  const index = cleanings.findIndex((c) => c.planned === date && !c.done);
  if (index >= 0) {
    const next = [...cleanings];
    next[index] = planned(date, date, meta);
    return next;
  }
  if (cleanings.some((c) => c.done === date)) return cleanings;
  return [...cleanings, unplanned(date, meta)];
}

function fillRow(
  row: SanitationRoomRow,
  op: Extract<GeneralCleaningOp, { type: "fillFromSchedule" }>,
  ctx: GeneralCleaningOpContext,
  year: number,
): SanitationCleaning[] {
  const schedule = row.roomId ? ctx.schedules.get(row.roomId) ?? null : null;
  if (!schedule) return row.cleanings;
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;
  // Прошлое не трогаем никогда: от сегодня, даже если попросили раньше.
  const from = [op.fromDate, ctx.todayKey, yearStart].sort().at(-1) as string;
  if (from > yearEnd) return row.cleanings;
  const monthFilter = op.months ? new Set(op.months) : null;
  const inScope = (date: string) => !monthFilter || monthFilter.has(monthIndexOf(date));
  const dates = scheduledDatesInRange(schedule, from, yearEnd).filter(inScope);

  let cleanings = [...row.cleanings];
  if (op.mode === "replace-future") {
    cleanings = cleanings.filter(
      (c) => !(c.planned && !c.done && c.planned >= from && inScope(c.planned)),
    );
  } else {
    // «Пустой» месяц — без единой плановой даты и без текста плана.
    const busyMonths = new Set(
      cleanings.filter((c) => c.planned).map((c) => monthIndexOf(c.planned as string)),
    );
    const notedMonths = new Set(
      SANITATION_MONTHS.map((m, index) => (row.legacyNotes?.[m.key]?.plan ? index : -1)).filter(
        (index) => index >= 0,
      ),
    );
    const allowed = (date: string) =>
      !busyMonths.has(monthIndexOf(date)) && !notedMonths.has(monthIndexOf(date));
    return addScheduled(cleanings, dates.filter(allowed));
  }
  return addScheduled(cleanings, dates);
}

function addScheduled(cleanings: SanitationCleaning[], dates: string[]): SanitationCleaning[] {
  let next = [...cleanings];
  for (const date of dates) {
    if (next.some((c) => c.planned === date)) continue;
    const extra = next.find((c) => !c.planned && c.done === date);
    if (extra) {
      next = next.filter((c) => c !== extra);
      next.push(planned(date, date, extra));
      continue;
    }
    next.push(planned(date));
  }
  return next;
}

function plannedDates(row: SanitationRoomRow | undefined): Set<string> {
  return new Set((row?.cleanings ?? []).map((c) => c.planned).filter((d): d is string => Boolean(d)));
}

function rowSignature(row: SanitationRoomRow): string {
  return JSON.stringify([row.cleanings, row.legacyNotes ?? null]);
}

/** Что поменялось в плане по строкам: добавленные и убранные даты. */
export function diffCleaningPlans(
  before: SanitationDayConfig,
  after: SanitationDayConfig,
): Map<string, { added: string[]; removed: string[] }> {
  const beforeById = new Map(before.rows.map((row) => [row.id, row]));
  const out = new Map<string, { added: string[]; removed: string[] }>();
  for (const row of after.rows) {
    const was = plannedDates(beforeById.get(row.id));
    const now = plannedDates(row);
    const added = [...now].filter((d) => !was.has(d)).sort();
    const removed = [...was].filter((d) => !now.has(d)).sort();
    if (added.length > 0 || removed.length > 0) out.set(row.id, { added, removed });
  }
  return out;
}

function touched(before: SanitationRoomRow, after: SanitationRoomRow): string[] {
  const key = (c: SanitationCleaning) => JSON.stringify(c);
  const was = new Map(before.cleanings.map((c) => [key(c), c]));
  const now = new Map(after.cleanings.map((c) => [key(c), c]));
  const dates = new Set<string>();
  for (const [k, c] of was) if (!now.has(k)) dates.add((c.planned ?? c.done) as string);
  for (const [k, c] of now) if (!was.has(k)) dates.add((c.planned ?? c.done) as string);
  return [...dates].sort();
}

export function applyGeneralCleaningOp(
  config: SanitationDayConfig,
  op: GeneralCleaningOp,
  ctx: GeneralCleaningOpContext,
): GeneralCleaningOpResult {
  const current = normalizeSanitationDayConfig(config);
  const year = current.year;

  if (op.type === "shiftYear") {
    if (op.year === year) return { config: current, changed: false, touchedDates: [] };
    const next = normalizeSanitationDayConfig(shiftCleaningsToYear(current, op.year));
    return { config: next, changed: true, touchedDates: [] };
  }

  if (op.type === "fillFromSchedule") {
    const rowFilter = op.rowIds ? new Set(op.rowIds) : null;
    const rows = current.rows.map((row) =>
      rowFilter && !rowFilter.has(row.id)
        ? row
        : reprojectSanitationRow({ ...row, cleanings: fillRow(row, op, ctx, year) }, year),
    );
    return finish(current, { ...current, rows });
  }

  const rowIndex = current.rows.findIndex((row) => row.id === op.rowId);
  if (rowIndex < 0) {
    throw new GeneralCleaningOpError("Строка графика не найдена — обновите страницу");
  }
  const row = current.rows[rowIndex];
  let cleanings = [...row.cleanings];
  const legacyNotes = row.legacyNotes ? { ...row.legacyNotes } : undefined;
  const slotIndex = (date: string) => cleanings.findIndex((c) => c.planned === date);

  switch (op.type) {
    case "addPlanned": {
      assertInYear(op.date, year);
      if (slotIndex(op.date) >= 0) break;
      const extra = cleanings.find((c) => !c.planned && c.done === op.date);
      cleanings = cleanings.filter((c) => c !== extra);
      cleanings.push(extra ? planned(op.date, op.date, extra) : planned(op.date));
      break;
    }
    case "removePlanned": {
      const index = slotIndex(op.date);
      if (index < 0) break;
      const slot = cleanings[index];
      cleanings.splice(index, 1);
      // Выполненная уборка из плана уходит, но факт остаётся —
      // внеплановой. Стереть и факт — только явным `dropDone`.
      if (slot.done && !op.dropDone) cleanings.push(unplanned(slot.done, slot));
      break;
    }
    case "movePlanned": {
      const index = slotIndex(op.from);
      if (index < 0) throw new GeneralCleaningOpError("Этой даты уже нет в плане — обновите страницу");
      if (cleanings[index].done) {
        throw new GeneralCleaningOpError("Уборка уже выполнена — переносить её не нужно");
      }
      assertInYear(op.to, year);
      if (op.to === op.from) break;
      if (slotIndex(op.to) >= 0) throw new GeneralCleaningOpError("На эту дату уборка уже в плане");
      cleanings.splice(index, 1);
      const extra = cleanings.find((c) => !c.planned && c.done === op.to);
      cleanings = cleanings.filter((c) => c !== extra);
      cleanings.push(extra ? planned(op.to, op.to, extra) : planned(op.to));
      break;
    }
    case "markDone": {
      const index = slotIndex(op.date);
      if (index < 0) throw new GeneralCleaningOpError("Этой даты уже нет в плане — обновите страницу");
      assertNotFuture(op.doneDate, ctx.todayKey, "Нельзя отметить уборку будущим числом");
      if (op.doneDate < addDays(op.date, -EARLY_DONE_DAYS)) {
        throw new GeneralCleaningOpError(
          "Отметка не может опережать план больше чем на неделю — добавьте внеплановую уборку",
        );
      }
      const slot = cleanings[index];
      if (slot.done === op.doneDate) break;
      cleanings[index] = planned(op.date, op.doneDate, manualMark(ctx));
      break;
    }
    case "unmarkDone": {
      const index = cleanings.findIndex((c) => c.id === op.slotId);
      if (index < 0) break;
      const slot = cleanings[index];
      if (slot.planned) cleanings[index] = planned(slot.planned);
      else cleanings.splice(index, 1);
      break;
    }
    case "addUnplanned": {
      assertInYear(op.date, year);
      assertNotFuture(
        op.date,
        ctx.todayKey,
        "Внеплановую уборку можно отметить только прошедшим или сегодняшним днём",
      );
      cleanings = markDay(cleanings, op.date, manualMark(ctx));
      break;
    }
    case "removeUnplanned": {
      cleanings = cleanings.filter((c) => !(!c.planned && c.done === op.date));
      break;
    }
    case "clearLegacyNote": {
      const note = legacyNotes?.[op.month];
      if (!legacyNotes || !note?.[op.kind]) break;
      const rest = { ...note };
      delete rest[op.kind];
      if (rest.plan || rest.fact) legacyNotes[op.month] = rest;
      else delete legacyNotes[op.month];
      break;
    }
    case "legacyNoteToDone": {
      assertInYear(op.date, year);
      const monthIndex = SANITATION_MONTHS.findIndex((m) => m.key === op.month);
      if (monthIndexOf(op.date) !== monthIndex) {
        throw new GeneralCleaningOpError("Дата должна быть в том же месяце, что и заметка");
      }
      assertNotFuture(op.date, ctx.todayKey, "Нельзя отметить уборку будущим числом");
      cleanings = markDay(cleanings, op.date, manualMark(ctx));
      if (legacyNotes?.[op.month]?.fact) {
        const rest = { ...legacyNotes[op.month] };
        delete rest.fact;
        if (rest.plan) legacyNotes[op.month] = rest;
        else delete legacyNotes[op.month];
      }
      break;
    }
  }

  const nextRow = reprojectSanitationRow({ ...row, cleanings, legacyNotes }, year);
  const rows = [...current.rows];
  rows[rowIndex] = nextRow;
  return finish(current, { ...current, rows });
}

function finish(before: SanitationDayConfig, after: SanitationDayConfig): GeneralCleaningOpResult {
  const next = normalizeSanitationDayConfig(after);
  const beforeById = new Map(before.rows.map((row) => [row.id, row]));
  const dates = new Set<string>();
  let changed = false;
  for (const row of next.rows) {
    const was = beforeById.get(row.id);
    if (!was || rowSignature(was) !== rowSignature(row)) {
      changed = true;
      if (was) touched(was, row).forEach((d) => dates.add(d));
    }
  }
  return { config: changed ? next : before, changed, touchedDates: [...dates].sort() };
}
