import { formatPositionWithName } from "@/lib/position-name-label";
import {
  roomGeneralSchedule,
  scheduledDatesInRange,
  type RoomGeneralSchedule,
  type RoomGeneralScheduleSource,
} from "@/lib/general-cleaning-schedule";
import { daysInMonth, formatDayMonth, isoDate, parseIsoDate } from "@/lib/wheel-date";

export const SANITATION_DAY_TEMPLATE_CODE = "general_cleaning";
export const SANITATION_DAY_SOURCE_SLUG = "sanitationdayjournal";

export const SANITATION_DAY_HEADING = "График и учет генеральных уборок";
export const SANITATION_DAY_DOCUMENT_TITLE = "График ген. уборок";

export const SANITATION_MONTHS = [
  { key: "jan", short: "Янв", label: "Январь" },
  { key: "feb", short: "Фев", label: "Февраль" },
  { key: "mar", short: "Мар", label: "Март" },
  { key: "apr", short: "Апр", label: "Апрель" },
  { key: "may", short: "Май", label: "Май" },
  { key: "jun", short: "Июн", label: "Июнь" },
  { key: "jul", short: "Июл", label: "Июль" },
  { key: "aug", short: "Авг", label: "Август" },
  { key: "sep", short: "Сен", label: "Сентябрь" },
  { key: "oct", short: "Окт", label: "Октябрь" },
  { key: "nov", short: "Ноя", label: "Ноябрь" },
  { key: "dec", short: "Дек", label: "Декабрь" },
] as const;

export type SanitationMonthKey = (typeof SANITATION_MONTHS)[number]["key"];

export type SanitationMonthValues = Record<SanitationMonthKey, string>;

/**
 * 2026-09-22: одна генеральная уборка — отдельная запись, а не число в
 * ячейке месяца. В месяце их может быть сколько угодно (каждую пятницу),
 * у каждой — своя дата плана и своя отметка «сделано».
 *
 *   id       "p:YYYY-MM-DD" — плановая (по дате плана),
 *            "u:YYYY-MM-DD" — внеплановая (по дате выполнения).
 *   planned  дата по плану (в году документа) или null у внеплановой.
 *   done     дата выполнения или null — ещё не сделана.
 *   doneBy   кто отметил (id сотрудника), если известно.
 *   doneSource  "manual" — отметили в журнале, "task" — пришло из задачи
 *            TasksFlow / QR. Снять отметку задачей можно только «task».
 */
export type SanitationCleaning = {
  id: string;
  planned: string | null;
  done: string | null;
  doneBy?: string | null;
  doneSource?: "manual" | "task";
};

/** Текст старой ячейки, который не удалось разобрать на даты («✓», «по графику»). */
export type SanitationLegacyNote = { plan?: string; fact?: string };
export type SanitationLegacyNotes = Partial<Record<SanitationMonthKey, SanitationLegacyNote>>;

export type SanitationRoomRow = {
  id: string;
  /**
   * 2026-09-04: связь со справочником помещений (Room.id). Если задана и
   * помещение живо — название берётся из Room
   * (applyRoomDirectoryToSanitationConfig); roomName остаётся снапшотом.
   * Строки без связи — legacy (свободный текст) — предлагаем «Связать».
   */
  roomId?: string;
  roomName: string;
  /**
   * ПРОЕКЦИЯ `cleanings` по месяцам: «04, 11, 18» или «-» (+ заметка
   * старой ячейки). Её печатает бланк и читают старые клиенты; источник
   * правды — `cleanings`. Нормализатор всегда пересчитывает проекцию, а
   * отличающуюся строку (правка старой вкладкой) разбирает обратно.
   */
  plan: SanitationMonthValues;
  fact: SanitationMonthValues;
  cleanings: SanitationCleaning[];
  legacyNotes?: SanitationLegacyNotes;
};

/** Помещение справочника — минимум для графика ген. уборок (+ его график). */
export type SanitationDirectoryRoom = { id: string; name: string } & RoomGeneralScheduleSource;

export type SanitationDayConfig = {
  year: number;
  documentDate: string;
  approveRole: string;
  approveEmployeeId?: string | null;
  approveEmployee: string;
  responsibleRole: string;
  responsibleEmployeeId?: string | null;
  responsibleEmployee: string;
  rows: SanitationRoomRow[];
};

const MONTH_KEYS: SanitationMonthKey[] = SANITATION_MONTHS.map((month) => month.key);

export const PLANNED_CLEANING_PREFIX = "p:";
export const UNPLANNED_CLEANING_PREFIX = "u:";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Отметка «сделано» ищет плановую уборку не дальше стольких дней. */
const PAIRING_WINDOW_DAYS = 3;

