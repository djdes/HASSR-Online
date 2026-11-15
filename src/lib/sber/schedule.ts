/**
 * Расписание автосверки выписки СберБизнес (ROOT → «СберБизнес»).
 *
 * Крон сервера стучится в /api/cron/sber-payments каждые 5 минут, а
 * сверка идёт, только если она включена и с прошлой прошло не меньше
 * выбранного интервала. Ручная кнопка «Проверить выписку сейчас»
 * работает всегда и тоже сдвигает следующую автосверку.
 */
export const SBER_SCHEDULE_KEY = "sber.invoiceSync.schedule";
/** Шаг крона на сервере — чаще него выбрать нельзя. */
export const SBER_CRON_STEP_MINUTES = 5;
export const SBER_INTERVALS = [5, 10, 15, 30, 60, 120, 240] as const;
export type SberInterval = (typeof SBER_INTERVALS)[number];

export type SberSchedule = { enabled: boolean; intervalMinutes: SberInterval };
export const DEFAULT_SBER_SCHEDULE: SberSchedule = { enabled: true, intervalMinutes: 10 };

export function isSberInterval(value: unknown): value is SberInterval {
  return typeof value === "number" && (SBER_INTERVALS as readonly number[]).includes(value);
}

export function parseSberSchedule(raw: string | null | undefined): SberSchedule {
  if (!raw) return DEFAULT_SBER_SCHEDULE;
  try {
    const value = JSON.parse(raw) as Partial<SberSchedule>;
    return {
      enabled: typeof value.enabled === "boolean" ? value.enabled : DEFAULT_SBER_SCHEDULE.enabled,
      intervalMinutes: isSberInterval(value.intervalMinutes) ? value.intervalMinutes : DEFAULT_SBER_SCHEDULE.intervalMinutes,
    };
  } catch {
    return DEFAULT_SBER_SCHEDULE;
  }
}

/**
 * Пора ли сверять. Минута запаса: крон срабатывает в :03/:08…, а сама
 * сверка длится секунды — без запаса интервал 10 минут превращался бы в 15.
 */
export function sberSyncDue(schedule: SberSchedule, lastAt: string | null | undefined, now: Date): boolean {
  if (!schedule.enabled) return false;
  const last = lastAt ? Date.parse(lastAt) : NaN;
  if (!Number.isFinite(last)) return true;
  return now.getTime() - last >= schedule.intervalMinutes * 60_000 - 60_000;
}

/** Когда примерно будет следующая автосверка (ближайший шаг крона после интервала). */
export function nextSberSync(schedule: SberSchedule, lastAt: string | null | undefined, now: Date): Date | null {
  if (!schedule.enabled) return null;
  const last = lastAt ? Date.parse(lastAt) : NaN;
  const earliest = Number.isFinite(last) ? Math.max(now.getTime(), last + schedule.intervalMinutes * 60_000 - 60_000) : now.getTime();
  // Крон: 3-59/5 — минуты 3, 8, 13, …
  const d = new Date(earliest);
  d.setSeconds(0, 0);
  while ((d.getUTCMinutes() - 3 + 60) % SBER_CRON_STEP_MINUTES !== 0 || d.getTime() < earliest - 59_000) d.setTime(d.getTime() + 60_000);
  return d;
}

export function sberIntervalLabel(minutes: number): string {
  if (minutes < 60) return `каждые ${minutes} мин`;
  const h = minutes / 60;
  return h === 1 ? "каждый час" : `каждые ${h} ч`;
}
