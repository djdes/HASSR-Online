/**
 * Когда очередь закончится: проход по часам через окно отправки и лимиты
 * писем в час и в сутки (порт `MailingForecast::plan` из рассылок YesBeat).
 * Это оценка — перерыв между рассылками одному адресу, лимит на домен,
 * отписки заранее неизвестны, — поэтому экраны пишут «примерно».
 *
 * Чистый модуль: читают сервер, экраны ROOT и тесты.
 */

import type { MailingSettings } from "./rate-limit";

const HOUR_MS = 60 * 60 * 1000;
const MSK_OFFSET_MS = 3 * HOUR_MS;

export type ForecastLimits = {
  /** Писем в час (> 0). */
  perHour: number;
  /** Писем в сутки (> 0). */
  perDay: number;
  /** Уже отправлено сегодня (с 00:00 МСК). */
  usedToday: number;
  /** Окно отправки по Москве, часы [start, end). */
  windowStart: number;
  windowEnd: number;
};

export type Forecast = {
  /** Примерный конец; null — ничего не ждёт или не уложились в год. */
  finishAt: Date | null;
  /** Сколько писем уйдёт по дням («ГГГГ-ММ-ДД» по Москве). */
  days: Array<{ date: string; count: number }>;
  perHour: number;
  /** Реальная пропускная способность в сутки — с учётом окна. */
  perDay: number;
  remaining: number;
  /** Не уложились в 400 суток — очередь фактически стоит. */
  capped: boolean;
};

function mskParts(at: Date): { date: string; hour: number; minute: number } {
  const msk = new Date(at.getTime() + MSK_OFFSET_MS);
  return { date: msk.toISOString().slice(0, 10), hour: msk.getUTCHours(), minute: msk.getUTCMinutes() };
}

/** Почта: лимит в час не больше того, что даёт лимит в минуту. */
export function emailForecastLimits(
  settings: Pick<MailingSettings, "perMinute" | "perHour" | "perDay">,
  usedToday: number,
  window: { windowStart: number; windowEnd: number }
): ForecastLimits {
  return {
    perHour: Math.max(1, Math.min(settings.perHour, settings.perMinute * 60)),
    perDay: Math.max(1, settings.perDay),
    usedToday: Math.max(0, usedToday),
    windowStart: window.windowStart,
    windowEnd: window.windowEnd,
  };
}

export function planQueue(remainingRaw: number, from: Date, limits: ForecastLimits): Forecast {
  let remaining = Math.max(0, Math.floor(remainingRaw));
  const perHour = Math.max(1, Math.floor(limits.perHour));
  const perDay = Math.max(1, Math.floor(limits.perDay));
  const start = Math.max(0, Math.min(23, Math.floor(limits.windowStart)));
  const end = Math.max(start + 1, Math.min(24, Math.floor(limits.windowEnd)));
  const result: Forecast = {
    finishAt: null,
    days: [],
    perHour,
    perDay: Math.min(perDay, perHour * (end - start)),
    remaining,
    capped: false,
  };
  if (remaining === 0) return result;

  const days = new Map<string, number>();
  const first = mskParts(from);
  let day = first.date;
  let dayLeft = Math.max(0, perDay - Math.max(0, Math.floor(limits.usedToday)));
  // Первый час неполный: в счёт только оставшиеся минуты.
  const firstHourLeft = Math.floor((perHour * (60 - first.minute)) / 60);
  // Начало часа `from` по UTC совпадает с началом часа по Москве (сдвиг кратен часу).
  let cursor = from.getTime() - (from.getTime() % HOUR_MS);

  for (let step = 0; step < 24 * 400; step += 1) {
    const parts = mskParts(new Date(cursor));
    if (parts.date !== day) {
      day = parts.date;
      dayLeft = perDay;
    }
    if (parts.hour >= start && parts.hour < end && dayLeft > 0) {
      const capacity = step === 0 ? firstHourLeft : perHour;
      const send = Math.min(capacity, dayLeft, remaining);
      if (send > 0) {
        days.set(parts.date, (days.get(parts.date) ?? 0) + send);
        remaining -= send;
        dayLeft -= send;
        if (remaining === 0) {
          const base = step === 0 ? from.getTime() : cursor;
          const minutes = Math.max(1, Math.ceil((send / perHour) * 60));
          result.finishAt = new Date(base + minutes * 60_000);
          result.days = [...days].map(([date, count]) => ({ date, count }));
          return result;
        }
      }
    }
    cursor += HOUR_MS;
  }
  result.capped = true;
  result.days = [...days].map(([date, count]) => ({ date, count }));
  return result;
}

const MONTHS = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

/** «12 ноя, 18:40» по Москве — для экранов. */
export function humanMsk(at: Date | string | null): string {
  if (!at) return "";
  const d = typeof at === "string" ? new Date(at) : at;
  const msk = new Date(d.getTime() + MSK_OFFSET_MS);
  const hh = String(msk.getUTCHours()).padStart(2, "0");
  const mm = String(msk.getUTCMinutes()).padStart(2, "0");
  return `${msk.getUTCDate()} ${MONTHS[msk.getUTCMonth()]}, ${hh}:${mm}`;
}
