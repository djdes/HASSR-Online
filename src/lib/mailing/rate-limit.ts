/**
 * Ограничение скорости рекламных писем.
 *
 * Настройка — `PlatformSetting` `mailing.settings` (JSON): писем в минуту
 * и в сутки. Сутки — календарные по Москве: «сегодня отправлено» в ROOT
 * считается с 00:00 МСК. Минута — скользящие 60 секунд до «сейчас».
 * Ограничение касается только писем: колокольчик — запись в нашу базу, у
 * push и Telegram свои механизмы.
 *
 * Чистый модуль: читают сервер, форма ROOT и тесты.
 */

export const MAILING_SETTINGS_KEY = "mailing.settings";

export type MailingSettings = {
  /**
   * Общий выключатель обработки очереди (как «Обрабатывать очередь
   * рассылок» в YesBeat): выключен — проход ничего не отправляет, рассылки
   * ждут. Тест себе работает.
   */
  enabled: boolean;
  /** Писем в минуту. */
  perMinute: number;
  /** Писем в час (часы по Москве). */
  perHour: number;
  /** Писем в сутки (по Москве). */
  perDay: number;
  /** Писем в час на один почтовый домен (mail.ru, yandex.ru…). */
  perDomainHour: number;
  /**
   * Перерыв между рассылками одному адресу, часов: письмо другой рассылки
   * ушло недавно — следующее ждёт (причина «frequency_limit»). 0 — без
   * перерыва.
   */
  gapHours: number;
};

export const PER_MINUTE_MAX = 600;
export const PER_HOUR_MAX = PER_MINUTE_MAX * 60;
export const PER_DAY_MAX = 100_000;
export const GAP_HOURS_MAX = 720;

/**
 * По умолчанию — без ограничения скорости: максимум, который выдерживает
 * проход очереди (решение 22.10.2026, команда просила снять лимит 20/300).
 * Перерыв между рассылками выключен. Сбавить — ROOT → Рассылка → «Лимиты».
 */
