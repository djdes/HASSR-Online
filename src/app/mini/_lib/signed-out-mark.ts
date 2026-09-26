/**
 * «Вышел вручную» — пометка на этом устройстве.
 *
 * Внутри Telegram `/mini` без сессии входит сам, по initData, а Telegram
 * привязан к одному сотруднику. Поэтому «Выйти» ничего не давало: через
 * секунду человек снова оказывался в том же аккаунте и не мог войти в
 * другой (жалоба владельца, 2026-09-26). Пока пометка стоит, `/mini` сам
 * не входит и открывает экран входа: там «Войти через Telegram» (снимает
 * пометку и входит как раньше) и вход по телефону или почте с паролем —
 * для другого аккаунта. Любой успешный вход пометку снимает.
 *
 * Хранится в localStorage: решение «входить ли самим» принимает браузер, а
 * серверу пометка не нужна. Хранилище бывает недоступно (приватный режим,
 * запрет данных сайтов, старый WebView) — тогда функции молча ничего не
 * делают и приложение ведёт себя как раньше. Ни одна из них не бросает.
 */

import {
  buildMiniAppAuthBootstrapPath,
  sanitizeMiniAppRedirectPath,
} from "@/lib/journal-obligation-links";

export const SIGNED_OUT_MARK_KEY = "wesetup.mini.signed-out";

/** Узкий срез `Storage` — чтобы логику можно было проверить тестом без браузера. */
export type MarkStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** localStorage этой вкладки или null, если его нет или доступ запрещён. */
export function browserMarkStorage(): MarkStorage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage ?? null;
  } catch {
    // При запрете данных сайтов Chrome бросает SecurityError уже на
    // чтении самого свойства `window.localStorage`.
    return null;
  }
}

/** Поставить пометку. `false` — хранилище недоступно, пометки нет. */
export function markSignedOut(
  storage: MarkStorage | null = browserMarkStorage(),
  now: number = Date.now(),
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(SIGNED_OUT_MARK_KEY, String(now));
    return true;
  } catch {
    return false;
  }
}

/** Снять пометку — после любого успешного входа. */
export function clearSignedOutMark(
  storage: MarkStorage | null = browserMarkStorage(),
): void {
  if (!storage) return;
  try {
    storage.removeItem(SIGNED_OUT_MARK_KEY);
  } catch {
    /* хранилище недоступно — снимать нечего */
  }
}

/** Стоит ли пометка «вышел вручную». */
export function isSignedOutManually(
  storage: MarkStorage | null = browserMarkStorage(),
): boolean {
  if (!storage) return false;
  try {
    const value = storage.getItem(SIGNED_OUT_MARK_KEY);
    return typeof value === "string" && value.length > 0;
  } catch {
    return false;
  }
}

/**
 * Что делать `/mini`, когда сессии нет:
 *   • `cookie-or-login` — вне Telegram (подписанных данных нет): подхватить
 *     живую куку или вести на форму входа, как раньше;
 *   • `login-screen` — в Telegram, но человек сам нажал «Выйти»: входить
 *     за него по Telegram нельзя, ведём на экран входа;
 *   • `telegram-sign-in` — в Telegram без пометки: входим по initData.
 */
export type MiniEntryStep = "cookie-or-login" | "login-screen" | "telegram-sign-in";

export function miniEntryStep(env: {
  hasInitData: boolean;
  signedOut: boolean;
}): MiniEntryStep {
  if (!env.hasInitData) return "cookie-or-login";
  return env.signedOut ? "login-screen" : "telegram-sign-in";
}

/**
 * Куда ведёт «Войти через Telegram» на экране входа.
 *
 * Входить по Telegram умеет только `/mini` — туда и ведём, сохранив, куда
 * человек шёл. `next` экрана входа обычно уже `/mini?next=…` (так его
 * строит сам `/mini`) — берём как есть; иначе заворачиваем в
 * `/mini?next=`. Экран входа целью не бывает: вошедшего вернуло бы на форму.
 */
export function telegramSignInHref(next: string | null | undefined): string {
  const target = next ? sanitizeMiniAppRedirectPath(next) : null;
  if (!target) return "/mini";
  const pathname = target.split(/[?#]/, 1)[0];
  if (pathname === "/mini") return target;
  if (pathname === "/" || pathname === "/mini/login") return "/mini";
  return buildMiniAppAuthBootstrapPath(target);
}

/** Обычный выход на этом устройстве. */
export const LOGOUT_URL = "/api/auth/logout";

/**
 * Полный выход на этом устройстве — ОДИН для всех кнопок «Выйти»: сайт
 * (шапка, лист профиля), мастер-кабинет, партнёрский кабинет,
 * мини-приложение, киоск, «Выйти на всех устройствах». В браузере его
 * зовут через `signOutAndOpen` (`lib/sign-out.ts`).
 *
 *   1. `POST logoutUrl` (по умолчанию `/api/auth/logout`) гасит ВСЕ куки
 *      сессии (актуальное имя и легаси) и куку оболочки. Одного `signOut`
 *      next-auth мало: он снимает только свою куку, и сессия возвращалась
 *      по оставшимся (из мастер-кабинета было не выйти). Киоск передаёт
 *      `/api/kiosk/lock`, «на всех устройствах» — `/api/security/logout-all`.
 *   2. Пометка «вышел вручную» — как только сервер сессию снял: дальше
 *      `/mini` в Telegram сам не входит. Вне Telegram она ни на что не
 *      влияет, а любой вход её снимает.
 *   3. `signOut({ redirect: false })` — чтобы next-auth и соседние вкладки
 *      узнали о выходе. Сбой или зависание здесь не страшны: сессии на
 *      сервере уже нет, поэтому ждём не дольше `timeoutMs`.
 *
 * Бросает, если сервер выход не подтвердил: человек должен увидеть
 * ошибку, а не «вышел», оставаясь в аккаунте.
 */
export async function signOutOnThisDevice(deps: {
  fetch: (input: string, init: RequestInit) => Promise<Pick<Response, "ok" | "status">>;
  signOut: () => Promise<unknown>;
  storage?: MarkStorage | null;
  timeoutMs?: number;
  /** Адрес выхода на сервере; по умолчанию `LOGOUT_URL`. */
  logoutUrl?: string;
}): Promise<void> {
  const response = await deps.fetch(deps.logoutUrl ?? LOGOUT_URL, { method: "POST" });
  if (!response.ok) {
    throw new Error(`logout failed: HTTP ${response.status}`);
  }
  markSignedOut(deps.storage === undefined ? browserMarkStorage() : deps.storage);

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.resolve()
        .then(() => deps.signOut())
        .then(
          () => undefined,
          () => undefined,
        ),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, deps.timeoutMs ?? 5000);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
