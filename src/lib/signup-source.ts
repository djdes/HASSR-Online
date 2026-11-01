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

export type SignupSource = {
  place: string;
  landing: string;
  referrer: string;
  utmSource: string;
  utmMedium: string;
  utmCampaign: string;
};

type Stored = Omit<SignupSource, "place">;

/**
 * Первое касание в этой вкладке: страница входа, referrer и utm-метки.
 * Запоминаем один раз — человек мог прийти на /dlya-kafe, а почту
 * оставить уже на главной.
 */
export function rememberSignupSource(): void {
  try {
    if (window.sessionStorage.getItem(STORAGE_KEY)) return;
    const params = new URLSearchParams(window.location.search);
    const stored: Stored = {
      landing: window.location.pathname,
      referrer: document.referrer,
      utmSource: params.get("utm_source") ?? "",
      utmMedium: params.get("utm_medium") ?? "",
      utmCampaign: params.get("utm_campaign") ?? "",
    };
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  } catch {
    /* sessionStorage недоступен — источник не сохраняем */
  }
}

export function readSignupSource(place: string): SignupSource {
  let stored: Partial<Stored> | null = null;
  try {
    stored = JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) ?? "null");
  } catch {
    stored = null;
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
