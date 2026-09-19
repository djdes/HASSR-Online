/**
 * N6 — timezone-aware утилиты. Используются на UI чтобы показывать
 * даты в зоне организации (Europe/Moscow, Asia/Novosibirsk и т.п.).
 *
 * Не трогает БД — там всё в UTC. Конвертация на render time.
 */

/**
 * Форматирует дату в указанной timezone в стиле «27.04 14:30».
 * Если timezone невалидный — fallback на UTC+0.
 */
export function formatLocalDateTime(
  date: Date,
  timezone: string = "Europe/Moscow"
): string {
  try {
    return new Intl.DateTimeFormat("ru-RU", {
      timeZone: timezone,
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 16).replace("T", " ");
  }
}

/**
 * Только дата в формате «27.04.2026».
 */
export function formatLocalDate(
  date: Date,
  timezone: string = "Europe/Moscow"
): string {
  try {
    return new Intl.DateTimeFormat("ru-RU", {
      timeZone: timezone,
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

/**
 * «Сегодня» в зоне организации в формате `YYYY-MM-DD`.
 *
 * ПОЧЕМУ отдельный хелпер: на проде процесс живёт в UTC, и
 * `new Date().toISOString().slice(0, 10)` до 03:00 МСК отдаёт ВЧЕРАШНИЙ
 * день. Такой ключ уезжал в клиент пропом `todayKey` — подсветка
 * «сегодня» и блокировка прошлых дней целились не туда.
 */
export function orgTodayKey(
  timezone: string = "Europe/Moscow",
  now: Date = new Date()
): string {
  try {
    // en-CA даёт ровно ISO-формат YYYY-MM-DD.
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

/**
 * Момент начала СЕГОДНЯШНЕГО дня в зоне организации (UTC-инстант).
 *
 * ПОЧЕМУ: сравнение `completedAt >= UTC-полночь` в Москве с 00:00 до 03:00
 * тянет в выборку вчерашний вечер и теряет свежие отметки — «сегодня» в
 * БД и «сегодня» у пользователя разъезжаются на несколько часов.
 */
export function orgDayStartInstant(
  timezone: string = "Europe/Moscow",
  now: Date = new Date()
): Date {
  const dayKey = orgTodayKey(timezone, now);
  // Смещение зоны берём на сам момент `now` — так переход на летнее время
  // и смена зоны не сдвигают границу дня.
  const offsetMs = getTimezoneOffsetMs(timezone, now);
  const utcMidnight = new Date(`${dayKey}T00:00:00.000Z`).getTime();
  return new Date(utcMidnight - offsetMs);
}

/** Смещение зоны относительно UTC в миллисекундах на указанный момент. */
function getTimezoneOffsetMs(timezone: string, at: Date): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).formatToParts(at);
    const get = (type: string) =>
      Number(parts.find((part) => part.type === type)?.value ?? "0");
    const asUtc = Date.UTC(
      get("year"),
      get("month") - 1,
      get("day"),
      // В en-US полночь приходит как «24» — приводим к 0.
      get("hour") % 24,
      get("minute"),
      get("second")
    );
    return asUtc - Math.floor(at.getTime() / 1000) * 1000;
  } catch {
    return 0;
  }
}

/**
 * Список зон РФ для UI-селектора. Можно расширить.
 */
export const RUSSIAN_TIMEZONES = [
  { tz: "Europe/Kaliningrad", label: "Калининград (UTC+2)" },
  { tz: "Europe/Moscow", label: "Москва (UTC+3)" },
  { tz: "Europe/Samara", label: "Самара (UTC+4)" },
  { tz: "Asia/Yekaterinburg", label: "Екатеринбург (UTC+5)" },
  { tz: "Asia/Omsk", label: "Омск (UTC+6)" },
  { tz: "Asia/Krasnoyarsk", label: "Красноярск (UTC+7)" },
  { tz: "Asia/Irkutsk", label: "Иркутск (UTC+8)" },
  { tz: "Asia/Yakutsk", label: "Якутск (UTC+9)" },
  { tz: "Asia/Vladivostok", label: "Владивосток (UTC+10)" },
  { tz: "Asia/Magadan", label: "Магадан (UTC+11)" },
  { tz: "Asia/Kamchatka", label: "Камчатка (UTC+12)" },
] as const;