export function sanitationMonthKey(monthIndex: number): SanitationMonthKey {
  return MONTH_KEYS[Math.min(Math.max(monthIndex, 0), 11)];
}

export function sanitationCleaningId(planned: string | null, done: string | null): string {
  return planned ? `${PLANNED_CLEANING_PREFIX}${planned}` : `${UNPLANNED_CLEANING_PREFIX}${done ?? ""}`;
}

function toDateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function safeText(value: unknown) {
  return typeof value === "string" ? value : "";
}

function safeYear(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.trunc(value)
    : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && parseIsoDate(value) !== null;
}

function yearOf(iso: string): number {
  return Number(iso.slice(0, 4));
}

function monthIndexOf(iso: string): number {
  return Number(iso.slice(5, 7)) - 1;
}

function dayOf(iso: string): number {
  return Number(iso.slice(8, 10));
}

function inMonth(iso: string, year: number, monthIndex: number): boolean {
  return yearOf(iso) === year && monthIndexOf(iso) === monthIndex;
}

function dayDiff(a: string, b: string): number {
  return Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / DAY_MS);
}

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

/** Та же дата в другом году; 29 февраля в невисокосный → 28. */
function shiftIsoYear(iso: string, delta: number): string {
  const parts = parseIsoDate(iso);
  if (!parts || delta === 0) return iso;
  const year = parts.year + delta;
  return isoDate(year, parts.monthIndex, Math.min(parts.day, daysInMonth(year, parts.monthIndex)));
}

function createMonthValues(fill = "-"): SanitationMonthValues {
  return {
    jan: fill,
    feb: fill,
    mar: fill,
    apr: fill,
    may: fill,
    jun: fill,
    jul: fill,
    aug: fill,
    sep: fill,
    oct: fill,
    nov: fill,
    dec: fill,
  };
}

function normalizeCellText(value: unknown): string {
  return safeText(value).trim() || "-";
}

/* ------------------------------------------------------------------ *
 * Уборки: проверка, порядок, слияние
 * ------------------------------------------------------------------ */

function anchorOf(cleaning: Pick<SanitationCleaning, "planned" | "done">): string {
  return cleaning.planned ?? cleaning.done ?? "";
}

function compareCleanings(a: SanitationCleaning, b: SanitationCleaning): number {
  const byAnchor = anchorOf(a).localeCompare(anchorOf(b));
  if (byAnchor !== 0) return byAnchor;
  // В один день плановая — раньше внеплановой.
  return (a.planned ? 0 : 1) - (b.planned ? 0 : 1);
}

function makeCleaning(
  planned: string | null,
  done: string | null,
  meta: { doneBy?: string | null; doneSource?: "manual" | "task" } = {},
): SanitationCleaning {
  const out: SanitationCleaning = { id: sanitationCleaningId(planned, done), planned, done };
  if (done) {
    if (typeof meta.doneBy === "string" && meta.doneBy) out.doneBy = meta.doneBy;
    if (meta.doneSource === "manual" || meta.doneSource === "task") out.doneSource = meta.doneSource;
  }
  return out;
}

/**
 * Одна уборка из сырого JSON. Даты чужого года переезжают в год
 * документа по дате-якорю (плана, а у внеплановой — выполнения): так
 * смена года в настройках не теряет ни плана, ни отметок.
 */
function validateCleaning(raw: unknown, year: number): SanitationCleaning | null {
  if (!isRecord(raw)) return null;
  let planned = isIsoDate(raw.planned) ? raw.planned : null;
  let done = isIsoDate(raw.done) ? raw.done : null;
  if (!planned && !done) return null;
  const delta = year - yearOf((planned ?? done) as string);
  if (delta !== 0) {
    planned = planned ? shiftIsoYear(planned, delta) : null;
    done = done ? shiftIsoYear(done, delta) : null;
  }
  return makeCleaning(planned, done, {
    doneBy: typeof raw.doneBy === "string" ? raw.doneBy : null,
    doneSource: raw.doneSource === "task" || raw.doneSource === "manual" ? raw.doneSource : undefined,
  });
}

/**
 * Без повторов и по порядку. Внеплановая в день открытой плановой —
 * это и есть её выполнение; внеплановая в день, когда плановая уже
 * закрыта этим числом, — повтор.
 */
