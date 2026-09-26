/**
 * Куки сессии — одно актуальное имя.
 *
 * Раньше сессия жила под четырьмя именами сразу: next-auth ставил своё
 * (`__Secure-haccp-online.session-token` на проде), а собственные входы
 * (`issue-session.ts`: пароль, телефон, личный QR, приглашение…) — ещё
 * `haccp-online.session-token` и два легаси-имени. Читатели (proxy,
 * `getServerSession` проекта) брали `haccp-online.session-token` первым,
 * а `useSession` и `signOut` next-auth знают только своё имя. Итог
 * (2026-09-26): «Выйти» через `signOut` гасил одну куку, по остальным
 * человек оставался в аккаунте (из мастер-кабинета не выйти вовсе), а
 * после входа другим аккаунтом через next-auth proxy и страницы видели
 * прежнего человека.
 *
 * Теперь:
 *   • актуальное имя одно — то же, что у next-auth (`sessionCookieName`);
 *   • любой вход кладёт токен только под него и гасит остальные имена;
 *   • читатели берут его первым, прочие имена — лишь запасной вариант,
 *     когда актуальной куки нет (сессии, выданные до этой правки);
 *   • выход гасит все имена с теми же атрибутами, что при установке.
 *
 * Модуль чистый (без Next и базы): его читает proxy и проверяют тесты —
 * окружение передаётся параметром `production`.
 */

import { MINI_SHELL_COOKIE } from "@/lib/mini-shell-cookie";

export const SESSION_COOKIE_PROD = "__Secure-haccp-online.session-token";
export const SESSION_COOKIE_DEV = "haccp-online.session-token";

/**
 * Все имена, под которыми сессия лежала когда-либо: актуальные (прод и
 * dev) и легаси. Выход гасит каждое.
 */
export const ALL_SESSION_COOKIES: readonly string[] = [
  SESSION_COOKIE_PROD,
  SESSION_COOKIE_DEV,
  "__Secure-next-auth.session-token",
  "next-auth.session-token",
];

/** Служебные куки старого next-auth (до своих имён) — гасятся при выходе. */
export const LEGACY_AUX_COOKIES: readonly string[] = [
  "__Host-next-auth.csrf-token",
  "next-auth.csrf-token",
  "__Secure-next-auth.callback-url",
  "next-auth.callback-url",
];

/** Прод ли это. Читается при каждом вызове — тесты подменяют окружение. */
export function isProductionEnv(): boolean {
  return process.env.NODE_ENV === "production";
}

/** Актуальное имя куки сессии; его же ставит next-auth (`lib/auth.ts`). */
export function sessionCookieName(production: boolean = isProductionEnv()): string {
  return production ? SESSION_COOKIE_PROD : SESSION_COOKIE_DEV;
}

/** Порядок чтения: актуальное имя, за ним прочие — только как запасной вариант. */
export function sessionCookieReadOrder(production: boolean = isProductionEnv()): string[] {
  const current = sessionCookieName(production);
  return [current, ...ALL_SESSION_COOKIES.filter((name) => name !== current)];
}

/** Устаревшие имена: все, кроме актуального. Их гасит каждый вход. */
export function staleSessionCookieNames(production: boolean = isProductionEnv()): string[] {
  const current = sessionCookieName(production);
  return ALL_SESSION_COOKIES.filter((name) => name !== current);
}

/**
 * Кука сессии, которую видят все читатели: proxy, `getServerSession`
 * проекта и перезапись claim'ов. Первое непустое имя в порядке чтения.
 */
export function pickSessionCookie(
  get: (name: string) => string | null | undefined,
  production: boolean = isProductionEnv(),
): { name: string; value: string } | null {
  for (const name of sessionCookieReadOrder(production)) {
    const value = get(name);
    if (value) return { name, value };
  }
  return null;
}

/**
 * Префиксы `__Secure-` и `__Host-` браузер принимает только с `Secure` —
 * и установку, и удаление. Остальным `Secure` ставим на проде, как вход.
 */
export function cookieNeedsSecure(name: string, production: boolean = isProductionEnv()): boolean {
  return name.startsWith("__Secure-") || name.startsWith("__Host-") || production;
}

export type CookieOptions = {
  path: string;
  httpOnly: boolean;
  sameSite: "lax" | "none";
  secure: boolean;
  maxAge: number;
  expires?: Date;
};

/** Атрибуты куки сессии — те же, что у next-auth (`authOptions.cookies.sessionToken`). */
export function sessionCookieOptions(
  name: string,
  maxAge: number,
  production: boolean = isProductionEnv(),
): CookieOptions {
  return { path: "/", httpOnly: true, sameSite: "lax", secure: cookieNeedsSecure(name, production), maxAge };
}

