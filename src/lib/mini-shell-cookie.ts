/**
 * Режим оболочки мини-приложения.
 *
 * Мини-приложение — это тот же сайт, только в мобильной оболочке
 * (своя шапка, нижнее меню, кнопка «назад» Telegram, тема). Страницы
 * кабинета `(dashboard)` при этом остаются ровно теми же самыми — со
 * своими проверками прав. Единственное, что меняется, — хром вокруг них.
 *
 * Признак режима — сессионная кука `ws-shell=mini`. Её ставит клиент
 * мини-приложения, а снимают: сторож на широком экране, страница входа
 * сайта, выход из аккаунта и ссылка «Открыть полную версию» в профиле.
 *
 * Здесь только чистые функции — их же читает и `proxy.ts`, и серверные
 * layout'ы, и браузер. Логика покрыта тестом: ошибка тут либо запирает
 * человека в мобильной оболочке на компьютере, либо наоборот — отдаёт
 * ему сайтовый хром внутри Telegram.
 */

export const MINI_SHELL_COOKIE = "ws-shell";
export const MINI_SHELL_VALUE = "mini";

/** Ниже этой ширины считаем, что перед нами телефон/планшет. */
export const MINI_SHELL_DESKTOP_WIDTH = 1024;

export function isMiniShellValue(value: string | null | undefined): boolean {
  return value === MINI_SHELL_VALUE;
}

/** Путь принадлежит самому мини-приложению (а не странице сайта). */
export function isMiniPath(pathname: string): boolean {
  return pathname === "/mini" || pathname.startsWith("/mini/");
}

/**
 * Строка для `document.cookie` / заголовка `Set-Cookie`.
 *
 * Кука сессионная (без `Max-Age`): закрыл приложение — забыли. На https
 * обязателен `SameSite=None; Secure`, потому что Telegram Web открывает
 * мини-приложение во фрейме, и `Lax` туда просто не доедет.
 */
export function buildMiniShellCookie(secure: boolean): string {
  return secure
    ? `${MINI_SHELL_COOKIE}=${MINI_SHELL_VALUE}; Path=/; SameSite=None; Secure`
    : `${MINI_SHELL_COOKIE}=${MINI_SHELL_VALUE}; Path=/; SameSite=Lax`;
}

/** Та же кука с нулевым сроком — снимает режим оболочки. */
export function buildMiniShellClearCookie(secure: boolean): string {
  return secure
    ? `${MINI_SHELL_COOKIE}=; Path=/; Max-Age=0; SameSite=None; Secure`
    : `${MINI_SHELL_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
}

/** Есть ли кука режима в строке `document.cookie`. */
export function hasMiniShellCookie(rawCookie: string | null | undefined): boolean {
  if (!rawCookie) return false;
  return rawCookie
    .split(";")
    .map((part) => part.trim())
    .some((part) => part === `${MINI_SHELL_COOKIE}=${MINI_SHELL_VALUE}`);
}

export type MiniShellEnvironment = {
  pathname: string;
  /** Открыто внутри Telegram (`isInsideTelegram()`). */
  insideTelegram: boolean;
  /** Установлено на домашний экран (display-mode / navigator.standalone). */
  standalone: boolean;
  /** Ширина окна в CSS-пикселях. */
  viewportWidth: number;
};

/**
 * Ставить ли куку режима.
 *
 * Мы внутри Telegram, либо приложение установлено на домашний экран,
 * либо человек просто открыл экран мини-приложения в браузере — во всех
 * трёх случаях дальше он должен видеть мобильную оболочку.
 */
export function shouldSetMiniShell(env: MiniShellEnvironment): boolean {
  return env.insideTelegram || env.standalone || isMiniPath(env.pathname);
}

/**
 * Снимать ли куку режима.
 *
 * Человек пришёл на сайт с компьютера: ни Telegram, ни установленного
 * приложения, широкое окно и путь не из `/mini/*`. Оболочку с нижним
 * меню на 27 дюймах показывать незачем.
 *
 * Пути `/mini/*` исключены намеренно: там оболочка — это и есть сам
 * экран, а не обёртка вокруг страницы сайта.
 */
export function shouldDropMiniShell(env: MiniShellEnvironment): boolean {
  if (env.insideTelegram || env.standalone) return false;
  if (isMiniPath(env.pathname)) return false;
  return env.viewportWidth >= MINI_SHELL_DESKTOP_WIDTH;
}

/**
 * Куда вести неавторизованного в режиме оболочки.
 *
 * На `/login` не отправляем: в Telegram вход происходит сам, по
 * initData. Возврат на исходный адрес имеет смысл только для экранов
 * мини-приложения — на страницу сайта человек после входа попадёт из
 * «Разделов», а открытый чужой адрес в `next` — лишний вектор.
 */
export function miniShellSignInHref(nextPath: string | null | undefined): string {
  if (!nextPath || !nextPath.startsWith("/") || nextPath.startsWith("//")) {
    return "/mini";
  }
  if (!isMiniPath(nextPath)) return "/mini";
  if (nextPath === "/mini") return "/mini";
  return `/mini?next=${encodeURIComponent(nextPath)}`;
}
