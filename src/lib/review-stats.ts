/**
 * Цифры рядом с отзывом на сайте (2026-11-07): сколько журналов и записей
 * заведение ведёт в WeSetup. Показываются только по согласию автора
 * (`CustomerReview.showStats`). Чистая часть — округление и подпись;
 * подсчёт по базе — `review-stats.server.ts`.
 */

export type ReviewStats = {
  /** Журналов с записями за последние 30 дней. */
  journals: number;
  /** Записей всего (без пустых автосозданных строк). */
  records: number;
  /** С какого месяца организация в WeSetup (дата регистрации, ISO). */
  since: string;
};

/** Окно «журналы в работе». */
export const REVIEW_STATS_ACTIVE_DAYS = 30;

/**
 * Записи — без ложной точности: 4 312 → 4 300+, 437 → 430+, меньше
 * сотни — как есть. «+» значит «не меньше».
 */
export function roundRecords(count: number): { value: number; plus: boolean } {
  const n = Math.max(0, Math.floor(count));
  if (n < 100) return { value: n, plus: false };
  const step = n < 1000 ? 10 : 100;
  const value = Math.floor(n / step) * step;
  return { value, plus: value !== n };
}

/** Показываем, только когда есть что показать: хотя бы одна запись. */
export function hasReviewStats(stats: ReviewStats | null | undefined): stats is ReviewStats {
  return Boolean(stats && stats.records > 0);
}

/** Полных месяцев в WeSetup к дате `now` (0 — меньше месяца, тогда не показываем). */
export function monthsWithWeSetup(sinceIso: string, now: Date = new Date()): number {
  const since = new Date(sinceIso);
  if (!Number.isFinite(since.getTime()) || since > now) return 0;
  let months = (now.getUTCFullYear() - since.getUTCFullYear()) * 12 + (now.getUTCMonth() - since.getUTCMonth());
  if (now.getUTCDate() < since.getUTCDate()) months -= 1;
  return Math.max(0, months);
}

