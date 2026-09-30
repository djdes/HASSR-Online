/**
 * Показывать ли окно «Что нового» — решает сервер ДО первой отрисовки.
 *
 * Раньше решал клиент: после гидрации читал localStorage и открывал окно
 * поверх уже нарисованной страницы (всплывало через секунду-две после
 * загрузки). А версия считалась по тексту заметок, отфильтрованному под
 * организацию (без партнёрской программы у тех, кто скрыл консультанта), —
 * у того, кто переключается между организациями, у каждой была своя
 * «новая» версия, и окно появлялось снова и снова.
 *
 * Теперь:
 *   • версия — хэш ПОЛНОГО текста заметок (`whatsNewVersion(WHATS_NEW_NOTES)`),
 *     одна на всех; показываются по-прежнему заметки организации;
 *   • какую версию человек уже закрыл, лежит в куке этого устройства —
 *     сервер её видит и рисует окно сразу открытым или не рисует вовсе;
 *   • браузер, где куки ещё нет (первый заход после выката), — «legacy»:
 *     клиент один раз переносит отметку из localStorage в куку.
 * Модуль без React и без `window`: его берут layout, окно и тест.
 */

export const WHATS_NEW_COOKIE = "wesetup-whats-new";

/** Старая отметка в localStorage — только чтобы перенести в куку. */
export const WHATS_NEW_LEGACY_KEY = "wesetup.last-seen-build-sha";

/** ~400 дней — дольше куку браузеры всё равно не хранят. */
export const WHATS_NEW_COOKIE_MAX_AGE = 60 * 60 * 24 * 400;

/**
 * `show` — окно в разметке сразу открытым; `legacy` — куки нет, решит
 * клиент по старой отметке (один раз); `hide` — окна в разметке нет.
 */
export type WhatsNewMode = "show" | "legacy" | "hide";

/** Значение куки: версия — хэш в base36; чужое содержимое не принимаем. */
export function parseWhatsNewCookie(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  return /^[a-z0-9._-]{1,64}$/i.test(v) ? v : null;
}

export function whatsNewMode(input: {
  /** Руководитель и окно не выключено в «Внешний вид». */
  enabled: boolean;
  /** Текущая версия заметок. */
  version: string;
  /** Кука устройства (сырое значение). */
  seenCookie: string | null | undefined;
}): WhatsNewMode {
  if (!input.enabled) return "hide";
  const seen = parseWhatsNewCookie(input.seenCookie);
  if (seen === null) return "legacy";
  return seen === input.version ? "hide" : "show";
}

/**
 * Первый заход после выката (куки нет): что делать по старой отметке.
 *   • отметки нет — человек здесь впервые, новинок для него нет: запомнить
 *     текущую версию, окно не открывать (как и раньше);
 *   • отметка = текущей — уже видел;
 *   • отметка старая — заметки изменились: открыть окно; в куку — старую
 *     отметку, чтобы до закрытия сервер рисовал окно открытым сразу.
 */
export function legacyWhatsNewAction(
  stored: string | null | undefined,
  version: string,
): { open: boolean; cookieVersion: string } {
  if (!stored) return { open: false, cookieVersion: version };
  if (stored === version) return { open: false, cookieVersion: version };
  return { open: true, cookieVersion: parseWhatsNewCookie(stored) ?? "legacy" };
}

/** Строка для `document.cookie`. */
export function whatsNewCookieString(version: string): string {
  const safe = parseWhatsNewCookie(version) ?? "legacy";
  return `${WHATS_NEW_COOKIE}=${safe}; Path=/; Max-Age=${WHATS_NEW_COOKIE_MAX_AGE}; SameSite=Lax`;
}
