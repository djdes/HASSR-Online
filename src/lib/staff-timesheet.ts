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

/* ── Долг и переводы (2026-11-11) ─────────────────────────────────────── */

/** Период табеля в общем счёте: начислено и выплачено по нему. */
export type LedgerPeriod = { month: string; part: PaymentPart; due: number; paid: number };

/**
 * Все периоды человека по порядку (старые первыми): из месяцев табеля и
 * выплат. Периоды без начисления и без выплат не попадают.
 */
export function buildLedger(
  months: readonly { month: string; values: TimesheetValues }[],
  payments: readonly { month: string; part: PaymentPart; amountRub: number }[],
  ratePerHour: number,
): LedgerPeriod[] {
  const byKey = new Map<string, LedgerPeriod>();
  const at = (month: string, part: PaymentPart) => {
    const key = `${month}:${part}`;
    let period = byKey.get(key);
    if (!period) {
      period = { month, part, due: 0, paid: 0 };
      byKey.set(key, period);
    }
    return period;
  };
  for (const { month, values } of months) {
    const totals = computeMonth(values, ratePerHour, month);
    at(month, "advance").due += totals.period1.due;
    at(month, "final").due += totals.period2.due;
  }
  for (const payment of payments) at(payment.month, payment.part).paid += payment.amountRub;
  return [...byKey.values()]
    .filter((period) => period.due !== 0 || period.paid !== 0)
    .sort((a, b) => (a.month === b.month ? (a.part === "advance" ? -1 : 1) : a.month < b.month ? -1 : 1));
}

/** Общий счёт: начислено и выплачено за всё время; `debt` > 0 — долг, < 0 — переплата. */
export function ledgerBalance(periods: readonly LedgerPeriod[]): { due: number; paid: number; debt: number } {
  const due = periods.reduce((sum, period) => sum + period.due, 0);
  const paid = periods.reduce((sum, period) => sum + period.paid, 0);
  return { due, paid, debt: due - paid };
}

/**
 * Периоды, по которым ещё не доплачено, — старые первыми. Переплата по
 * одному периоду гасит самые старые долги: сумма `left` всегда равна
 * общему долгу (`ledgerBalance`).
 */
export function unpaidPeriods(periods: readonly LedgerPeriod[]): (LedgerPeriod & { left: number })[] {
  let credit = periods.reduce((sum, period) => sum + Math.max(0, period.paid - period.due), 0);
  const result: (LedgerPeriod & { left: number })[] = [];
  for (const period of periods) {
    let left = period.due - period.paid;
    if (left <= 0) continue;
    const offset = Math.min(credit, left);
    credit -= offset;
    left -= offset;
    if (left > 0) result.push({ ...period, left });
  }
  return result;
}

/**
 * Перевод любой суммы: гасит самые старые долги первыми, частично — тоже.
 * Что больше долга — `excess` (аванс в счёт текущего периода).
 */
export function allocateTransfer(
  periods: readonly LedgerPeriod[],
  amount: number,
): { parts: { month: string; part: PaymentPart; amountRub: number }[]; excess: number } {
  let rest = Math.max(0, Math.round(amount));
  const parts: { month: string; part: PaymentPart; amountRub: number }[] = [];
  for (const period of unpaidPeriods(periods)) {
    if (rest <= 0) break;
    const take = Math.min(rest, period.left);
    parts.push({ month: period.month, part: period.part, amountRub: take });
    rest -= take;
  }
  return { parts, excess: rest };
}

/** Период, к которому относится дата «2026-11-20»: 1–15 — аванс, дальше — расчёт. */
export function periodOfDate(date: string): { month: string; part: PaymentPart } {
  return { month: date.slice(0, 7), part: Number(date.slice(8, 10)) <= PERIOD1_LAST_DAY ? "advance" : "final" };
}

/**
 * «Заполнить будни»: пустые будни с 1-го по `lastDay` — `hours` часов.
 * Заполненные дни и выходные не трогаем.
 */
export function fillWeekdays(values: TimesheetValues, month: string, hours: number, lastDay: number): TimesheetValues {
  const next: TimesheetValues = { ...values };
  const last = Math.min(lastDay, daysInMonth(month));
  for (let day = 1; day <= last; day += 1) {
    const wd = weekday(month, day);
    if (wd === 0 || wd === 6 || next[String(day)] !== undefined) continue;
    next[String(day)] = hours;
  }
  return next;
}