function tidyCleanings(list: ReadonlyArray<SanitationCleaning>): SanitationCleaning[] {
  const byId = new Map<string, SanitationCleaning>();
  for (const item of list) {
    const prev = byId.get(item.id);
    if (!prev) {
      byId.set(item.id, { ...item });
      continue;
    }
    if (!prev.done && item.done) byId.set(item.id, { ...item });
  }
  const planned = [...byId.values()].filter((c) => c.planned);
  const unplanned = [...byId.values()].filter((c) => !c.planned);
  const plannedByDate = new Map(planned.map((c) => [c.planned as string, c]));
  const kept: SanitationCleaning[] = [...planned];
  for (const extra of unplanned) {
    const date = extra.done as string;
    const sameDay = plannedByDate.get(date);
    if (sameDay && !sameDay.done) {
      const merged = makeCleaning(sameDay.planned, date, extra);
      kept[kept.indexOf(sameDay)] = merged;
      plannedByDate.set(date, merged);
      continue;
    }
    if (kept.some((c) => c.planned && c.done === date)) continue;
    kept.push(extra);
  }
  return kept.sort(compareCleanings);
}

function validateNotes(raw: unknown): SanitationLegacyNotes {
  const out: SanitationLegacyNotes = {};
  if (!isRecord(raw)) return out;
  for (const key of MONTH_KEYS) {
    const entry = raw[key];
    if (!isRecord(entry)) continue;
    const plan = safeText(entry.plan).trim();
    const fact = safeText(entry.fact).trim();
    if (plan || fact) out[key] = { ...(plan ? { plan } : {}), ...(fact ? { fact } : {}) };
  }
  return out;
}

function setNote(
  notes: SanitationLegacyNotes,
  monthIndex: number,
  kind: "plan" | "fact",
  text: string,
) {
  const key = MONTH_KEYS[monthIndex];
  const next: SanitationLegacyNote = { ...(notes[key] ?? {}) };
  if (text) next[kind] = text;
  else delete next[kind];
  if (next.plan || next.fact) notes[key] = next;
  else delete notes[key];
}

/* ------------------------------------------------------------------ *
 * Ячейка месяца: разбор строки и проекция
 * ------------------------------------------------------------------ */

/**
 * Текст ячейки месяца → дни и нераспознанный остаток.
 * Понимает «10, 17; 24», «4 11 18», «05.09» / «05.09.2026» (только
 * своего месяца и года). Остальное («✓», «+», «по графику», «10
 * (перенос)», 31 сентября) — заметка, она печатается как была.
 */
export function parseMonthCellTokens(
  text: string,
  year: number,
  monthIndex: number,
): { days: number[]; notes: string } {
  const value = safeText(text).trim();
  if (!value || /^[-–—]$/.test(value)) return { days: [], notes: "" };
  const max = daysInMonth(year, monthIndex);
  const days = new Set<number>();
  const notes: string[] = [];
  for (const raw of value.split(/[,;]/)) {
    const token = raw.trim();
    if (!token || /^[-–—]$/.test(token)) continue;
    if (/^\d{1,2}(\s+\d{1,2})*$/.test(token)) {
      const numbers = token.split(/\s+/).map(Number);
      if (numbers.every((n) => n >= 1 && n <= max)) {
        numbers.forEach((n) => days.add(n));
        continue;
      }
      notes.push(token);
      continue;
    }
    const match = /^(\d{1,2})\.(\d{1,2})(?:\.(\d{2}|\d{4}))?$/.exec(token);
    if (match) {
      const day = Number(match[1]);
      const month = Number(match[2]) - 1;
      const tokenYear = match[3]
        ? match[3].length === 2
          ? 2000 + Number(match[3])
          : Number(match[3])
        : year;
      if (month === monthIndex && tokenYear === year && day >= 1 && day <= max) {
        days.add(day);
        continue;
      }
    }
    notes.push(token);
  }
  return { days: [...days].sort((a, b) => a - b), notes: notes.join(", ") };
}

/**
 * Проекция уборок в ячейку месяца: дни двумя цифрами через запятую,
 * затем заметка старой ячейки, пусто — «-». Выполнение в другом году
 * (план 31.12, сделали 02.01) печатается «02.01» в месяце плана.
 */
export function projectMonthCell(
  cleanings: ReadonlyArray<SanitationCleaning>,
  notes: SanitationLegacyNotes | undefined,
  year: number,
  monthIndex: number,
  kind: "plan" | "fact",
): string {
  const days = new Set<number>();
  const foreign: string[] = [];
  for (const cleaning of cleanings) {
    if (kind === "plan") {
      if (cleaning.planned && inMonth(cleaning.planned, year, monthIndex)) {
        days.add(dayOf(cleaning.planned));
      }
      continue;
    }
    if (!cleaning.done) continue;
    if (inMonth(cleaning.done, year, monthIndex)) {
      days.add(dayOf(cleaning.done));
    } else if (
      cleaning.planned &&
      inMonth(cleaning.planned, year, monthIndex) &&
      yearOf(cleaning.done) !== year
    ) {
      foreign.push(formatDayMonth(cleaning.done));
    }
  }
  const tokens = [...days].sort((a, b) => a - b).map(pad2);
  tokens.push(...foreign.sort());
  const note = notes?.[MONTH_KEYS[monthIndex]]?.[kind]?.trim();
  if (note) tokens.push(note);
  return tokens.length > 0 ? tokens.join(", ") : "-";
}

