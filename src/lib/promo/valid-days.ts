/**
 * Срок промокода «N дней» — для персональных кодов рассылки «КП» и
 * генератора КП. Код действует до конца дня (23:59:59 по Москве)
 * «сегодня по Москве + N»: создан 29.09, N = 14 → действует до 13.10
 * включительно. Даже при N = 1 у получателя есть целые сутки.
 *
 * Чистый модуль (без базы) — его читает и форма в браузере.
 */

export const PROMO_VALID_DAYS_MIN = 1;
export const PROMO_VALID_DAYS_MAX = 90;

const MSK_OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export function isValidPromoValidDays(days: unknown): days is number {
  return typeof days === "number" && Number.isInteger(days) && days >= PROMO_VALID_DAYS_MIN && days <= PROMO_VALID_DAYS_MAX;
}

/** Конец срока: 23:59:59.999 по Москве дня «сегодня (МСК) + days». */
export function promoEndsAfterDays(now: Date, days: number): Date {
  const n = Math.min(PROMO_VALID_DAYS_MAX, Math.max(PROMO_VALID_DAYS_MIN, Math.round(Number.isFinite(days) ? days : PROMO_VALID_DAYS_MIN)));
  // Полночь сегодняшнего московского дня, в UTC.
  const mskMidnight = Math.floor((now.getTime() + MSK_OFFSET_MS) / DAY_MS) * DAY_MS - MSK_OFFSET_MS;
  return new Date(mskMidnight + (n + 1) * DAY_MS - 1);
}
