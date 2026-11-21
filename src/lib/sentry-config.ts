/**
 * Sentry — ошибки у живых пользователей (docs/cloud-testing.md, спека cloud-testing-2026-11-21, AC5).
 *
 * Что здесь: какой DSN, когда Sentry включён и что никогда не уходит из приложения. Используется и в
 * браузере (src/instrumentation-client.ts), и на сервере (src/lib/sentry-server.ts).
 *
 * - DSN публичный по устройству Sentry: по нему можно только присылать события, он всё равно попадает в
 *   браузерный бандл. Приём событий в проекте ограничен доменами wesetup.ru.
 * - Включён только в продакшен-сборке на wesetup.ru: не в `next dev`, не на localhost, не в CI и не в
 *   форке публичного репозитория.
 * - Без персональных данных (SENTRY_DATA_COLLECTION + scrubEvent): нет пользователя, IP, кук, заголовков, тел и строк
 *   запроса; токены из ссылок (приглашения, QR, проверяющий) вырезаются из адресов. IP не хранит и сам
 *   проект Sentry (scrubIPAddresses), события из браузера идут через наш домен (`/api/monitoring`).
 * - Только ошибки: без трассировки и без записи сессий (вес страницы и персональные данные).
 */

import type { init } from "@sentry/nextjs";

type SentryOptions = NonNullable<Parameters<typeof init>[0]>;

export const SENTRY_DSN =
  process.env.NEXT_PUBLIC_SENTRY_DSN ||
  "https://96112dc6153ddf7b2c7d26a5860f7be0@o4512471790911488.ingest.de.sentry.io/4512471804346448";

/** Маршрут-туннель: браузер шлёт события на свой домен, сервер пересылает только тело в Sentry. */
export const SENTRY_TUNNEL_PATH = "/api/monitoring";

const PRODUCTION_HOSTS = new Set(["wesetup.ru", "www.wesetup.ru"]);

/** Браузер: продакшен-сборка, открытая на wesetup.ru (сайт, приложение WeSetup, мини-приложение). */
export function sentryBrowserEnabled(input: { nodeEnv: string | undefined; hostname: string }): boolean {
  return input.nodeEnv === "production" && PRODUCTION_HOSTS.has(input.hostname.toLowerCase());
}

/** Сервер: продакшен-сборка с публичным адресом wesetup.ru; SENTRY_DISABLED=1 выключает. */
export function sentryServerEnabled(env: Record<string, string | undefined>): boolean {
  if (env.NODE_ENV !== "production" || env.SENTRY_DISABLED === "1") return false;
  try {
    return PRODUCTION_HOSTS.has(new URL(env.NEXTAUTH_URL ?? "").hostname.toLowerCase());
  } catch {
    return false;
  }
}

/** Версия события — та же короткая сборка, что в /api/health. */
export function sentryRelease(buildId: string | undefined | null): string | undefined {
  const id = buildId?.trim();
  return id && id !== "dev" && id !== "unknown" ? `wesetup@${id}` : undefined;
}

/**
 * Что SDK собирает сам. В v11 по умолчанию собирается всё (пользователь, куки, заголовки, тела запросов,
 * параметры запросов к базе, локальные переменные стека) — выключаем всё, что может нести персональные
 * данные. Из заголовков остаются только браузер и язык: без них не понять, на каком телефоне упало.
 */
export const SENTRY_DATA_COLLECTION: SentryOptions["dataCollection"] = {
  userInfo: false,
  cookies: false,
  httpHeaders: { request: { allow: ["user-agent", "accept-language"] }, response: false },
  httpBodies: [],
  urlQueryParams: false,
  graphQL: { document: false, variables: false },
  genAI: { inputs: false, outputs: false },
  mcp: { inputs: false, outputs: false },
  databaseQueryData: false,
  queues: false,
  stackFrameVariables: false,
};

/** Шум, который не стоит лимита бесплатного тарифа: обрывы сети у телефонов и известные сообщения браузеров. */
export const SENTRY_IGNORE_ERRORS: Array<string | RegExp> = [
  "ResizeObserver loop limit exceeded",
  "ResizeObserver loop completed with undelivered notifications",
  "Non-Error promise rejection captured",
  /^Load failed$/,
  /^Failed to fetch$/,
  /^NetworkError when attempting to fetch resource\.?$/,
  /^The operation was aborted\.?$/,
  /signal is aborted without reason/,
];

/** Ошибки из расширений браузера — не наши. */
export const SENTRY_DENY_URLS: RegExp[] = [
  /^chrome-extension:\/\//i,
  /^moz-extension:\/\//i,
  /^safari(-web)?-extension:\/\//i,
];

/** Сегмент после этих частей пути — токен доступа (приглашение, QR, проверяющий, КП, вход по ссылке). */
const TOKEN_ROUTE_PARENTS = new Set([
  "invite",
  "join",
  "inspector",
  "exchange-request",
  "exchange-requests",
  "kp",
  "pair",
  "policy",
  "q",
  "magic",
  "claim",
]);
/** Длинные сегменты — тоже токены (base64url, хеши, UUID); id записей (cuid, 25 символов) остаются. */
const LONG_TOKEN = /^[A-Za-z0-9_-]{32,}$/;

/** Адрес без строки запроса, якоря и токенов в пути. Относительный адрес остаётся относительным. */
export function scrubUrl(url: string): string {
  if (!url) return url;
  const cut = url.search(/[?#]/);
  const base = cut === -1 ? url : url.slice(0, cut);
  const match = base.match(/^([a-z][a-z0-9+.-]*:\/\/[^/]*)?(.*)$/i);
  const origin = match?.[1] ?? "";
  const segments = (match?.[2] ?? base).split("/");
  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i];
    if (!segment) continue;
    if (LONG_TOKEN.test(segment) || (i > 0 && TOKEN_ROUTE_PARENTS.has(segments[i - 1].toLowerCase()))) {
      segments[i] = ":token";
    }
  }
  return origin + segments.join("/");
}

type BreadcrumbLike = { category?: string; data?: { [key: string]: unknown } };
type EventLike = {
  user?: unknown;
  request?: {
    url?: string;
    query_string?: unknown;
    cookies?: unknown;
    data?: unknown;
    headers?: { [key: string]: string };
  };
  breadcrumbs?: BreadcrumbLike[];
};

const DROPPED_HEADERS = new Set(["cookie", "authorization", "x-forwarded-for", "x-real-ip", "x-client-ip", "forwarded"]);

/** Ссылки в навигации и сетевых запросах — без токенов и параметров. */
export function scrubBreadcrumb<T extends BreadcrumbLike>(breadcrumb: T): T {
  const data = breadcrumb.data;
  if (data) {
    for (const key of ["url", "from", "to"]) {
      if (typeof data[key] === "string") data[key] = scrubUrl(data[key] as string);
    }
  }
  return breadcrumb;
}

/** Событие перед отправкой: без пользователя, кук, авторизации, тел и строк запроса, токенов в адресах. */
export function scrubEvent<T extends EventLike>(event: T): T {
  delete event.user;
  const request = event.request;
  if (request) {
    if (request.url) request.url = scrubUrl(request.url);
    delete request.query_string;
    delete request.cookies;
    delete request.data;
    if (request.headers) {
      for (const name of Object.keys(request.headers)) {
        const lower = name.toLowerCase();
        if (DROPPED_HEADERS.has(lower)) delete request.headers[name];
        else if (lower === "referer") request.headers[name] = scrubUrl(request.headers[name]);
      }
    }
  }
  for (const breadcrumb of event.breadcrumbs ?? []) scrubBreadcrumb(breadcrumb);
  return event;
}