type DoneMark = { date: string; doneBy?: string | null; doneSource?: "manual" | "task" };

/** Отметки без повторов по дате; при повторе важнее «task» и известный автор. */
function uniqueMarks(marks: ReadonlyArray<DoneMark>): DoneMark[] {
  const byDate = new Map<string, DoneMark>();
  for (const mark of marks) {
    const prev = byDate.get(mark.date);
    if (!prev || (prev.doneSource !== "task" && mark.doneSource === "task") || (!prev.doneBy && mark.doneBy)) {
      byDate.set(mark.date, { ...(prev ?? {}), ...mark });
    }
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Отметки «сделано» → уборки: сначала в тот же день, что и план, потом
 * к ближайшей открытой плановой в пределах трёх дней, иначе —
 * внеплановая уборка.
 */
function pairMarks(slots: SanitationCleaning[], marks: ReadonlyArray<DoneMark>): SanitationCleaning[] {
  const out = slots.map((slot) => ({ ...slot }));
  const assign = (index: number, mark: DoneMark) => {
    out[index] = makeCleaning(out[index].planned, mark.date, mark);
  };
  const rest: DoneMark[] = [];
  for (const mark of uniqueMarks(marks)) {
    const index = out.findIndex((slot) => slot.planned === mark.date && !slot.done);
    if (index >= 0) assign(index, mark);
    else rest.push(mark);
  }
  for (const mark of rest) {
    let best = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    out.forEach((slot, index) => {
      if (!slot.planned || slot.done) return;
      const distance = Math.abs(dayDiff(slot.planned, mark.date));
      if (distance > PAIRING_WINDOW_DAYS) return;
      if (
        distance < bestDistance ||
        (distance === bestDistance && best >= 0 && (slot.planned as string) < (out[best].planned as string))
      ) {
        best = index;
        bestDistance = distance;
      }
    });
    if (best >= 0) assign(best, mark);
    else out.push(makeCleaning(null, mark.date, mark));
  }
  return out;
}

type ParsedCell = { days: number[]; notes: string };

function applyCellEdits(
  cleanings: ReadonlyArray<SanitationCleaning>,
  notes: SanitationLegacyNotes,
  year: number,
  planEdits: Map<number, ParsedCell>,
  factEdits: Map<number, ParsedCell>,
): { cleanings: SanitationCleaning[]; legacyNotes: SanitationLegacyNotes } {
  let slots = cleanings.map((c) => ({ ...c }));
  const nextNotes: SanitationLegacyNotes = { ...notes };
  let orphanMarks: DoneMark[] = [];

  // План месяца = ровно даты из строки. Выполненная уборка, ушедшая из
  // плана, отметку не теряет — та ищет себе пару заново.
  for (const [monthIndex, parsed] of planEdits) {
    const wanted = new Set(parsed.days.map((day) => isoDate(year, monthIndex, day)));
    const kept: SanitationCleaning[] = [];
    for (const slot of slots) {
      if (slot.planned && inMonth(slot.planned, year, monthIndex) && !wanted.has(slot.planned)) {
        if (slot.done) {
          orphanMarks.push({ date: slot.done, doneBy: slot.doneBy, doneSource: slot.doneSource });
        }
        continue;
      }
      kept.push(slot);
    }
    const present = new Set(kept.map((slot) => slot.planned).filter(Boolean));
    for (const date of wanted) {
      if (!present.has(date)) kept.push(makeCleaning(date, null));
    }
    slots = kept;
    setNote(nextNotes, monthIndex, "plan", parsed.notes);
  }

  // Факт месяца = ровно дни из строки. Автор и источник отметки
  // сохраняются, если такой день уже был отмечен.
  const newMarks: DoneMark[] = [];
  for (const [monthIndex, parsed] of factEdits) {
    const previous = new Map<string, DoneMark>();
    slots = slots.flatMap((slot) => {
      if (!slot.done || !inMonth(slot.done, year, monthIndex)) return [slot];
      previous.set(slot.done, { date: slot.done, doneBy: slot.doneBy, doneSource: slot.doneSource });
      return slot.planned ? [makeCleaning(slot.planned, null)] : [];
    });
    orphanMarks = orphanMarks.filter((mark) => {
      if (!inMonth(mark.date, year, monthIndex)) return true;
      if (!previous.has(mark.date)) previous.set(mark.date, mark);
      return false;
    });
    for (const day of parsed.days) {
      const date = isoDate(year, monthIndex, day);
      const old = previous.get(date);
      newMarks.push({ date, doneBy: old?.doneBy, doneSource: old?.doneSource ?? "manual" });
    }
    setNote(nextNotes, monthIndex, "fact", parsed.notes);
  }

  return {
    cleanings: tidyCleanings(pairMarks(slots, [...orphanMarks, ...newMarks])),
    legacyNotes: nextNotes,
  };
}

/**
 * Уборки строки из сырого JSON — ленивая миграция без потерь.
 *
 * Строка без `cleanings` (старый формат) разбирается из текста ячеек.
 * У строки с `cleanings` ячейка месяца, которая не совпадает с проекцией
 * (её поменяла старая вкладка или внешний API), тоже разбирается заново
 * — побеждает текст, отметки о выполнении живут дальше.
 */
export function reconcileRowCleanings(
  rawRow: unknown,
  year: number,
): { cleanings: SanitationCleaning[]; legacyNotes: SanitationLegacyNotes } {
  const source = isRecord(rawRow) ? rawRow : {};
  const hasCleanings = Array.isArray(source.cleanings);
  const cleanings = tidyCleanings(
    (hasCleanings ? (source.cleanings as unknown[]) : [])
      .map((item) => validateCleaning(item, year))
      .filter((item): item is SanitationCleaning => item !== null),
  );
  const notes = validateNotes(source.legacyNotes);
  const rawPlan = isRecord(source.plan) ? source.plan : null;
  const rawFact = isRecord(source.fact) ? source.fact : null;

  const planEdits = new Map<number, ParsedCell>();
  const factEdits = new Map<number, ParsedCell>();
  MONTH_KEYS.forEach((key, monthIndex) => {
    if (!hasCleanings) {
      planEdits.set(monthIndex, parseMonthCellTokens(safeText(rawPlan?.[key]), year, monthIndex));
      factEdits.set(monthIndex, parseMonthCellTokens(safeText(rawFact?.[key]), year, monthIndex));
      return;
    }
    const plan = rawPlan?.[key];
    if (
      typeof plan === "string" &&
      normalizeCellText(plan) !== projectMonthCell(cleanings, notes, year, monthIndex, "plan")
    ) {
      planEdits.set(monthIndex, parseMonthCellTokens(plan, year, monthIndex));
    }
    const fact = rawFact?.[key];
    if (
      typeof fact === "string" &&
      normalizeCellText(fact) !== projectMonthCell(cleanings, notes, year, monthIndex, "fact")
    ) {
      factEdits.set(monthIndex, parseMonthCellTokens(fact, year, monthIndex));
    }
  });

  if (planEdits.size === 0 && factEdits.size === 0) {
    return { cleanings, legacyNotes: notes };
  }
  return applyCellEdits(cleanings, notes, year, planEdits, factEdits);
}

/** Строка с пересчитанной проекцией plan/fact — после любой правки `cleanings`. */
export function reprojectSanitationRow(
  row: Omit<SanitationRoomRow, "plan" | "fact"> & Partial<Pick<SanitationRoomRow, "plan" | "fact">>,
  year: number,
): SanitationRoomRow {
  const cleanings = tidyCleanings(row.cleanings);
  const notes = validateNotes(row.legacyNotes);
  const plan = createMonthValues("-");
  const fact = createMonthValues("-");
  MONTH_KEYS.forEach((key, monthIndex) => {
    plan[key] = projectMonthCell(cleanings, notes, year, monthIndex, "plan");
    fact[key] = projectMonthCell(cleanings, notes, year, monthIndex, "fact");
  });
  const out: SanitationRoomRow = {
    id: row.id,
    ...(row.roomId ? { roomId: row.roomId } : {}),
    roomName: row.roomName,
    plan,
    fact,
    cleanings,
  };
  if (Object.keys(notes).length > 0) out.legacyNotes = notes;
  return out;
}

function normalizeRows(value: unknown, year: number): SanitationRoomRow[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((row, index) => {
      if (!row || typeof row !== "object") return null;
      const source = row as Record<string, unknown>;
      const roomId =
        typeof source.roomId === "string" && source.roomId.length > 0
          ? source.roomId
          : undefined;
      const { cleanings, legacyNotes } = reconcileRowCleanings(source, year);
      return reprojectSanitationRow(
        {
          id:
            typeof source.id === "string" && source.id.length > 0
              ? source.id
              : `row-${index + 1}`,
          ...(roomId ? { roomId } : {}),
          roomName: safeText(source.roomName),
          cleanings,
          legacyNotes,
        },
        year,
      );
    })
    .filter((item): item is SanitationRoomRow => item !== null);
}

/* ------------------------------------------------------------------ *
 * Чтение уборок для экрана
 * ------------------------------------------------------------------ */

/**
 * Уборки месяца: плановые (по дате плана), внеплановые и все выполненные
 * (по дате выполнения). `year` — отсечь даты другого года.
 */
export function monthCleanings(
  row: Pick<SanitationRoomRow, "cleanings">,
  monthIndex: number,
  year?: number,
): { planned: SanitationCleaning[]; unplanned: SanitationCleaning[]; done: SanitationCleaning[] } {
  const fits = (iso: string) =>
    monthIndexOf(iso) === monthIndex && (year === undefined || yearOf(iso) === year);
  const planned = row.cleanings.filter((c) => c.planned && fits(c.planned));
  const unplanned = row.cleanings.filter((c) => !c.planned && c.done && fits(c.done));
  const done = row.cleanings
    .filter((c) => c.done && fits(c.done))
    .sort((a, b) => (a.done as string).localeCompare(b.done as string));
  return { planned, unplanned, done };
}

/**
 * Отметки «Факт» месяца так же, как их печатает бланк: день месяца или
 * «ДД.ММ», если плановую уборку этого месяца выполнили уже в другом году.
 */
export function monthFactMarks(
  row: Pick<SanitationRoomRow, "cleanings">,
  year: number,
  monthIndex: number,
): Array<{ cleaning: SanitationCleaning; label: string }> {
  const marks = monthCleanings(row, monthIndex, year).done.map((cleaning) => ({
    cleaning,
    label: pad2(dayOf(cleaning.done as string)),
  }));
  for (const cleaning of row.cleanings) {
    if (
      cleaning.done &&
      cleaning.planned &&
      inMonth(cleaning.planned, year, monthIndex) &&
      yearOf(cleaning.done) !== year
    ) {
      marks.push({ cleaning, label: formatDayMonth(cleaning.done) });
    }
  }
  return marks;
}

export type CleaningStatus = "done" | "overdue" | "today" | "planned";

/** Состояние уборки на «сегодня» (по поясу организации). */
export function cleaningStatus(cleaning: SanitationCleaning, todayKey: string): CleaningStatus {
  if (cleaning.done) return "done";
  const planned = cleaning.planned ?? "";
  if (planned < todayKey) return "overdue";
  if (planned === todayKey) return "today";
  return "planned";
}

/** Сводка строки: сколько в плане, сделано (вместе с внеплановыми), просрочено. */
export function summarizeCleanings(
  cleanings: ReadonlyArray<SanitationCleaning>,
  todayKey: string,
): { planned: number; done: number; overdue: number; unplanned: number } {
  let planned = 0;
  let done = 0;
  let overdue = 0;
  let unplanned = 0;
  for (const cleaning of cleanings) {
    if (cleaning.planned) planned += 1;
    else unplanned += 1;
    if (cleaning.done) done += 1;
    else if (cleaning.planned && cleaning.planned < todayKey) overdue += 1;
  }
  return { planned, done, overdue, unplanned };
}

/**
 * С какой даты сеять план по графику для документа года `year`:
 * с сегодня, но не раньше 1 января; прошедший год — не сеем (null).
 */
export function sanitationScheduleFromKey(year: number, todayKey: string): string | null {
  const start = `${year}-01-01`;
  const end = `${year}-12-31`;
  const from = todayKey > start ? todayKey : start;
  return from <= end ? from : null;
}

/* ------------------------------------------------------------------ *
 * Смена года
 * ------------------------------------------------------------------ */

function shiftRowCleanings(
  row: SanitationRoomRow,
  year: number,
  keepFacts: boolean,
): SanitationRoomRow {
  const shifted: SanitationCleaning[] = [];
  for (const cleaning of row.cleanings) {
    const anchor = anchorOf(cleaning);
    if (!anchor) continue;
    const delta = year - yearOf(anchor);
    const planned = cleaning.planned ? shiftIsoYear(cleaning.planned, delta) : null;
    if (!keepFacts) {
      if (planned) shifted.push(makeCleaning(planned, null));
      continue;
    }
    const done = cleaning.done ? shiftIsoYear(cleaning.done, delta) : null;
    shifted.push(makeCleaning(planned, done, cleaning));
  }
  const notes: SanitationLegacyNotes = {};
  for (const key of MONTH_KEYS) {
    const note = row.legacyNotes?.[key];
    if (!note) continue;
    const kept = keepFacts ? { ...note } : note.plan ? { plan: note.plan } : null;
    if (kept && (kept.plan || kept.fact)) notes[key] = kept;
  }
  return reprojectSanitationRow({ ...row, cleanings: shifted, legacyNotes: notes }, year);
}

/**
 * Документ на другой год. `keepFacts` (по умолчанию) — все даты и
 * отметки переезжают с теми же числами (исправили год в настройках);
 * `keepFacts: false` — только план, как у копии на новый год.
 */
export function shiftCleaningsToYear(
  config: SanitationDayConfig,
  year: number,
  options: { keepFacts?: boolean } = {},
): SanitationDayConfig {
  const keepFacts = options.keepFacts !== false;
  return {
    ...config,
    year,
    rows: config.rows.map((row) => shiftRowCleanings(row, year, keepFacts)),
  };
}

/**
 * Строка графика для копии на новый год: план переезжает на те же числа,
 * отметки о выполнении и внеплановые уборки остаются в старом году,
 * заметки плана сохраняются, заметки факта — нет.
 */
export function copySanitationRowToYear(
  rawRow: unknown,
  sourceYear: number,
  targetYear: number,
): SanitationRoomRow {
  const [row] = normalizeRows([rawRow], sourceYear);
  return shiftRowCleanings(
    row ?? reprojectSanitationRow({ id: "row-1", roomName: "", cleanings: [] }, sourceYear),
    targetYear,
    false,
  );
}

/* ------------------------------------------------------------------ *
 * Строки и конфиг
 * ------------------------------------------------------------------ */

/** Стабильный id строки для помещения справочника. */
export function sanitationRowIdForRoom(roomId: string): string {
  return `row-room-${roomId}`;
}

/**
 * Новая строка графика. С графиком помещения и `fromKey` план сразу
 * заполнен датами по графику — с `fromKey` до конца его года.
 */
export function createEmptySanitationRow(
  name = "",
  roomId?: string,
  schedule?: RoomGeneralSchedule | null,
  fromKey?: string | null,
): SanitationRoomRow {
  const from = fromKey ? parseIsoDate(fromKey) : null;
  const year = from?.year ?? new Date().getUTCFullYear();
  const cleanings =
    schedule && from && fromKey
      ? scheduledDatesInRange(schedule, fromKey, `${from.year}-12-31`).map((date) =>
          makeCleaning(date, null),
        )
      : [];
  return reprojectSanitationRow(
    {
      id: roomId
        ? sanitationRowIdForRoom(roomId)
        : `row-${Math.random().toString(36).slice(2, 9)}`,
      ...(roomId ? { roomId } : {}),
      roomName: name,
      cleanings,
    },
    year,
  );
}

/**
 * Строит конфиг графика ген. уборок из помещений справочника (Room,
 * /settings/buildings). Пусто — stub-дефолт.
 *
 * 2026-09-22: план сразу заполнен по графику помещения — с `fromKey`
 * (по умолчанию — день `date`) до 31 декабря года документа; прошедшие
 * дни не трогаем.
 */
export function buildSanitationDayConfigFromRooms(
  rooms: ReadonlyArray<SanitationDirectoryRoom>,
  date = new Date(),
  options: { fromKey?: string | null } = {},
): SanitationDayConfig {
  if (rooms.length === 0) {
    return getSanitationDayDefaultConfig(date);
  }
  const base = buildSanitationDayConfigFromAreas([], date);
  const fromKey = sanitationScheduleFromKey(base.year, options.fromKey || toDateKey(date));
  return {
    ...base,
    rows: rooms.map((room) =>
      createEmptySanitationRow(room.name, room.id, roomGeneralSchedule(room), fromKey),
    ),
  };
}

/**
 * Эффективный конфиг: у строк с `roomId` название берётся из справочника
 * (Room wins), если помещение живо. Только для отображения — в документ
 * пишется raw-конфиг.
 */
export function applyRoomDirectoryToSanitationConfig(
  config: SanitationDayConfig,
  rooms: ReadonlyArray<SanitationDirectoryRoom>,
): SanitationDayConfig {
  const byId = new Map(rooms.map((r) => [r.id, r]));
  return {
    ...config,
    rows: config.rows.map((row) => {
      if (!row.roomId) return row;
      const dbRoom = byId.get(row.roomId);
      if (!dbRoom) return row;
      return { ...row, roomName: dbRoom.name.trim() || row.roomName };
    }),
  };
}

/** Помещения справочника, которых ещё нет в графике. */
export function listSanitationRoomsNotInDocument<T extends SanitationDirectoryRoom>(
  config: Pick<SanitationDayConfig, "rows">,
  rooms: ReadonlyArray<T>,
): T[] {
  const linked = new Set(config.rows.map((r) => r.roomId).filter(Boolean));
  return rooms.filter((r) => !linked.has(r.id));
}

/** Подсказка «Связать» для legacy-строки: помещение с тем же названием. */
export function suggestDirectoryRoomForSanitationRow<T extends SanitationDirectoryRoom>(
  row: Pick<SanitationRoomRow, "roomName" | "roomId">,
  rooms: ReadonlyArray<T>,
): T | null {
  if (row.roomId) return null;
  const needle = row.roomName.trim().toLowerCase();
  if (!needle) return null;
  return rooms.find((r) => r.name.trim().toLowerCase() === needle) ?? null;
}

/**
 * Строит конфиг санитарного дня из списка цехов/помещений (Area).
 * Каждый цех становится строкой таблицы с пустыми planned/fact
 * месяцами — заведующая потом проставит даты по графику.
 *
 * Если areas пустой — возвращает stub-дефолт с двумя примерами.
 */
export function buildSanitationDayConfigFromAreas(
  areas: Array<{ id: string; name: string }>,
  date = new Date(),
): SanitationDayConfig {
  if (areas.length === 0) {
    return getSanitationDayDefaultConfig(date);
  }

  const year = date.getUTCFullYear();
  const d = new Date(Date.UTC(year, 0, 1));

  return {
    year,
    documentDate: toDateKey(d),
    approveRole: "Управляющий",
    approveEmployeeId: null,
    approveEmployee: "",
    responsibleRole: "Управляющий",
    responsibleEmployeeId: null,
    responsibleEmployee: "",
    rows: areas.map((area, index) =>
      reprojectSanitationRow(
        {
          id: `row-area-${area.id || `idx-${index}`}`,
          roomName: area.name,
          cleanings: [],
        },
        year,
      ),
    ),
  };
}

export function getSanitationDayDefaultConfig(
  date = new Date(),
): SanitationDayConfig {
  const year = date.getUTCFullYear();
  const d = new Date(Date.UTC(year, 0, 1));

  return {
    year,
    documentDate: toDateKey(d),
    approveRole: "Управляющий",
    approveEmployeeId: null,
    approveEmployee: "",
    responsibleRole: "Управляющий",
    responsibleEmployeeId: null,
    responsibleEmployee: "",
    // Образец в старом строковом виде — нормализатор разбирает его в
    // уборки тем же путём, что и документы до 2026-09-22.
    rows: normalizeRows(
      [
        {
          id: "row-1",
          roomName: "Производство 1 этаж",
          plan: {
            ...createMonthValues("10"),
            jun: "-",
            apr: "10, 17, 24",
          },
          fact: {
            ...createMonthValues("10"),
            feb: "01",
            apr: "01",
            jun: "-",
          },
        },
        {
          id: "row-2",
          roomName: "сухой склад",
          plan: {
            ...createMonthValues("-"),
            apr: "14",
          },
          fact: {
            ...createMonthValues("-"),
            apr: "14",
          },
        },
      ],
      year,
    ),
  };
}

export function normalizeSanitationDayConfig(
  config: unknown,
): SanitationDayConfig {
  const fallback = getSanitationDayDefaultConfig();
  if (!config || typeof config !== "object" || Array.isArray(config))
    return fallback;
  const source = config as Record<string, unknown>;
  const year = safeYear(source.year, fallback.year);

  return {
    year,
    documentDate: safeText(source.documentDate) || fallback.documentDate,
    approveRole: safeText(source.approveRole) || fallback.approveRole,
    approveEmployeeId:
      safeText(source.approveEmployeeId) || fallback.approveEmployeeId || null,
    approveEmployee:
      safeText(source.approveEmployee) || fallback.approveEmployee,
    responsibleRole:
      safeText(source.responsibleRole) || fallback.responsibleRole,
    responsibleEmployeeId:
      safeText(source.responsibleEmployeeId) ||
      fallback.responsibleEmployeeId ||
      null,
    responsibleEmployee:
      safeText(source.responsibleEmployee) || fallback.responsibleEmployee,
    rows: normalizeRows(source.rows, year),
  };
}

export function getSanitationYearLabel(year: number) {
  return String(year);
}

export function getSanitationDocumentDateLabel(dateKey: string) {
  if (!dateKey) return "—";
  const [year, month, day] = dateKey.split("-");
  if (!year || !month || !day) return dateKey;
  return `${day}-${month}-${year}`;
}

/**
 * «Должность + сотрудник» одной строкой.
 *
 * G3 аудита: в служебной строке бланка эталон разделяет их ЗАПЯТОЙ
 * («Заведующий, Иванова Анна Петровна»), а не двоеточием. В карточках
 * списка документов двоеточие осталось — там это подпись «должность:
 * сотрудник», поэтому разделитель параметризован.
 */
export function getSanitationApproveLabel(
  role: string,
  employee: string,
  separator = ": ",
) {
  // Разделитель — только между двумя непустыми частями: без сотрудника
  // здесь печаталось «Управляющий:» с пустотой после двоеточия.
  return formatPositionWithName(role, employee, { separator });
}