export const DEFAULT_MAILING_SETTINGS: MailingSettings = {
  enabled: true,
  perMinute: PER_MINUTE_MAX,
  perHour: PER_HOUR_MAX,
  perDay: PER_DAY_MAX,
  perDomainHour: PER_HOUR_MAX,
  gapHours: 0,
};

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (value === null || value === undefined || value === "" || !Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

/** Битое поле — значение по умолчанию, а не остановка очереди. */
export function normalizeMailingSettings(raw: unknown): MailingSettings {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const d = DEFAULT_MAILING_SETTINGS;
  return {
    enabled: r.enabled === false ? false : d.enabled,
    perMinute: clampInt(r.perMinute, 1, PER_MINUTE_MAX, d.perMinute),
    perHour: clampInt(r.perHour, 1, PER_HOUR_MAX, d.perHour),
    perDay: clampInt(r.perDay, 1, PER_DAY_MAX, d.perDay),
    perDomainHour: clampInt(r.perDomainHour, 1, PER_HOUR_MAX, d.perDomainHour),
    gapHours: clampInt(r.gapHours, 0, GAP_HOURS_MAX, d.gapHours),
  };
}

const LIMIT_FIELDS: Array<{ key: Exclude<keyof MailingSettings, "enabled">; label: string; min: number; max: number }> = [
  { key: "perMinute", label: "Писем в минуту", min: 1, max: PER_MINUTE_MAX },
  { key: "perHour", label: "Писем в час", min: 1, max: PER_HOUR_MAX },
  { key: "perDay", label: "Писем в сутки", min: 1, max: PER_DAY_MAX },
  { key: "perDomainHour", label: "В час на один почтовый домен", min: 1, max: PER_HOUR_MAX },
  { key: "gapHours", label: "Перерыв между рассылками одному адресу, часов", min: 0, max: GAP_HOURS_MAX },
];

/**
 * Проверка формы «Лимиты». Поле, которого нет во вводе, остаётся как было
 * (`base`): каждая форма сохраняет только своё.
 */
export function validateMailingSettingsInput(
  input: Record<string, unknown>,
  base: MailingSettings = DEFAULT_MAILING_SETTINGS
): { ok: true; value: MailingSettings } | { ok: false; error: string } {
  const value: MailingSettings = { ...base };
  if (input.enabled !== undefined) {
    if (typeof input.enabled !== "boolean") return { ok: false, error: "Выключатель очереди — да или нет" };
    value.enabled = input.enabled;
  }
  for (const field of LIMIT_FIELDS) {
    if (input[field.key] === undefined) continue;
    const n = Number(input[field.key]);
    if (!Number.isInteger(n) || n < field.min || n > field.max) {
      return { ok: false, error: `${field.label} — целое число от ${field.min} до ${field.max}` };
    }
    value[field.key] = n;
  }
  if (value.perDay < value.perMinute) {
    return { ok: false, error: "В сутки не может уходить меньше писем, чем в минуту" };
  }
  if (value.perHour < value.perMinute) {
    return { ok: false, error: "В час не может уходить меньше писем, чем в минуту" };
  }
  return { ok: true, value };
}

/** Москва без летнего времени с 2014 года — фиксированный сдвиг. */
const MSK_OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** 00:00 по Москве того дня, в котором `now`. */
export function mskDayStart(now: Date): Date {
  const shifted = now.getTime() + MSK_OFFSET_MS;
  return new Date(shifted - (shifted % DAY_MS) - MSK_OFFSET_MS);
}

/** Начало скользящей минуты. */
export function minuteWindowStart(now: Date): Date {
  return new Date(now.getTime() - 60_000);
}

/** Начало текущего часа по Москве (сдвиг кратен часу — это начало часа UTC). */
export function mskHourStart(now: Date): Date {
  return new Date(now.getTime() - (now.getTime() % (60 * 60 * 1000)));
}

export type EmailBudget = {
  /** Сколько писем можно отправить прямо сейчас. */
  budget: number;
  /** Что ограничивает: минута, час, сутки или ничего. */
  limitedBy: "minute" | "hour" | "day" | null;
};

export function emailBudget(
  settings: Pick<MailingSettings, "perMinute" | "perDay"> & { perHour?: number },
  sentLastMinute: number,
  sentToday: number,
  sentThisHour = 0
): EmailBudget {
  const byMinute = Math.max(0, settings.perMinute - Math.max(0, sentLastMinute));
  const byHour = Math.max(0, (settings.perHour ?? Number.POSITIVE_INFINITY) - Math.max(0, sentThisHour));
  const byDay = Math.max(0, settings.perDay - Math.max(0, sentToday));
  const budget = Math.min(byMinute, byHour, byDay);
  if (budget > 0) return { budget, limitedBy: null };
  // Суточный лимит важнее: он не освободится через минуту; часовой — через час.
  return { budget: 0, limitedBy: byDay === 0 ? "day" : byHour === 0 ? "hour" : "minute" };
}

/**
 * Окно отправки [start, end) по Москве: `now` внутри — `now`; иначе ближайшее
 * начало окна (сегодня или завтра). Как `Mailings::window_due` в YesBeat.
 */
export function windowDue(now: Date, start: number, end: number): Date {
  const s = Math.max(0, Math.min(23, Math.floor(start)));
  const e = Math.max(s + 1, Math.min(24, Math.floor(end)));
  if (s === 0 && e === 24) return now;
  const msk = new Date(now.getTime() + MSK_OFFSET_MS);
  const hour = msk.getUTCHours();
  if (hour >= s && hour < e) return now;
  const dayStart = mskDayStart(now).getTime();
  const next = dayStart + s * 60 * 60 * 1000;
  return new Date(hour >= e ? next + DAY_MS : next);
}

/** Окно отправки: целые часы, начало раньше конца. */
export function normalizeWindow(start: unknown, end: unknown): { windowStart: number; windowEnd: number } | null {
  const s = Number(start);
  const e = Number(end);
  if (!Number.isInteger(s) || !Number.isInteger(e) || s < 0 || s > 23 || e < 1 || e > 24 || e <= s) return null;
  return { windowStart: s, windowEnd: e };
}

/** Домен адреса для лимита «в час на домен». */
export function emailDomain(email: string): string {
  const at = email.lastIndexOf("@");
  return at >= 0 ? email.slice(at + 1).toLowerCase() : "";
}
