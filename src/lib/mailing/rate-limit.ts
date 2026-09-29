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
  /** Писем в минуту. */
  perMinute: number;
  /** Писем в сутки (по Москве). */
  perDay: number;
};

export const DEFAULT_MAILING_SETTINGS: MailingSettings = { perMinute: 20, perDay: 300 };

export const PER_MINUTE_MAX = 600;
export const PER_DAY_MAX = 100_000;

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

/** Битое поле — значение по умолчанию, а не остановка очереди. */
export function normalizeMailingSettings(raw: unknown): MailingSettings {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    perMinute: clampInt(r.perMinute, 1, PER_MINUTE_MAX, DEFAULT_MAILING_SETTINGS.perMinute),
    perDay: clampInt(r.perDay, 1, PER_DAY_MAX, DEFAULT_MAILING_SETTINGS.perDay),
  };
}

export function validateMailingSettingsInput(
  input: { perMinute: unknown; perDay: unknown }
): { ok: true; value: MailingSettings } | { ok: false; error: string } {
  const perMinute = Number(input.perMinute);
  const perDay = Number(input.perDay);
  if (!Number.isInteger(perMinute) || perMinute < 1 || perMinute > PER_MINUTE_MAX) {
    return { ok: false, error: `Писем в минуту — целое число от 1 до ${PER_MINUTE_MAX}` };
  }
  if (!Number.isInteger(perDay) || perDay < 1 || perDay > PER_DAY_MAX) {
    return { ok: false, error: `Писем в сутки — целое число от 1 до ${PER_DAY_MAX}` };
  }
  if (perDay < perMinute) {
    return { ok: false, error: "В сутки не может уходить меньше писем, чем в минуту" };
  }
  return { ok: true, value: { perMinute, perDay } };
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

export type EmailBudget = {
  /** Сколько писем можно отправить прямо сейчас. */
  budget: number;
  /** Что ограничивает: минута, сутки или ничего. */
  limitedBy: "minute" | "day" | null;
};

export function emailBudget(
  settings: MailingSettings,
  sentLastMinute: number,
  sentToday: number
): EmailBudget {
  const byMinute = Math.max(0, settings.perMinute - Math.max(0, sentLastMinute));
  const byDay = Math.max(0, settings.perDay - Math.max(0, sentToday));
  const budget = Math.min(byMinute, byDay);
  if (budget > 0) return { budget, limitedBy: null };
  // Суточный лимит важнее: он не освободится через минуту.
  return { budget: 0, limitedBy: byDay === 0 ? "day" : "minute" };
}
