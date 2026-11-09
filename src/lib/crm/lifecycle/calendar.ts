/**
 * Рабочий календарь автоворонки по Москве (UTC+3 круглый год): выходные —
 * суббота и воскресенье, праздники РФ — основные даты списком плюс
 * дополнительные из настроек. Сроки ступеней («за 4 дня») сдвигаются на
 * предыдущий рабочий день: в выходные клиенту не звонят, а бухгалтерии и
 * директору клиента нужно время на оплату.
 *
 * Дни — строки «ГГГГ-ММ-ДД» (московские), чтобы не путаться в часовых поясах.
 */

const MSK_OFFSET_MS = 3 * 60 * 60 * 1000;
export const DAY_MS = 24 * 60 * 60 * 1000;

/** Праздники РФ без года: «ММ-ДД». Переносы года не учитываются — добавляются в настройках. */
export const FIXED_HOLIDAYS: readonly string[] = [
  "01-01",
  "01-02",
  "01-03",
  "01-04",
  "01-05",
  "01-06",
  "01-07",
  "01-08",
  "02-23",
  "03-08",
  "05-01",
  "05-09",
  "06-12",
  "11-04",
];

export type DayKey = string;

/** Московский день момента. */
export function mskDay(date: Date): DayKey {
  return new Date(date.getTime() + MSK_OFFSET_MS).toISOString().slice(0, 10);
}

/** Момент «день, час:минута по Москве». */
export function atMsk(day: DayKey, hour: number, minute = 0): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, hour, minute) - MSK_OFFSET_MS);
}

export function addDays(day: DayKey, days: number): DayKey {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Разница в календарных днях: b − a. */
export function diffDays(a: DayKey, b: DayKey): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);
}

/** Час по Москве (0–23). */
export function mskHour(date: Date): number {
  return new Date(date.getTime() + MSK_OFFSET_MS).getUTCHours();
}

export type WorkCalendar = { holidays?: readonly string[]; workdays?: readonly string[] };

export function isWorkingDay(day: DayKey, calendar: WorkCalendar = {}): boolean {
  if (calendar.workdays?.includes(day)) return true;
  if (calendar.holidays?.includes(day)) return false;
  if (FIXED_HOLIDAYS.includes(day.slice(5))) return false;
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
  return weekday !== 0 && weekday !== 6;
}

/** Этот день, если рабочий, иначе ближайший рабочий раньше. */
export function workingDayOnOrBefore(day: DayKey, calendar: WorkCalendar = {}): DayKey {
  let current = day;
  for (let i = 0; i < 31 && !isWorkingDay(current, calendar); i += 1) current = addDays(current, -1);
  return current;
}

/** Этот день, если рабочий, иначе ближайший рабочий позже. */
export function workingDayOnOrAfter(day: DayKey, calendar: WorkCalendar = {}): DayKey {
  let current = day;
  for (let i = 0; i < 31 && !isWorkingDay(current, calendar); i += 1) current = addDays(current, 1);
  return current;
}

/** Через N рабочих дней после `day` (N ≥ 1). */
export function addWorkingDays(day: DayKey, days: number, calendar: WorkCalendar = {}): DayKey {
  let current = day;
  let left = Math.max(0, Math.floor(days));
  while (left > 0) {
    current = addDays(current, 1);
    if (isWorkingDay(current, calendar)) left -= 1;
  }
  return current;
}

/** Рабочих дней между a (не включая) и b (включая); b раньше a — 0. */
export function workingDaysBetween(a: DayKey, b: DayKey, calendar: WorkCalendar = {}): number {
  let count = 0;
  let current = a;
  for (let i = 0; i < 400 && current < b; i += 1) {
    current = addDays(current, 1);
    if (isWorkingDay(current, calendar)) count += 1;
  }
  return count;
}

/** Письма клиентам — с 10 до 19 по Москве в рабочий день. */
export const CLIENT_SEND_HOURS = { start: 10, end: 19 } as const;
/** Срок задачи по умолчанию — 11:00 дня ступени. */
export const TASK_DUE_HOUR = 11;

export function isClientSendTime(now: Date, calendar: WorkCalendar = {}): boolean {
  const hour = mskHour(now);
  return isWorkingDay(mskDay(now), calendar) && hour >= CLIENT_SEND_HOURS.start && hour < CLIENT_SEND_HOURS.end;
}

/** Последний день действия срока (конец не включительно) — московский. */
export function lastDayOf(end: Date): DayKey {
  return mskDay(new Date(end.getTime() - 1));
}

/** «20 ноября» — для писем и задач. */
const MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
const WEEKDAYS = ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"];

export function dayLabel(day: DayKey, withYear = false): string {
  const [y, m, d] = day.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]}${withYear ? ` ${y}` : ""}`;
}

export function weekdayLabel(day: DayKey): string {
  return WEEKDAYS[new Date(`${day}T00:00:00Z`).getUTCDay()];
}
