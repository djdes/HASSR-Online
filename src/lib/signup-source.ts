/**
 * Разметка воронки регистрации — общая для всех форм с одним полем
 * (hero, тёмный баннер, демо-журнал, финальный CTA, /register).
 *
 * Две вещи: цели Яндекс.Метрики с параметром места и источник визита
 * (посадочная, referrer, utm), который уходит вместе с почтой в
 * instant-register. Без места непонятно, какая из форм сработала; без
 * источника — какой канал приносит регистрации. Только браузер: каждая
 * функция молча выходит, если window/sessionStorage недоступны.
 */

const STORAGE_KEY = "wesetup.signup-source";
/**
 * Первое касание — в cookie на полгода (спека visit-source-2026-11): сервер
 * читает его в любом запросе (скачивание шаблона, обращение, заявка) и
 * пишет в организацию и CRM. sessionStorage жил одну вкладку, и источник
 * терялся, если почту оставляли в другой вкладке или на следующий день.
 */
export const VISIT_SOURCE_COOKIE = "wesetup_src";
const COOKIE_MAX_AGE = 180 * 24 * 60 * 60;

export type SignupSource = {
  place: string;
  landing: string;
  referrer: string;
  utmSource: string;
  utmMedium: string;
  utmCampaign: string;
  click?: "yclid" | "gclid";
};

type Stored = Omit<SignupSource, "place">;

/** Referrer без query и фрагмента: поисковые запросы и токены не храним. */
function cleanReferrer(raw: string): string {
  if (!raw) return "";
  try {
    const url = new URL(raw);
    return `${url.origin}${url.pathname}`.slice(0, 300);
  } catch {
    return "";
  }
}

function isOwnReferrer(referrer: string): boolean {
  try {
    return new URL(referrer).host === window.location.host;
  } catch {
    return false;
  }
}

/** Касание без внешнего referrer, utm и метки клика — «прямой заход». */
function isBare(stored: Partial<Stored> | null): boolean {
  if (!stored) return true;
  return !stored.utmSource && !stored.click && (!stored.referrer || isOwnReferrer(stored.referrer));
}

function readCookieSource(): Partial<Stored> | null {
  try {
    const pair = document.cookie.split("; ").find((item) => item.startsWith(`${VISIT_SOURCE_COOKIE}=`));
    if (!pair) return null;
    return JSON.parse(decodeURIComponent(pair.slice(VISIT_SOURCE_COOKIE.length + 1))) as Partial<Stored>;
  } catch {
    return null;
  }
}

function currentTouch(): Stored {
  const params = new URLSearchParams(window.location.search);
  const click = params.get("yclid") ? "yclid" : params.get("gclid") ? "gclid" : undefined;
  return {
    landing: window.location.pathname.slice(0, 200),
    referrer: cleanReferrer(document.referrer),
    utmSource: (params.get("utm_source") ?? "").slice(0, 200),
    utmMedium: (params.get("utm_medium") ?? "").slice(0, 200),
    utmCampaign: (params.get("utm_campaign") ?? "").slice(0, 200),
    ...(click ? { click } : {}),
  };
}

/**
 * Первое касание: страница входа, referrer, utm-метки и метка клика
 * рекламы. Запоминаем один раз — человек мог прийти на /dlya-kafe, а почту
 * оставить уже на главной. Исключение: первый визит был «прямым», а
 * следующий — из поиска или рекламы; тогда помним содержательное касание.
 * Вызывается на каждой странице сайта (`VisitSourceTracker` в layout).
 */
export function rememberSignupSource(): void {
  try {
    const touch = currentTouch();
    const existing = readCookieSource();
    if (!existing || (isBare(existing) && !isBare(touch))) {
      const value = encodeURIComponent(JSON.stringify(touch));
      const secure = window.location.protocol === "https:" ? "; Secure" : "";
      document.cookie = `${VISIT_SOURCE_COOKIE}=${value}; Path=/; Max-Age=${COOKIE_MAX_AGE}; SameSite=Lax${secure}`;
    }
    if (!window.sessionStorage.getItem(STORAGE_KEY)) {
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(touch));
    }
  } catch {
    /* cookie или sessionStorage недоступны — источник не сохраняем */
  }
}

export function readSignupSource(place: string): SignupSource {
  let stored: Partial<Stored> | null = readCookieSource();
  if (!stored) {
    try {
      stored = JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) ?? "null");
    } catch {
      stored = null;
    }
  }
  let landing = "";
  try {
    landing = stored?.landing ?? window.location.pathname;
  } catch {
    landing = "";
  }
  return {
    place,
    landing,
    referrer: stored?.referrer ?? "",
    utmSource: stored?.utmSource ?? "",
    utmMedium: stored?.utmMedium ?? "",
    utmCampaign: stored?.utmCampaign ?? "",
    ...(stored?.click === "yclid" || stored?.click === "gclid" ? { click: stored.click } : {}),
  };
}

/**
 * Цель Метрики. Счётчик берём из той же переменной, что и сам скрипт
 * Метрики, — хардкодить номер нельзя.
 */
export function ymGoal(name: string, params?: Record<string, string | number>): void {
  try {
    const counter = Number(process.env.NEXT_PUBLIC_YANDEX_METRIKA_ID);
    if (!Number.isFinite(counter) || counter <= 0) return;
    const ym = (
      window as unknown as {
        ym?: (
          id: number,
          action: string,
          goal: string,
          params?: Record<string, string | number>,
        ) => void;
      }
    ).ym;
    ym?.(counter, "reachGoal", name, params);
  } catch {
    /* метрика недоступна — не мешаем сценарию */
  }
}
