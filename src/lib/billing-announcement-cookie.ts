/**
 * «Скрыть анонс до завтра» — отметка в куке этого устройства, а не в
 * localStorage: сервер видит её и не рисует закрытый сегодня анонс вовсе.
 * Раньше анонс рисовался после гидрации (сначала пусто, потом плашка) и
 * сдвигал страницу на телефоне. Модуль без React и без `window`.
 */

export const BILLING_ANNOUNCEMENT_COOKIE = "wesetup-billing-ann";

/** Прежняя отметка в localStorage — только чтобы один раз перенести в куку. */
export const BILLING_ANNOUNCEMENT_LEGACY_KEY = "wesetup.billing-announcement.dismissed-day";

/** Двое суток хватает: отметка действует только в свой день по Москве. */
export const BILLING_ANNOUNCEMENT_COOKIE_MAX_AGE = 60 * 60 * 48;

/** День по Москве «2026-10-03»; чужое содержимое куки не принимаем. */
export function parseAnnouncementCookie(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

/** Закрыт ли анонс сегодня (в этот день по Москве). */
export function isAnnouncementDismissed(cookieValue: string | null | undefined, dayKey: string): boolean {
  return parseAnnouncementCookie(cookieValue) === dayKey;
}

export function announcementCookieString(dayKey: string): string {
  return `${BILLING_ANNOUNCEMENT_COOKIE}=${dayKey}; Path=/; Max-Age=${BILLING_ANNOUNCEMENT_COOKIE_MAX_AGE}; SameSite=Lax`;
}