/**
 * Атрибуты удаления: имя, путь и `Secure` совпадают с установкой — иначе
 * браузер оставит куку. `Domain` нигде не ставится (куки host-only), и
 * при удалении его нет. Срок — в прошлом и `Max-Age=0`.
 */
export function expiredCookieOptions(name: string, production: boolean = isProductionEnv()): CookieOptions {
  return {
    path: "/",
    httpOnly: name.includes("session-token"),
    sameSite: "lax",
    secure: cookieNeedsSecure(name, production),
    maxAge: 0,
    expires: new Date(0),
  };
}

/** Строка `Set-Cookie`, удаляющая куку (для ответов, собранных не через `NextResponse`). */
export function serializeExpiredCookie(name: string, production: boolean = isProductionEnv()): string {
  const options = expiredCookieOptions(name, production);
  return [
    `${name}=`,
    "Path=/",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    "Max-Age=0",
    options.httpOnly ? "HttpOnly" : null,
    "SameSite=Lax",
    options.secure ? "Secure" : null,
  ]
    .filter(Boolean)
    .join("; ");
}

/**
 * Куда писать: `NextResponse.cookies` или хранилище `cookies()` из
 * `next/headers`. Писать только через него: `NextResponse.cookies.set`
 * пересобирает ВСЕ заголовки `Set-Cookie` из своей таблицы, и строки,
 * добавленные до этого через `headers.append`, пропадают.
 */
export type CookieJar = {
  set(name: string, value: string, options: CookieOptions): unknown;
};

/** Погасить куки сессии (кроме `keep`). */
export function expireSessionCookies(
  jar: CookieJar,
  options: { keep?: string; production?: boolean } = {},
): void {
  const production = options.production ?? isProductionEnv();
  for (const name of ALL_SESSION_COOKIES) {
    if (name === options.keep) continue;
    jar.set(name, "", expiredCookieOptions(name, production));
  }
}

/** Служебные куки старого next-auth (csrf, callback-url) — гасятся при входе и выходе. */
export function expireLegacyAuxCookies(jar: CookieJar, production: boolean = isProductionEnv()): void {
  for (const name of LEGACY_AUX_COOKIES) {
    jar.set(name, "", expiredCookieOptions(name, production));
  }
}

/**
 * Полный выход на этом устройстве (`POST /api/auth/logout`, «Выйти на всех
 * устройствах»): все имена сессии, служебные куки старого next-auth и
 * режим оболочки мини-приложения — на общем компьютере следующий
 * вошедший должен увидеть обычный сайт, а не оболочку предыдущего.
 */
export function expireSignOutCookies(jar: CookieJar, production: boolean = isProductionEnv()): void {
  expireSessionCookies(jar, { production });
  expireLegacyAuxCookies(jar, production);
  // Атрибуты — как у `buildMiniShellClearCookie` (lib/mini-shell-cookie.ts):
  // на https кука оболочки живёт с `SameSite=None; Secure`.
  jar.set(MINI_SHELL_COOKIE, "", {
    path: "/",
    httpOnly: false,
    sameSite: production ? "none" : "lax",
    secure: production,
    maxAge: 0,
    expires: new Date(0),
  });
}

/**
 * Вход: токен — под актуальное имя, прочие имена сессии гасятся. Двух
 * сессий (двух аккаунтов) в одном браузере не остаётся.
 */
export function setSessionCookie(
  jar: CookieJar,
  token: string,
  maxAge: number,
  production: boolean = isProductionEnv(),
): void {
  const name = sessionCookieName(production);
  expireSessionCookies(jar, { keep: name, production });
  jar.set(name, token, sessionCookieOptions(name, maxAge, production));
}

/** Имя куки из строки `Set-Cookie`. */
function setCookieName(line: string): string {
  return line.slice(0, Math.max(0, line.indexOf("="))).trim();
}

/**
 * Ответ next-auth (вход через него, обновление или выход): если он пишет
 * куку сессии — ставит или гасит, — остальные имена гасим. Иначе после
 * входа через next-auth осталась бы кука прежнего аккаунта, а после
 * `signOut` — запасная кука, по которой человек снова «в аккаунте».
 */
export function withOnlyCurrentSessionCookie(
  response: Response,
  production: boolean = isProductionEnv(),
): Response {
  const current = sessionCookieName(production);
  const writesSession = response.headers.getSetCookie().some((line) => {
    const name = setCookieName(line);
    // next-auth режет большой токен на части: `<имя>.0`, `<имя>.1`…
    return name === current || name.startsWith(`${current}.`);
  });
  if (!writesSession) return response;

  const headers = new Headers(response.headers);
  for (const name of staleSessionCookieNames(production)) {
    headers.append("Set-Cookie", serializeExpiredCookie(name, production));
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
