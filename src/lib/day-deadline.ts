import { orgDayStartInstant } from "@/lib/timezone";

/**
 * «До конца дня» на «Сегодня» (08.11.2026): сколько осталось до момента,
 * после которого день считается прошлым при проверке незаполненных журналов.
 *
 * Граница — час `Organization.shiftEndHour` в часовом поясе организации
 * («Моя компания → Смены и правила журналов»): 0 — полночь (по умолчанию),
 * 23 — 23:00 того же дня. После неё до полуночи день «закрыт».
 *
 * Чистые функции: сервер считает границу, клиент раз в минуту — остаток.
 */

const HOUR_MS = 60 * 60 * 1000;

export type DayDeadline = {
  /** Момент конца дня (UTC). */
  deadline: Date;
  /** «23:00» / «00:00» — для строки «День закрыт в …». */
  label: string;
};

export function dayDeadline({
  timezone,
  shiftEndHour,
  now = new Date(),
}: {
  timezone: string | null | undefined;
  shiftEndHour: number | null | undefined;
  now?: Date;
}): DayDeadline {
  const hour = Number.isInteger(shiftEndHour) && (shiftEndHour as number) > 0 && (shiftEndHour as number) < 24 ? (shiftEndHour as number) : 0;
  const dayStart = orgDayStartInstant(timezone || "Europe/Moscow", now);
  const deadline = new Date(dayStart.getTime() + (hour === 0 ? 24 : hour) * HOUR_MS);
  return { deadline, label: `${String(hour).padStart(2, "0")}:00` };
}

export type DayLeft =
  | { kind: "open"; hours: number; minutes: number; urgent: boolean }
  | { kind: "closed" };

/** Сколько осталось до `deadline`: часы и минуты (минуты — вверх), меньше часа — срочно. */
export function dayLeft(deadline: Date, now: Date = new Date()): DayLeft {
  const ms = deadline.getTime() - now.getTime();
  if (ms <= 0) return { kind: "closed" };
  const totalMinutes = Math.ceil(ms / 60000);
  return {
    kind: "open",
    hours: Math.floor(totalMinutes / 60),
    minutes: totalMinutes % 60,
    urgent: totalMinutes <= 60,
  };
}
