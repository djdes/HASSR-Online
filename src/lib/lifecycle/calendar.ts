/**
 * Рабочие дни по Москве для сценария «пробный и оплата» (2026-11-09).
 *
 * B2B-клиенту нужно время согласовать оплату с директором и бухгалтерией,
 * поэтому сроки касаний считаются в рабочих днях: выходные и праздники РФ
 * не в счёт. Праздники — фиксированные даты Трудового кодекса (ст. 112);
 * переносы правительства в каждый год вносить не обязательно: ошибка в
 * один день здесь безопасна (письмо уйдёт на день раньше или позже).
 */

const MSK_OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** «MM-DD» нерабочих праздников. */
const HOLIDAYS = new Set([
  "01-01", "01-02", "01-03", "01-04", "01-05", "01-06", "01-07", "01-08",
  "02-23", "03-08", "05-01", "05-09", "06-12", "11-04",
]);

/** Полночь по Москве того дня, в котором лежит момент (как Date в UTC). */
export function mskDayStart(at: Date): Date {
  const shifted = at.getTime() + MSK_OFFSET_MS;
  return new Date(shifted - (shifted % DAY_MS) - MSK_OFFSET_MS);
}

/** «2026-11-09» по Москве. */
export function mskDateKey(at: Date): string {
  return new Date(at.getTime() + MSK_OFFSET_MS).toISOString().slice(0, 10);
}

export function isWorkday(at: Date): boolean {
  const msk = new Date(at.getTime() + MSK_OFFSET_MS);
  const weekday = msk.getUTCDay();
  if (weekday === 0 || weekday === 6) return false;
  return !HOLIDAYS.has(msk.toISOString().slice(5, 10));
}

/**
 * Сколько рабочих дней у клиента до момента `end`, считая сегодняшний
 * (крон идёт утром — сегодня ещё можно оплатить). Конец уже наступил — 0.
 */
export function workdaysLeft(now: Date, end: Date): number {
  if (end.getTime() <= now.getTime()) return 0;
  let count = 0;
  for (let day = mskDayStart(now); day.getTime() < end.getTime(); day = new Date(day.getTime() + DAY_MS)) {
    if (isWorkday(day)) count += 1;
    if (count > 60) break;
  }
  return count;
}

/** Ближайший рабочий день (сегодня, если рабочий), 18:00 по Москве — срок задачи. */
export function dueTodayOrNextWorkday(now: Date, hour = 18): Date {
  let day = mskDayStart(now);
  while (!isWorkday(day)) day = new Date(day.getTime() + DAY_MS);
  return new Date(day.getTime() + hour * 60 * 60 * 1000);
}
