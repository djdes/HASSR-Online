/**
 * Приложение WeSetup (Capacitor) для Android и iOS.
 *
 * Приложение — оболочка вокруг сайта: оно открывает `/mini?src=app` и
 * приписывает себя к User-Agent: `WeSetupApp/<версия> (<ios|android>)`.
 * По этой приписке сайт включает мобильную оболочку (как в Telegram),
 * мост к нативным функциям и проверку «версия приложения не устарела».
 *
 * Здесь только чистые функции — их читают `proxy.ts`, серверные layout'ы
 * и браузер.
 */

export type MobileAppPlatform = "ios" | "android";

export type MobileAppInfo = { platform: MobileAppPlatform; version: string };

/** Идентификатор приложения в обоих магазинах. */
export const MOBILE_APP_ID = "ru.wesetup.app";

const APP_UA_RE = /(?:^|[\s;(])WeSetupApp\/(\d+(?:\.\d+){0,3})\s*\((ios|android)\)/i;

export function parseMobileAppUserAgent(
  ua: string | null | undefined
): MobileAppInfo | null {
  if (!ua) return null;
  const match = APP_UA_RE.exec(ua);
  if (!match) return null;
  return {
    platform: match[2].toLowerCase() as MobileAppPlatform,
    version: match[1],
  };
}

export function isMobileAppUserAgent(ua: string | null | undefined): boolean {
  return parseMobileAppUserAgent(ua) !== null;
}

/**
 * Нужен ли странице скрипт Telegram (`telegram-web-app.js`). Он грузится
 * до гидратации (`beforeInteractive`): пока telegram.org не ответит,
 * кнопки не работают. В приложении WeSetup Telegram нет, а telegram.org
 * бывает недоступен или медленный, — там скрипт только задерживает запуск.
 */
export function needsTelegramSdk(ua: string | null | undefined): boolean {
  return !isMobileAppUserAgent(ua);
}

/** Сравнение версий по числам: `1.10.0` новее `1.9.9`, `1.2` = `1.2.0`. */
export function compareAppVersion(a: string, b: string): -1 | 0 | 1 {
  const pa = a.trim().split(".").map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.trim().split(".").map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

/** Страница открыта внутри приложения WeSetup (только в браузере). */
export function isInsideMobileApp(): boolean {
  if (typeof navigator === "undefined") return false;
  return isMobileAppUserAgent(navigator.userAgent);
}

/**
 * Нужно ли просить обновить приложение.
 *
 * `minVersion` — серверная переменная `MOBILE_APP_MIN_VERSION`: её меняют
 * без пересборки сайта. Пустая или не похожая на версию — не проверяем
 * вовсе: опечатка в настройке не должна запереть всех на экране
 * обновления. Возвращает данные приложения, которое пора обновить.
 */
export function appUpdateRequirement(
  ua: string | null | undefined,
  minVersion: string | null | undefined
): MobileAppInfo | null {
  const min = minVersion?.trim();
  if (!min || !/^\d+(?:\.\d+){0,3}$/.test(min)) return null;
  const app = parseMobileAppUserAgent(ua);
  if (!app) return null;
  return compareAppVersion(app.version, min) < 0 ? app : null;
}

/**
 * Страница приложения в магазине. Для iOS нужен числовой Apple ID
 * (`APPLE_APP_ID`, появляется после создания приложения в App Store
 * Connect); пока его нет — поиск WeSetup в App Store.
 */
export function appStoreUrl(
  platform: MobileAppPlatform,
  appleAppId: string | null | undefined
): string {
  if (platform === "android") {
    return `https://play.google.com/store/apps/details?id=${MOBILE_APP_ID}`;
  }
  const id = appleAppId?.trim();
  if (id && /^\d+$/.test(id)) return `https://apps.apple.com/app/id${id}`;
  return "https://apps.apple.com/ru/search?term=WeSetup";
}

/**
 * Куда вести приложение со страницы входа сайта `/login`: у приложения свой
 * вход (`/mini/login`, по телефону или почте), а вход сайта — только по
 * почте, и сотрудник с телефоном на нём застревал. Сюда попадают, например,
 * с QR-страниц в режиме «через вход». `next` — возврат после входа, только
 * внутренний адрес страницы (не API и не чужой домен).
 */
export function appLoginHref(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) {
    return "/mini/login";
  }
  const path = next.split(/[?#]/, 1)[0];
  if (path === "/mini" || path === "/api" || path.startsWith("/api/")) return "/mini/login";
  return `/mini/login?next=${encodeURIComponent(next)}`;
}

/**
 * Первый запуск приложения без входа: `/mini?src=app` сразу ведёт на экран
 * входа ответом сервера. Без этого человек видел «Открываем кабинет…», пока
 * страница-вход загружалась, оживала и сама решала, что входа нет, — на
 * iPhone до 6 секунд. С `next` и опросом (`nps`) — как раньше: их разбирает
 * сама страница. Со входом тоже как раньше: страница уводит на главную.
 */
export function appColdStartRedirect(input: {
  userAgent: string | null | undefined;
  pathname: string;
  search: string;
  hasSession: boolean;
}): string | null {
  if (input.hasSession || input.pathname !== "/mini") return null;
  if (!isMobileAppUserAgent(input.userAgent)) return null;
  const params = new URLSearchParams(input.search);
  if (params.has("next") || params.has("nps")) return null;
  return `/mini/login?next=${encodeURIComponent(`${input.pathname}${input.search}`)}`;
}

/**
 * Нужна ли на iPhone своя подложка под строкой состояния. В приложении
 * WeSetup и на экране «Домой» страница рисуется под часами и «чёлкой»;
 * когда открыта клавиатура, iOS сдвигает видимую область, шапка оболочки
 * уезжает вместе со страницей, и под часами оказывался текст. В Safari во
 * вкладке и в Telegram строку состояния рисует не страница — там не нужна.
 */
export function needsIosStatusBarBackdrop(input: {
  userAgent: string;
  inApp: boolean;
  standalone: boolean;
  maxTouchPoints: number;
}): boolean {
  const ios =
    /iPhone|iPad|iPod/.test(input.userAgent) ||
    (/Macintosh/.test(input.userAgent) && input.maxTouchPoints > 1);
  return ios && (input.inApp || input.standalone);
}
