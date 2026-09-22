/**
 * Чистая арифметика колеса дат (`WheelColumn` / `WheelDatePicker`).
 *
 * Здесь нет React и нет `new Date()` без аргумента: всё, что зависит от
 * «сегодня», приходит параметром, поэтому модуль покрыт юнит-тестами.
 * Даты — строки `YYYY-MM-DD`, месяцы — индексы 0..11 (как у `Date`).
 */

export const MONTH_NAMES_RU = [
  "Январь",
  "Февраль",
  "Март",
  "Апрель",
  "Май",
  "Июнь",
  "Июль",
  "Август",
  "Сентябрь",
  "Октябрь",
  "Ноябрь",
  "Декабрь",
] as const;

/** Родительный падеж — «25 сентября». */
export const MONTH_NAMES_RU_GENITIVE = [
  "января",
  "февраля",
  "марта",
  "апреля",
  "мая",
  "июня",
  "июля",
  "августа",
  "сентября",
  "октября",
  "ноября",
  "декабря",
] as const;

/** Короткие дни недели в порядке JS (0 — воскресенье). */
export const WEEKDAY_SHORT_RU = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"] as const;

/** Полные дни недели в порядке JS — для экранных дикторов. */
export const WEEKDAY_FULL_RU = [
  "воскресенье",
  "понедельник",
  "вторник",
  "среда",
  "четверг",
  "пятница",
  "суббота",
] as const;

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

export function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

/** День, подрезанный под длину месяца (31 февраля → 28/29). */
export function clampDay(year: number, monthIndex: number, day: number): number {
  return Math.min(Math.max(1, Math.trunc(day) || 1), daysInMonth(year, monthIndex));
}

export function isoDate(year: number, monthIndex: number, day: number): string {
  return `${year}-${pad2(monthIndex + 1)}-${pad2(day)}`;
}

/** `YYYY-MM-DD` → части; несуществующая дата (30 февраля) — null. */
export function parseIsoDate(
  value: string | null | undefined,
): { year: number; monthIndex: number; day: number } | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  if (monthIndex < 0 || monthIndex > 11) return null;
  if (day < 1 || day > daysInMonth(year, monthIndex)) return null;
  return { year, monthIndex, day };
}

/** День недели в порядке JS (0 — воскресенье). */
export function weekdayIndex(iso: string): number {
  return new Date(`${iso}T00:00:00Z`).getUTCDay();
}

/** «25.09» */
export function formatDayMonth(iso: string): string {
  const parts = parseIsoDate(iso);
  if (!parts) return iso;
  return `${pad2(parts.day)}.${pad2(parts.monthIndex + 1)}`;
}

/** «25.09 (пт)» */
export function formatDayMonthWeekday(iso: string): string {
  const parts = parseIsoDate(iso);
  if (!parts) return iso;
  return `${formatDayMonth(iso)} (${WEEKDAY_SHORT_RU[weekdayIndex(iso)]})`;
}

export type WheelDayOption = {
  value: number;
  label: string;
  /** День недели — серым справа от числа. */
  hint: string;
  tone: "weekend" | undefined;
  disabled: boolean;
  /** Точка под числом: день уже что-то значит (например, в плане). */
  marked: boolean;
  /** Пояснение вместо дня недели, почему день закрыт («в плане»). */
  note: string | undefined;
};

/**
 * Строки колеса дней одного месяца.
 *
 * `maxDate` / `minDate` — границы ВКЛЮЧИТЕЛЬНО; `disabledDays` — дни,
 * которые выбрать нельзя по смыслу (уже в плане), с подписью
 * `disabledNote`.
 */
export function buildDayOptions(
  year: number,
  monthIndex: number,
  options: {
    markedDays?: Iterable<number>;
    disabledDays?: Iterable<number>;
    disabledNote?: string;
    maxDate?: string | null;
    minDate?: string | null;
  } = {},
): WheelDayOption[] {
  const marked = new Set(options.markedDays ?? []);
  const closed = new Set(options.disabledDays ?? []);
  const count = daysInMonth(year, monthIndex);
  const out: WheelDayOption[] = [];
  for (let day = 1; day <= count; day += 1) {
    const iso = isoDate(year, monthIndex, day);
    const weekday = weekdayIndex(iso);
    const outOfRange =
      (options.maxDate ? iso > options.maxDate : false) ||
      (options.minDate ? iso < options.minDate : false);
    const closedByMeaning = closed.has(day);
    out.push({
      value: day,
      label: String(day),
      hint: WEEKDAY_SHORT_RU[weekday],
      tone: weekday === 0 || weekday === 6 ? "weekend" : undefined,
      disabled: outOfRange || closedByMeaning,
      marked: marked.has(day),
      note: closedByMeaning ? options.disabledNote : undefined,
    });
  }
  return out;
}

/**
 * Сколько строк провернуть по событию `wheel`.
 *
 * Щелчок колеса мыши (строки или крупный пиксельный шаг) — ровно одна
 * строка, как у нативного барабана. Тачпад присылает мелкие сдвиги —
 * копим их до высоты строки. Смена направления сбрасывает копилку.
 */
export function wheelSteps(
  acc: number,
  deltaY: number,
  deltaMode: number,
  itemHeight: number,
): { steps: number; acc: number } {
  if (!deltaY) return { steps: 0, acc };
  if (deltaMode !== 0 || Math.abs(deltaY) >= 50) {
    return { steps: Math.sign(deltaY), acc: 0 };
  }
  const base = acc !== 0 && Math.sign(acc) !== Math.sign(deltaY) ? 0 : acc;
  const total = base + deltaY;
  const height = itemHeight > 0 ? itemHeight : 40;
  // `|| 0` — без «минус нуля» от Math.trunc(-0.25).
  const steps = Math.trunc(total / height) || 0;
  return { steps, acc: total - steps * height };
}

/** Строка по прокрутке: верхний отступ колеса равен двум строкам. */
export function indexFromScrollTop(scrollTop: number, itemHeight: number, count: number): number {
  if (count <= 0 || itemHeight <= 0) return 0;
  const index = Math.round(scrollTop / itemHeight);
  return Math.min(Math.max(index, 0), count - 1);
}

/**
 * Ближайшая доступная строка. `direction` > 0 — сначала ищем ниже
 * (движение вниз по списку), < 0 — выше, 0 — ближайшую в обе стороны
 * (при равенстве — меньший индекс). Нет доступных — -1.
 */
export function nearestEnabledIndex(
  options: ReadonlyArray<{ disabled?: boolean }>,
  index: number,
  direction = 0,
): number {
  const count = options.length;
  if (count === 0) return -1;
  const start = Math.min(Math.max(index, 0), count - 1);
  if (!options[start]?.disabled) return start;
  const scan = (step: number): number => {
    for (let i = start + step; i >= 0 && i < count; i += step) {
      if (!options[i]?.disabled) return i;
    }
    return -1;
  };
  if (direction > 0) {
    const down = scan(1);
    return down >= 0 ? down : scan(-1);
  }
  if (direction < 0) {
    const up = scan(-1);
    return up >= 0 ? up : scan(1);
  }
  const up = scan(-1);
  const down = scan(1);
  if (up < 0) return down;
  if (down < 0) return up;
  return start - up <= down - start ? up : down;
}
