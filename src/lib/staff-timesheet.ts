/**
 * Табель сотрудников платформы (/root/timesheet, 2026-11-11) — по образцу
 * DocsFlow. Чистый модуль: разбор ячейки, расчёт периода и выплат.
 *
 * Месяц делится на два периода: 1–15 — аванс, 16–конец — расчёт. В ячейке
 * дня — отработанные часы числом или статус («О» отпуск, «Б» больничный,
 * «В» выходной). Начисление периода = часы × ставка за час + премия/штраф.
 */

export const PERIOD1_LAST_DAY = 15;
export const TIMESHEET_STATUSES = { О: "Отпуск", Б: "Больничный", В: "Выходной" } as const;
export type TimesheetStatus = keyof typeof TIMESHEET_STATUSES;
export type TimesheetCell = number | TimesheetStatus;
export type TimesheetValues = Record<string, TimesheetCell | undefined> & { p1?: number; p2?: number };
export type PaymentPart = "advance" | "final";

export const PART_LABELS: Record<PaymentPart, string> = { advance: "Аванс · 1–15", final: "Расчёт · 16–конец" };

/** «2026-11» из даты по Москве. */
export function monthKey(date: Date): string {
  return new Date(date.getTime() + 3 * 60 * 60 * 1000).toISOString().slice(0, 7);
}

export function isMonthKey(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

export function daysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** 0 — воскресенье … 6 — суббота. */
export function weekday(month: string, day: number): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day)).getUTCDay();
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

/**
 * Ввод в ячейку дня: «8», «7,5», «о»/«б»/«в», пусто. Часы — от 0,25 до 24
 * с шагом 0,25. undefined — очистить ячейку; null — ввод не понят.
 */
export function parseCell(raw: string): TimesheetCell | undefined | null {
  const text = raw.trim().toUpperCase().replace("Ё", "Е");
  if (!text) return undefined;
  if (text in TIMESHEET_STATUSES) return text as TimesheetStatus;
  const n = Number(text.replace(",", "."));
  if (!Number.isFinite(n) || n <= 0 || n > 24) return null;
  return Math.round(n * 4) / 4;
}

/** Премия или штраф: «1500», «-500», пусто → 0; null — не число. */
export function parseMoney(raw: string): number | null {
  const text = raw.trim().replace(/\s/g, "").replace(",", ".");
  if (!text) return 0;
  const n = Number(text);
  return Number.isFinite(n) && Math.abs(n) <= 10_000_000 ? Math.round(n) : null;
}

export function normalizeValues(raw: unknown): TimesheetValues {
  const source = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const values: TimesheetValues = {};
  for (let day = 1; day <= 31; day += 1) {
    const v = source[String(day)];
    if (typeof v === "number" && v > 0 && v <= 24) values[String(day)] = v;
    else if (typeof v === "string" && v in TIMESHEET_STATUSES) values[String(day)] = v as TimesheetStatus;
  }
  for (const key of ["p1", "p2"] as const) {
    const v = source[key];
    if (typeof v === "number" && Number.isFinite(v) && v !== 0) values[key] = Math.round(v);
  }
  return values;
}

export type PeriodTotals = { hours: number; earned: number; bonus: number; due: number };
export type MonthTotals = { period1: PeriodTotals; period2: PeriodTotals; hours: number; due: number; statuses: Record<TimesheetStatus, number> };

export function computeMonth(values: TimesheetValues, ratePerHour: number, month: string): MonthTotals {
  const dim = daysInMonth(month);
  const statuses: Record<TimesheetStatus, number> = { О: 0, Б: 0, В: 0 };
  let h1 = 0;
  let h2 = 0;
  for (let day = 1; day <= dim; day += 1) {
    const v = values[String(day)];
    if (typeof v === "number") {
      if (day <= PERIOD1_LAST_DAY) h1 += v;
      else h2 += v;
    } else if (v) statuses[v] += 1;
  }
  const period = (hours: number, bonus: number): PeriodTotals => {
    const earned = Math.round(hours * ratePerHour);
    return { hours, earned, bonus, due: earned + bonus };
  };
  const period1 = period(h1, values.p1 ?? 0);
  const period2 = period(h2, values.p2 ?? 0);
  return { period1, period2, hours: h1 + h2, due: period1.due + period2.due, statuses };
}

/** Сколько осталось выплатить за период: начислено − выплачено (не меньше нуля для подсказки). */
export function remaining(due: number, paid: number): number {
  return Math.max(0, due - paid);
}

export function formatHours(hours: number): string {
  return hours.toLocaleString("ru-RU", { maximumFractionDigits: 2 });
}

export function formatRub(value: number): string {
  return `${Math.round(value).toLocaleString("ru-RU").replace(/\s/g, " ")} ₽`;
}
