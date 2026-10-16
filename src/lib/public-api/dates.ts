import { orgTodayKey } from "@/lib/timezone";

/** Даты инструментов — ключи YYYY-MM-DD в часовом поясе организации. */

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

export function isValidDateKey(value: string): boolean {
  if (!DATE_KEY.test(value)) return false;
  const d = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function resolveDateKey(
  input: string | undefined,
  timezone: string | null,
  now: Date = new Date()
): { ok: true; dateKey: string } | { ok: false; error: string } {
  if (input === undefined || input === "") {
    return { ok: true, dateKey: orgTodayKey(timezone ?? undefined, now) };
  }
  if (!isValidDateKey(input)) {
    return { ok: false, error: `Дата «${input}» не в формате YYYY-MM-DD или не существует.` };
  }
  return { ok: true, dateKey: input };
}

/**
 * Момент внутри календарного дня `dateKey` для всех часовых поясов РФ
 * (UTC+2…UTC+12): 06:00 UTC — это 08:00 в Калининграде и 18:00 на
 * Камчатке. Нужен функциям, которые сами вычисляют «день организации».
 */
export function instantForDateKey(dateKey: string): Date {
  return new Date(`${dateKey}T06:00:00.000Z`);
}

export function shiftDateKey(dateKey: string, days: number): string {
  return new Date(new Date(`${dateKey}T00:00:00.000Z`).getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  return Math.round((new Date(`${to}T00:00:00.000Z`).getTime() - new Date(`${from}T00:00:00.000Z`).getTime()) / DAY_MS) + 1;
}

export function clampRange(args: {
  from?: string;
  to?: string;
  todayKey: string;
  docFrom: string;
  docTo: string;
  defaultDays: number;
  maxDays: number;
}): { ok: true; from: string; to: string } | { ok: false; error: string } {
  const { todayKey, docFrom, docTo, defaultDays, maxDays } = args;
  for (const value of [args.from, args.to]) {
    if (value !== undefined && !isValidDateKey(value)) {
      return { ok: false, error: `Дата «${value}» не в формате YYYY-MM-DD или не существует.` };
    }
  }

  let to = args.to ?? (args.from ? shiftDateKey(args.from, defaultDays - 1) : todayKey < docTo ? todayKey : docTo);
  if (!args.to && !args.from && to < docFrom) to = docFrom;
  let from = args.from ?? shiftDateKey(to, -(defaultDays - 1));
  if (from > to) return { ok: false, error: `Начало периода ${from} позже конца ${to}.` };
  if (daysBetween(from, to) > maxDays) {
    return { ok: false, error: `Период длиннее ${maxDays} дней — сузьте from/to.` };
  }

  if (from < docFrom) from = docFrom;
  if (to > docTo) to = docTo;
  if (from > to) {
    return { ok: false, error: `Период вне документа: документ ведётся с ${docFrom} по ${docTo}.` };
  }
  return { ok: true, from, to };
}

export function capList<T>(items: T[], max: number): { items: T[]; truncated: boolean } {
  return items.length > max ? { items: items.slice(0, max), truncated: true } : { items, truncated: false };
}
