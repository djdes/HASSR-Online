/**
 * Календарный месяц для графика выходных на `/settings/users`.
 *
 * Раньше сетка показывала 20 дней от сегодня. Для экрана это удобно, но
 * такой график нельзя ни распечатать, ни повесить на кухне: период
 * «плавающий» — начинается сегодняшним числом и обрывается посреди
 * следующего месяца. График смены — понятие календарное, поэтому и
 * сетка, и лист работают месяцами.
 *
 * Все вычисления в UTC — так же, как `generateWorkOffDays` и
 * `staff-days-off.ts`. Смешивать UTC и местное время в одном экране
 * значило бы ловить сдвиг на сутки у пользователей восточнее Москвы.
 */

const MONTH_NAMES = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
] as const;

const MONTH_NAMES_GENITIVE = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
] as const;

export type ScheduleMonth = { year: number; month: number };

/** Месяц, в котором лежит дата. `month` — 0-11, как в Date. */
export function monthOf(date: Date): ScheduleMonth {
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() };
}

/** Сдвиг на N месяцев — с переходом через год в обе стороны. */
export function shiftMonth(base: ScheduleMonth, delta: number): ScheduleMonth {
  const d = new Date(Date.UTC(base.year, base.month + delta, 1));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() };
}

/** Все дни месяца как `YYYY-MM-DD`. 28, 29, 30 или 31 штука. */
export function monthDates(m: ScheduleMonth): string[] {
  const out: string[] = [];
  const d = new Date(Date.UTC(m.year, m.month, 1));
  while (d.getUTCMonth() === m.month) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

/** «Октябрь 2026» — для переключателя и заголовка листа. */
export function monthLabel(m: ScheduleMonth): string {
  return `${MONTH_NAMES[m.month]} ${m.year}`;
}

/** «1 октября 2026» — для подписи периода на печатном листе. */
export function formatDayLong(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${d.getUTCDate()} ${MONTH_NAMES_GENITIVE[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/**
 * Насколько далеко разрешено листать. Назад — чтобы поднять прошлый
 * график, вперёд — чтобы составить будущий; дальше и то и другое
 * бессмысленно, а безграничная перемотка прячет опечатки в датах.
 */
export const MONTH_OFFSET_MIN = -12;
export const MONTH_OFFSET_MAX = 12;

export function clampOffset(offset: number): number {
  if (!Number.isFinite(offset)) return 0;
  return Math.min(Math.max(Math.trunc(offset), MONTH_OFFSET_MIN), MONTH_OFFSET_MAX);
}

/**
 * Даты, которые сетка вообще может показать (`clampOffset`), — с запасом в
 * месяц с каждой стороны на случай, если часы сервера и браузера разошлись
 * через границу месяца. `from` включительно, `to` — нет; дни графика
 * хранятся как «00:00 UTC».
 *
 * Зачем: страница грузила исключения графика (`StaffWorkOffDay`) за всю
 * историю организации, хотя дальше ±12 месяцев их не видно, — и с каждым
 * годом страница становилась тяжелее.
 */
export function scheduleDateWindow(now: Date): { from: Date; to: Date } {
  const base = monthOf(now);
  const first = shiftMonth(base, MONTH_OFFSET_MIN - 1);
  const afterLast = shiftMonth(base, MONTH_OFFSET_MAX + 2);
  return {
    from: new Date(Date.UTC(first.year, first.month, 1)),
    to: new Date(Date.UTC(afterLast.year, afterLast.month, 1)),
  };
}
