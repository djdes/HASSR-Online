/**
 * Живой таймер обратного отсчёта для писем-акций: анимированный GIF,
 * который сервер рисует в момент открытия письма
 * (`src/app/api/mailing/countdown.gif/route.ts`). Чистый модуль: адрес
 * строит шаблон письма, разбор параметров — маршрут.
 */

export type CountdownTheme = "dark" | "light";

export const COUNTDOWN_THEMES: readonly CountdownTheme[] = ["dark", "light"];

/** Дальше этого срока таймер не рисуем — защита от мусорных адресов. */
export const COUNTDOWN_MAX_DAYS = 400;

export function isCountdownTheme(value: unknown): value is CountdownTheme {
  return typeof value === "string" && (COUNTDOWN_THEMES as readonly string[]).includes(value);
}

/** Абсолютный адрес картинки-таймера до `until` (момент окончания акции). */
export function countdownGifUrl(origin: string, until: Date, theme: CountdownTheme): string {
  const base = origin.replace(/\/+$/, "");
  const params = new URLSearchParams({ until: until.toISOString(), theme });
  return `${base}/api/mailing/countdown.gif?${params.toString()}`;
}

/** Параметры адреса → момент окончания и тема; ошибка — текст для ответа 400. */
export function parseCountdownParams(
  search: URLSearchParams,
  now: Date,
): { ok: true; until: Date; theme: CountdownTheme } | { ok: false; error: string } {
  const rawUntil = search.get("until");
  if (!rawUntil) return { ok: false, error: "until is required" };
  const until = new Date(rawUntil);
  if (Number.isNaN(until.getTime())) return { ok: false, error: "until is not a date" };
  if (until.getTime() - now.getTime() > COUNTDOWN_MAX_DAYS * 86_400_000) {
    return { ok: false, error: `until is more than ${COUNTDOWN_MAX_DAYS} days ahead` };
  }
  const rawTheme = search.get("theme") ?? "dark";
  if (!isCountdownTheme(rawTheme)) return { ok: false, error: "theme must be dark or light" };
  return { ok: true, until, theme: rawTheme };
}

/** Остаток времени по частям; после окончания — нули и `ended`. */
export function countdownParts(until: Date, at: Date): {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  ended: boolean;
} {
  const total = Math.floor((until.getTime() - at.getTime()) / 1000);
  if (total <= 0) return { days: 0, hours: 0, minutes: 0, seconds: 0, ended: true };
  return {
    days: Math.floor(total / 86_400),
    hours: Math.floor((total % 86_400) / 3_600),
    minutes: Math.floor((total % 3_600) / 60),
    seconds: total % 60,
    ended: false,
  };
}
