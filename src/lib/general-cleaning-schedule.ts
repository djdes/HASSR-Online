/**
 * График генеральной уборки помещения (карточка помещения, Room) →
 * конкретные даты плана в журнале «График и учет генеральных уборок».
 *
 * Источник — поля Room: `generalScheduleType` (weekly | monthly),
 * `generalDays` (маска дней недели, бит 0 = Пн — см. weekday-mask.ts) и
 * `generalMonthDays` (["1", "15", "last"]). Модуль чистый: журнал
 * вызывает его и на сервере (создание документа, «Заполнить по графику»),
 * и в браузере (живой предпросмотр перед заполнением).
 */
import {
  WEEKDAY_MASK_ALL,
  WEEKDAY_MASK_NONE,
  describeMask,
  isMaskedWeekday,
  jsDayOfWeekToMondayIndex,
  normalizeMask,
} from "@/lib/weekday-mask";
import { daysInMonth, isoDate, parseIsoDate } from "@/lib/wheel-date";

export type RoomGeneralSchedule = {
  scheduleType: "weekly" | "monthly";
  /** Маска дней недели, бит 0 = Пн. Для monthly — 0. */
  weekdayMask: number;
  /** "1".."31" по возрастанию и "last" в конце. Для weekly — []. */
  monthDays: string[];
};

/** Поля помещения, из которых складывается график генуборки. */
export type RoomGeneralScheduleSource = {
  generalScheduleType?: string | null;
  generalDays?: number | null;
  generalMonthDays?: unknown;
};

function normalizeMonthDays(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const numbers = new Set<number>();
  let last = false;
  for (const item of raw) {
    if (item === "last") {
      last = true;
      continue;
    }
    if (typeof item !== "string" || !/^\d{1,2}$/.test(item)) continue;
    const n = Number(item);
    if (n >= 1 && n <= 31) numbers.add(n);
  }
  const out = [...numbers].sort((a, b) => a - b).map(String);
  if (last) out.push("last");
  return out;
}

/** График помещения или null, если он не задан (пустая маска / нет чисел). */
export function roomGeneralSchedule(
  room: RoomGeneralScheduleSource | null | undefined,
): RoomGeneralSchedule | null {
  if (!room) return null;
  if (room.generalScheduleType === "monthly") {
    const monthDays = normalizeMonthDays(room.generalMonthDays);
    return monthDays.length > 0
      ? { scheduleType: "monthly", weekdayMask: WEEKDAY_MASK_NONE, monthDays }
      : null;
  }
  const mask = normalizeMask(room.generalDays, WEEKDAY_MASK_NONE);
  return mask === WEEKDAY_MASK_NONE
    ? null
    : { scheduleType: "weekly", weekdayMask: mask, monthDays: [] };
}

/** Даты графика в одном месяце, по возрастанию, без повторов. */
export function scheduledDatesInMonth(
  schedule: RoomGeneralSchedule,
  year: number,
  monthIndex: number,
): string[] {
  const count = daysInMonth(year, monthIndex);
  const days = new Set<number>();
  if (schedule.scheduleType === "monthly") {
    for (const token of schedule.monthDays) {
      if (token === "last") {
        days.add(count);
        continue;
      }
      const n = Number(token);
      // 31-е в тридцатидневном месяце просто пропускаем: «последний день»
      // для этого есть отдельной галочкой.
      if (Number.isInteger(n) && n >= 1 && n <= count) days.add(n);
    }
  } else {
    for (let day = 1; day <= count; day += 1) {
      const jsDow = new Date(Date.UTC(year, monthIndex, day)).getUTCDay();
      if (isMaskedWeekday(schedule.weekdayMask, jsDayOfWeekToMondayIndex(jsDow))) {
        days.add(day);
      }
    }
  }
  return [...days].sort((a, b) => a - b).map((day) => isoDate(year, monthIndex, day));
}

/** Даты графика в диапазоне `[fromKey, toKey]` включительно. */
export function scheduledDatesInRange(
  schedule: RoomGeneralSchedule,
  fromKey: string,
  toKey: string,
): string[] {
  const from = parseIsoDate(fromKey);
  const to = parseIsoDate(toKey);
  if (!from || !to || fromKey > toKey) return [];
  const out: string[] = [];
  let year = from.year;
  let monthIndex = from.monthIndex;
  while (year < to.year || (year === to.year && monthIndex <= to.monthIndex)) {
    for (const date of scheduledDatesInMonth(schedule, year, monthIndex)) {
      if (date >= fromKey && date <= toKey) out.push(date);
    }
    monthIndex += 1;
    if (monthIndex > 11) {
      monthIndex = 0;
      year += 1;
    }
  }
  return out;
}

const EVERY_WEEKDAY = [
  "каждый понедельник",
  "каждый вторник",
  "каждую среду",
  "каждый четверг",
  "каждую пятницу",
  "каждую субботу",
  "каждое воскресенье",
] as const;

function joinRu(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} и ${items[items.length - 1]}`;
}

/** «каждую пятницу» / «1 и 15 числа, последний день месяца». */
export function describeGeneralSchedule(schedule: RoomGeneralSchedule): string {
  if (schedule.scheduleType === "monthly") {
    const numbers = schedule.monthDays.filter((d) => d !== "last");
    const parts: string[] = [];
    if (numbers.length > 0) parts.push(`${joinRu(numbers)} числа`);
    if (schedule.monthDays.includes("last")) parts.push("последний день месяца");
    return parts.join(", ");
  }
  const mask = schedule.weekdayMask;
  const single = [0, 1, 2, 3, 4, 5, 6].filter((i) => isMaskedWeekday(mask, i));
  if (single.length === 1) return EVERY_WEEKDAY[single[0]];
  const described = describeMask(mask);
  // «ежедневно», «по будням», «по выходным» — уже готовая фраза.
  if (mask === WEEKDAY_MASK_ALL || !described.includes(",")) return described;
  return `каждую неделю: ${described}`;
}
