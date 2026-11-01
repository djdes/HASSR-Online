/**
 * Запись на показ за 15 минут (2026-11-01): клиент выбирает день и время,
 * а не ждёт звонка «когда-нибудь сегодня». Слоты — будни 10:00–18:00 по
 * Москве с шагом 30 минут (показ 15 минут и запас), не раньше чем через
 * 2 часа и на 5 рабочих дней вперёд; занятое скрыто. Часы — константы:
 * поменять их — правка здесь и выкладка. Праздники не учитываются.
 *
 * Чистый модуль: его читают окно заявки (браузер), маршрут слотов и
 * сервер заявки. Москва — UTC+3 без перехода на летнее время.
 */

export const DEMO_SLOTS = {
  firstHour: 10,
  /** Последний слот начинается до этого часа (17:30). */
  endHour: 18,
  stepMinutes: 30,
  workingDays: 5,
  leadMinutes: 120,
  durationMinutes: 30,
} as const;

const MSK_OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

export type DemoSlotDay = {
  /** День по Москве, `YYYY-MM-DD`. */
  key: string;
  /** Начала слотов, ISO в UTC. */
  slots: string[];
};

/** Полночь дня по Москве (UTC-момент) для момента `date`. */
function mskMidnight(date: Date): number {
  const msk = new Date(date.getTime() + MSK_OFFSET_MS);
  return Date.UTC(msk.getUTCFullYear(), msk.getUTCMonth(), msk.getUTCDate()) - MSK_OFFSET_MS;
}

function isWorkingDay(mskMidnightMs: number): boolean {
  const weekday = new Date(mskMidnightMs + MSK_OFFSET_MS).getUTCDay();
  return weekday >= 1 && weekday <= 5;
}

/** Ключ слота в базе и в браузере — ISO без миллисекунд расхождений. */
export function slotKey(date: Date): string {
  return new Date(Math.floor(date.getTime() / MINUTE_MS) * MINUTE_MS).toISOString();
}

/** Ближайшие рабочие дни со свободными слотами. */
export function demoSlotDays(now: Date, taken: ReadonlySet<string> = new Set()): DemoSlotDay[] {
  const earliest = now.getTime() + DEMO_SLOTS.leadMinutes * MINUTE_MS;
  const days: DemoSlotDay[] = [];
  let midnight = mskMidnight(now);
  for (let guard = 0; days.length < DEMO_SLOTS.workingDays && guard < 14; guard += 1, midnight += DAY_MS) {
    if (!isWorkingDay(midnight)) continue;
    const slots: string[] = [];
    for (let minutes = DEMO_SLOTS.firstHour * 60; minutes < DEMO_SLOTS.endHour * 60; minutes += DEMO_SLOTS.stepMinutes) {
      const start = midnight + minutes * MINUTE_MS;
      if (start < earliest) continue;
      const key = new Date(start).toISOString();
      if (!taken.has(key)) slots.push(key);
    }
    // Сегодня может уже не остаться слотов — такой день не показываем и не считаем.
    if (slots.length === 0 && midnight === mskMidnight(now)) continue;
    days.push({ key: new Date(midnight + MSK_OFFSET_MS).toISOString().slice(0, 10), slots });
  }
  return days;
}

/** Можно ли записаться на это время сейчас (сервер перепроверяет перед записью). */
export function isBookableSlot(iso: string, now: Date, taken: ReadonlySet<string> = new Set()): boolean {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return false;
  const key = date.toISOString();
  return demoSlotDays(now, taken).some((day) => day.slots.includes(key));
}

/** «пн, 3 ноября» и «11:30» по Москве на языке страницы. */
export function formatSlotDay(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(intlLocale(locale), { weekday: "short", day: "numeric", month: "long", timeZone: "Europe/Moscow" }).format(new Date(iso));
}

/** Подпись дня по ключу `YYYY-MM-DD` (в том числе дня, где всё занято). */
export function formatDayKey(key: string, locale: string): string {
  return formatSlotDay(`${key}T09:00:00.000Z`, locale);
}

export function formatSlotTime(iso: string): string {
  return new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow" }).format(new Date(iso));
}

function intlLocale(locale: string): string {
  return locale === "en" ? "en-GB" : locale === "uz" ? "uz-Latn-UZ" : "ru-RU";
}

function icsDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function icsText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Приглашение в календарь (RFC 5545) на время показа. */
export function demoIcs(args: { slot: string; uid: string; summary: string; description: string; now?: Date }): string {
  const start = new Date(args.slot);
  const end = new Date(start.getTime() + DEMO_SLOTS.durationMinutes * MINUTE_MS);
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//WeSetup//Demo//RU",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${args.uid}@wesetup.ru`,
    `DTSTAMP:${icsDate(args.now ?? new Date())}`,
    `DTSTART:${icsDate(start)}`,
    `DTEND:${icsDate(end)}`,
    `SUMMARY:${icsText(args.summary)}`,
    `DESCRIPTION:${icsText(args.description)}`,
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}
