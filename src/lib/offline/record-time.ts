/**
 * When was an offline record really made, and which journal day does it
 * belong to. Pure: used by the server at sync time and by tests.
 *
 * The device clock is the only witness of an offline record, so it is
 * accepted within bounds: not from the future (a wrong clock) and not
 * older than the window the owner agreed to (31 days).
 */

export const OFFLINE_MAX_FUTURE_MS = 10 * 60 * 1000;
export const OFFLINE_MAX_AGE_DAYS = 31;
const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

export type OfflineTimeError = "bad-time" | "future" | "too-old" | "bad-day";

export type OfflineTimeDecision =
  | { ok: true; recordedAt: Date; /** Journal day (YYYY-MM-DD) in the organization time zone. */ dateKey: string }
  | { ok: false; code: OfflineTimeError };

/** `YYYY-MM-DD` of an instant in a time zone (falls back to Moscow on a bad zone). */
export function dateKeyInZone(instant: Date, timeZone: string | null | undefined): string {
  const format = (zone: string) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(instant);
  try {
    return format(timeZone || "Europe/Moscow");
  } catch {
    return format("Europe/Moscow");
  }
}

function isRealDateKey(value: string): boolean {
  if (!DATE_KEY_RE.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/**
 * @param recordedAtRaw ISO time from the device
 * @param targetDay day the person was editing (past-day edit); omitted — the day of `recordedAt`
 */
export function decideOfflineTime(input: {
  recordedAtRaw: string | null | undefined;
  targetDay?: string | null;
  timeZone: string | null | undefined;
  now?: Date;
}): OfflineTimeDecision {
  const now = input.now ?? new Date();
  const recordedAt = new Date(input.recordedAtRaw ?? "");
  if (!input.recordedAtRaw || Number.isNaN(recordedAt.getTime())) return { ok: false, code: "bad-time" };
  if (recordedAt.getTime() - now.getTime() > OFFLINE_MAX_FUTURE_MS) return { ok: false, code: "future" };
  if (now.getTime() - recordedAt.getTime() > OFFLINE_MAX_AGE_DAYS * DAY_MS) return { ok: false, code: "too-old" };

  const recordedDay = dateKeyInZone(recordedAt, input.timeZone);
  const target = input.targetDay?.trim();
  if (!target) return { ok: true, recordedAt, dateKey: recordedDay };

  // A past-day edit: the day must be real, not after the moment of editing
  // and inside the same window counted from today.
  if (!isRealDateKey(target) || target > recordedDay) return { ok: false, code: "bad-day" };
  const today = dateKeyInZone(now, input.timeZone);
  const ageDays = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${target}T00:00:00Z`)) / DAY_MS);
  if (ageDays > OFFLINE_MAX_AGE_DAYS) return { ok: false, code: "too-old" };
  return { ok: true, recordedAt, dateKey: target };
}

/** Text shown next to a record that the server did not accept because of its time. */
export function offlineTimeErrorText(code: OfflineTimeError): string {
  switch (code) {
    case "future":
      return "Время записи в будущем — проверьте дату и время на устройстве";
    case "too-old":
      return `Запись старше ${OFFLINE_MAX_AGE_DAYS} дня — внесите её через руководителя`;
    case "bad-day":
      return "День записи указан неверно";
    default:
      return "У записи нет времени — запишите заново";
  }
}

/** The last `days` journal days ending with `todayKey`, newest first. */
export function recentDateKeys(todayKey: string, days: number = OFFLINE_MAX_AGE_DAYS): string[] {
  const start = Date.parse(`${todayKey}T00:00:00Z`);
  return Array.from({ length: days + 1 }, (_, index) => new Date(start - index * DAY_MS).toISOString().slice(0, 10));
}
