import crypto from "node:crypto";

import { qrHmac } from "@/lib/qr-hmac";

/**
 * «QR для проверяющих» — постоянный QR на тот же `InspectorToken`.
 *
 * Схема Prisma не менялась, поэтому режим узнаётся по данным строки:
 *  - `periodTo` = 2099-12-31 — «открытый период»: проверяющий сам
 *    выбирает даты внутри окна «periodFrom … сегодня»;
 *  - сырой токен не хранится, а выводится из id строки через HMAC —
 *    QR можно распечатать повторно в любой момент, в базе по-прежнему
 *    лежит только sha256 от токена.
 *
 * Секрет — тот же порядок, что у QR-токенов (`EQUIPMENT_QR_TOKEN_SECRET`
 * → `TELEGRAM_LINK_TOKEN_SECRET` → `NEXTAUTH_SECRET`), область подписи
 * своя (`inspector-qr`), чтобы подпись QR-пропуска нельзя было выдать за
 * токен проверяющего и наоборот.
 */
export const INSPECTOR_QR_SCOPE = "inspector-qr";

export const INSPECTOR_QR_OPEN_PERIOD_TO = new Date("2099-12-31T00:00:00.000Z");

/** Окно, внутри которого проверяющий выбирает период: 12 месяцев назад. */
export const INSPECTOR_QR_WINDOW_MONTHS = 12;

export const INSPECTOR_QR_TTL_DAYS = { "1d": 1, "7d": 7, "30d": 30, forever: 365 } as const;
export type InspectorQrTtl = keyof typeof INSPECTOR_QR_TTL_DAYS;

export const INSPECTOR_QR_TTL_LABELS: Record<InspectorQrTtl, string> = {
  "1d": "1 день",
  "7d": "7 дней",
  "30d": "30 дней",
  forever: "До отзыва",
};

export function deriveInspectorQrToken(tokenId: string): string {
  return qrHmac(INSPECTOR_QR_SCOPE, tokenId);
}

export function isInspectorQrRecord(record: { periodTo: Date }): boolean {
  return record.periodTo.getUTCFullYear() >= 2099;
}

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

function isValidDayKey(value: string | null | undefined): value is string {
  if (!value || !DAY_KEY.test(value)) return false;
  const d = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function shiftDayKey(key: string, days: number): string {
  const d = new Date(`${key}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function dayKeyOf(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export type DayWindow = { from: string; to: string };

/**
 * Окно, в котором проверяющему разрешено смотреть документы. У QR —
 * от даты создания минус 12 месяцев до сегодняшнего дня организации;
 * у старой одноразовой ссылки — её фиксированный период.
 */
export function inspectorWindow(
  record: { periodFrom: Date; periodTo: Date },
  today: string
): DayWindow {
  const from = dayKeyOf(record.periodFrom);
  const to = isInspectorQrRecord(record) ? today : dayKeyOf(record.periodTo);
  return { from, to: to < from ? from : to };
}

export const INSPECTOR_PERIOD_PRESETS = ["today", "7d", "month", "quarter", "custom"] as const;
export type InspectorPeriodPreset = (typeof INSPECTOR_PERIOD_PRESETS)[number];

export const INSPECTOR_PERIOD_LABELS: Record<InspectorPeriodPreset, string> = {
  today: "Сегодня",
  "7d": "7 дней",
  month: "Месяц",
  quarter: "Квартал",
  custom: "Свои даты",
};

const PRESET_DAYS: Record<Exclude<InspectorPeriodPreset, "custom">, number> = {
  today: 1,
  "7d": 7,
  month: 30,
  quarter: 90,
};

function clampKey(key: string, window: DayWindow): string {
  if (key < window.from) return window.from;
  if (key > window.to) return window.to;
  return key;
}

export type ResolvedPeriod = { preset: InspectorPeriodPreset; from: string; to: string };

/**
 * Период из адресной строки (`?p=&from=&to=`), зажатый окном токена.
 * Всё, что пришло из URL, — недоверенный ввод: неизвестный пресет или
 * битые даты молча превращаются в «Месяц».
 */
export function resolveInspectorPeriod(input: {
  window: DayWindow;
  today: string;
  preset?: string | null;
  from?: string | null;
  to?: string | null;
}): ResolvedPeriod {
  const { window } = input;
  const end = input.today;
  const preset = (INSPECTOR_PERIOD_PRESETS as readonly string[]).includes(input.preset ?? "")
    ? (input.preset as InspectorPeriodPreset)
    : "month";

  if (preset === "custom" && isValidDayKey(input.from) && isValidDayKey(input.to)) {
    let from = input.from;
    let to = input.to;
    if (from > to) [from, to] = [to, from];
    return { preset, from: clampKey(from, window), to: clampKey(to, window) };
  }
  const fixed = preset === "custom" ? "month" : preset;
  return {
    preset: fixed,
    from: clampKey(shiftDayKey(end, -(PRESET_DAYS[fixed] - 1)), window),
    to: clampKey(end, window),
  };
}

/** Документ пересекается с периодом [from, to] (ключи дней, включительно). */
export function documentOverlaps(
  doc: { dateFrom: Date; dateTo: Date },
  from: string,
  to: string
): boolean {
  return dayKeyOf(doc.dateFrom) <= to && dayKeyOf(doc.dateTo) >= from;
}

/** Границы периода для запросов в БД: [from 00:00, to 23:59:59.999] UTC. */
export function periodBounds(from: string, to: string): { gte: Date; lte: Date } {
  return {
    gte: new Date(`${from}T00:00:00.000Z`),
    lte: new Date(`${to}T23:59:59.999Z`),
  };
}

/**
 * Контрольный код электронной отметки: короткий хэш версии содержимого
 * (документ + его записи с временем правки). Одинаковое содержимое —
 * одинаковый код; любая правка записи меняет код. Не подпись и не
 * печать — способ сверить, что проверяющий видел ту же версию.
 */
export function inspectorControlCode(parts: string[]): string {
  const hex = crypto.createHash("sha256").update(parts.join("\n")).digest("hex").toUpperCase();
  return `${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}`;
}

export function formatDayKeyRu(key: string): string {
  const [y, m, d] = key.split("-");
  return `${d}.${m}.${y}`;
}
