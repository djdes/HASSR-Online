/**
 * Расписание ИИ-сводки администратору (ROOT → «Рассылка» → «ИИ-сводка»).
 * Время — московское (UTC+3, без перехода на летнее), чистые функции без
 * базы: их проверяет `schedule.test.ts`.
 *
 * Слот — момент отправки по расписанию (например, вс 23:59). Крон раз в
 * минуту смотрит последний наступивший слот: не отправлен и прошло не
 * больше {@link DIGEST_GRACE_MS} — пора. Пропущенный надолго слот (сервер
 * лежал сутки) не досылается: сводка за «позапрошлую» неделю никому не нужна.
 */

const MSK_OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
export const WEEK_MS = 7 * DAY_MS;
/** Сколько после слота ещё можно отправить (крон опоздал, сервер перезапускался). */
export const DIGEST_GRACE_MS = 3 * 60 * 60 * 1000;

/** День недели ISO: 1 — понедельник … 7 — воскресенье. */
export type DigestWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;
export type DigestSchedule = { weekday: DigestWeekday; time: string };

export const WEEKDAY_LABELS: Record<DigestWeekday, string> = {
  1: "понедельник",
  2: "вторник",
  3: "среда",
  4: "четверг",
  5: "пятница",
  6: "суббота",
  7: "воскресенье",
};

export const WEEKDAY_SHORT: Record<DigestWeekday, string> = { 1: "пн", 2: "вт", 3: "ср", 4: "чт", 5: "пт", 6: "сб", 7: "вс" };

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isValidTime(value: string): boolean {
  return TIME_RE.test(value);
}

function parseTime(time: string): { h: number; m: number } {
  const match = TIME_RE.exec(time);
  if (!match) return { h: 23, m: 59 };
  return { h: Number(match[1]), m: Number(match[2]) };
}

/** Понедельник 00:00 МСК той недели, в которой лежит момент (как Date UTC). */
export function mskWeekStart(at: Date): Date {
  const msk = new Date(at.getTime() + MSK_OFFSET_MS);
  const isoDay = ((msk.getUTCDay() + 6) % 7) + 1;
  const midnightMsk = Date.UTC(msk.getUTCFullYear(), msk.getUTCMonth(), msk.getUTCDate());
  return new Date(midnightMsk - (isoDay - 1) * DAY_MS - MSK_OFFSET_MS);
}

/** Последний наступивший слот расписания (≤ now). */
export function latestSlot(now: Date, schedule: DigestSchedule): Date {
  const { h, m } = parseTime(schedule.time);
  const week = mskWeekStart(now).getTime();
  let slot = week + (schedule.weekday - 1) * DAY_MS + (h * 60 + m) * 60_000;
  if (slot > now.getTime()) slot -= WEEK_MS;
  return new Date(slot);
}

/** Следующий слот (> now) — для подписи «Следующая отправка». */
export function nextSlot(now: Date, schedule: DigestSchedule): Date {
  return new Date(latestSlot(now, schedule).getTime() + WEEK_MS);
}

/** Ключ слота для защиты от повторной отправки: «2026-11-29T23:59» по МСК. */
export function slotKey(slot: Date): string {
  return new Date(slot.getTime() + MSK_OFFSET_MS).toISOString().slice(0, 16);
}

export type ReportPeriod = {
  /** Начало недели (пн 00:00 МСК). */
  start: Date;
  /** Конец недели (следующий пн 00:00 МСК), не включительно. */
  end: Date;
  previousStart: Date;
  previousEnd: Date;
  /** «17.11–23.11.2026». */
  label: string;
  previousLabel: string;
};

function mskDateLabel(at: Date, withYear: boolean): string {
  const iso = new Date(at.getTime() + MSK_OFFSET_MS).toISOString();
  const [y, mo, d] = [iso.slice(0, 4), iso.slice(5, 7), iso.slice(8, 10)];
  return withYear ? `${d}.${mo}.${y}` : `${d}.${mo}`;
}

export function periodLabel(start: Date, end: Date): string {
  const last = new Date(end.getTime() - 1);
  return `${mskDateLabel(start, false)}–${mskDateLabel(last, true)}`;
}

/**
 * Какую неделю описывает сводка, отправленная в момент `at`. В
 * воскресенье — текущую неделю (пн–вс, отправка в 23:59 закрывает её);
 * в любой другой день — последнюю целиком прошедшую. Сравнение — с
 * неделей перед ней.
 */
export function reportPeriod(at: Date): ReportPeriod {
  const weekStart = mskWeekStart(at);
  const msk = new Date(at.getTime() + MSK_OFFSET_MS);
  const isSunday = msk.getUTCDay() === 0;
  const start = isSunday ? weekStart : new Date(weekStart.getTime() - WEEK_MS);
  const end = new Date(start.getTime() + WEEK_MS);
  const previousStart = new Date(start.getTime() - WEEK_MS);
  return {
    start,
    end,
    previousStart,
    previousEnd: start,
    label: periodLabel(start, end),
    previousLabel: periodLabel(previousStart, start),
  };
}

/** Пора ли отправлять по расписанию: слот наступил недавно и ещё не отправлен. */
export function dueSlot(now: Date, schedule: DigestSchedule, sentSlotKeys: ReadonlySet<string>): Date | null {
  const slot = latestSlot(now, schedule);
  if (now.getTime() - slot.getTime() > DIGEST_GRACE_MS) return null;
  if (sentSlotKeys.has(slotKey(slot))) return null;
  return slot;
}

/** «вс 30.11 в 23:59» — для подписи в ROOT. */
export function slotLabel(slot: Date): string {
  const msk = new Date(slot.getTime() + MSK_OFFSET_MS);
  const isoDay = (((msk.getUTCDay() + 6) % 7) + 1) as DigestWeekday;
  return `${WEEKDAY_SHORT[isoDay]} ${mskDateLabel(slot, false)} в ${msk.toISOString().slice(11, 16)}`;
}
