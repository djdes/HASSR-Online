import { addDays, moscowDateKey, publishAtFor } from "@/lib/channel-autopost/topics";

/**
 * Еженедельный выпуск — расписание, без БД и сети.
 *
 * Выпуск выходит по средам в 09:00 МСК (каналы Telegram и MAX + письмо).
 * Собирается заранее: крон в понедельник с 08:00 МСК заводит выпуск на
 * ближайшую среду (один на неделю — ключ недели = дата среды), а кнопка
 * «Собрать выпуск на среду» собирает или пересобирает его в любой день.
 * Москва — UTC+3 без перехода на летнее время.
 */

export const WEEKLY_PUBLISH_TIME = "09:00";
/** С какого момента недели крон собирает выпуск сам: понедельник, 08:00 МСК. */
export const WEEKLY_AUTO_BUILD_FROM = { weekday: 1, minutes: 8 * 60 } as const;
/** Позже этого (часов до выхода) выпуск уже не собираем — не успеет картинка. */
export const WEEKLY_MIN_LEAD_HOURS = 2;

const WEDNESDAY = 3;
const MSK_OFFSET_MS = 3 * 3600_000;

/** День недели (0 — вс) и минуты от полуночи по Москве. */
export function moscowWeekdayMinutes(now: Date): { weekday: number; minutes: number; dateKey: string } {
  const shifted = new Date(now.getTime() + MSK_OFFSET_MS);
  return {
    weekday: shifted.getUTCDay(),
    minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
    dateKey: moscowDateKey(now),
  };
}

/** Момент выхода выпуска недели `weekKey` (дата среды). */
export function weeklyPublishAt(weekKey: string): Date {
  return publishAtFor(weekKey, WEEKLY_PUBLISH_TIME);
}

/**
 * Ближайшая среда, на которую ещё можно собрать выпуск: сегодняшняя, если
 * до 09:00 осталось не меньше двух часов, иначе следующая.
 */
export function upcomingWednesday(now: Date): string {
  const { weekday, dateKey } = moscowWeekdayMinutes(now);
  const ahead = (WEDNESDAY - weekday + 7) % 7;
  const candidate = addDays(dateKey, ahead);
  if (weeklyPublishAt(candidate).getTime() - now.getTime() >= WEEKLY_MIN_LEAD_HOURS * 3600_000) return candidate;
  return addDays(candidate, 7);
}

/**
 * Неделя, которую крон должен собрать сам, или null: с понедельника 08:00
 * до среды (за два часа до выхода) — среда этой недели. Повторный вызов в
 * том же окне вернёт ту же неделю — сервис заведёт выпуск один раз.
 */
export function autoBuildWeekKey(now: Date): string | null {
  const { weekday, minutes } = moscowWeekdayMinutes(now);
  if (weekday < WEEKLY_AUTO_BUILD_FROM.weekday || weekday > WEDNESDAY) return null;
  if (weekday === WEEKLY_AUTO_BUILD_FROM.weekday && minutes < WEEKLY_AUTO_BUILD_FROM.minutes) return null;
  const weekKey = addDays(moscowDateKey(now), WEDNESDAY - weekday);
  if (weeklyPublishAt(weekKey).getTime() - now.getTime() < WEEKLY_MIN_LEAD_HOURS * 3600_000) return null;
  return weekKey;
}

/** Окно фактов «за неделю»: семь дней до момента сборки. */
export function factsPeriod(now: Date): { from: Date; to: Date } {
  return { from: new Date(now.getTime() - 7 * 86_400_000), to: now };
}

/** «среда, 2 декабря» — для подписи выпуска. */
export function weekTitle(weekKey: string): string {
  return new Intl.DateTimeFormat("ru-RU", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(
    new Date(`${weekKey}T12:00:00Z`),
  );
}

/**
 * Выпуск уже вышел (хоть в один канал или письмом) — пересобирать и
 * отменять нельзя: второй выпуск на той же неделе был бы дублем.
 */
export function issueIsOut(issue: { status: string; emailStatus: string }, postStatuses: readonly string[]): boolean {
  return issue.status === "published" || issue.emailStatus === "sent" || postStatuses.some((s) => s === "sent" || s === "sending");
}
