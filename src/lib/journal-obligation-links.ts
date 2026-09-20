type EntryTargetArgs = {
  journalCode: string;
  isDocument: false;
  activeDocumentId: null;
};

type DocumentTargetArgs = {
  journalCode: string;
  isDocument: true;
  activeDocumentId: string | null;
};

export type TargetArgs = EntryTargetArgs | DocumentTargetArgs;

const MINI_APP_ORIGIN = "https://wesetup.local";
const MINI_APP_PATH_PREFIX = "/mini";
const DEFAULT_MINI_APP_BASE_URL = "https://wesetup.ru/mini";

export function resolveJournalObligationTargetPath(
  args: TargetArgs
): string {
  const { journalCode, isDocument, activeDocumentId } = args;
  if (!isDocument && activeDocumentId !== null) {
    throw new Error("Entry journal targets cannot include activeDocumentId");
  }

  // Мини-приложение — это оболочка вокруг страниц сайта (П-3), поэтому
  // цель обязательства ведёт прямо на страницу кабинета. Раньше здесь
  // был `/mini/journals/...`, и человек делал лишний прыжок через
  // экран-переходник.
  const basePath = `/journals/${journalCode}`;
  return isDocument ? basePath : `${basePath}/new`;
}

/** Путь принадлежит самому мини-приложению, а не странице сайта. */
function isMiniOnlyPathname(pathname: string): boolean {
  return (
    pathname === MINI_APP_PATH_PREFIX ||
    pathname.startsWith(`${MINI_APP_PATH_PREFIX}/`)
  );
}

/**
 * Безопасный внутренний адрес для возврата после входа.
 *
 * Пропускаем любой путь этого же сайта: мини-приложение показывает
 * страницы кабинета в своей оболочке, и возвращать человека нужно
 * туда, куда он шёл, — хоть на `/mini/today`, хоть на `/journals`.
 *
 * Не пропускаем: чужой origin (в том числе `//evil.example`, который
 * `URL` разбирает как протокол-относительный адрес) и `/api/*` —
 * обработчики отвечают не страницами, и редирект туда после входа
 * выглядел бы поломкой.
 */
export function sanitizeMiniAppRedirectPath(
  targetPath: string
): string | null {
  try {
    const url = new URL(targetPath, MINI_APP_ORIGIN);
    if (url.origin !== MINI_APP_ORIGIN) {
      return null;
    }
    if (!url.pathname.startsWith("/") || url.pathname.startsWith("//")) {
      return null;
    }
    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
      return null;
    }

    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

export function normalizeMiniAppBaseUrl(
  rawBaseUrl: string | null | undefined,
  fallback: string | null = DEFAULT_MINI_APP_BASE_URL
): string | null {
  const raw = rawBaseUrl?.trim() || fallback?.trim();
  if (!raw) return null;

  const withoutTrailingSlash = raw.replace(/\/+$/, "");
  return withoutTrailingSlash.endsWith(MINI_APP_PATH_PREFIX)
    ? withoutTrailingSlash
    : `${withoutTrailingSlash}${MINI_APP_PATH_PREFIX}`;
}

export function getMiniAppBaseUrlFromEnv(
  env: Record<string, string | undefined> = typeof process !== "undefined"
    ? process.env
    : {}
): string | null {
  return normalizeMiniAppBaseUrl(
    env.MINI_APP_BASE_URL ||
      (env.NEXTAUTH_URL ? `${env.NEXTAUTH_URL.replace(/\/+$/, "")}/mini` : null)
  );
}

export function buildMiniAppUrl(
  miniAppBaseUrl: string | null | undefined,
  targetPath: string = MINI_APP_PATH_PREFIX
): string | null {
  const baseUrl = normalizeMiniAppBaseUrl(miniAppBaseUrl);
  if (!baseUrl) return null;

  const safeTargetPath =
    sanitizeMiniAppRedirectPath(targetPath) ?? MINI_APP_PATH_PREFIX;
  const pathname = safeTargetPath.split(/[?#]/)[0];

  // Страница сайта (`/journals/hygiene`): база оканчивается на `/mini`,
  // и приклеивать к ней адрес кабинета нельзя — режем хвост.
  if (!isMiniOnlyPathname(pathname)) {
    const origin = baseUrl.slice(0, -MINI_APP_PATH_PREFIX.length);
    return `${origin}${safeTargetPath}`;
  }

  const suffix =
    safeTargetPath === MINI_APP_PATH_PREFIX
      ? ""
      : safeTargetPath.slice(MINI_APP_PATH_PREFIX.length);

  return `${baseUrl}${suffix}`;
}

export function buildMiniAppAuthBootstrapPath(targetPath: string): string {
  const safeTargetPath = sanitizeMiniAppRedirectPath(targetPath);
  if (!safeTargetPath || safeTargetPath === "/mini") {
    return "/mini";
  }

  const params = new URLSearchParams({ next: safeTargetPath });
  return `/mini?${params.toString()}`;
}

export function buildMiniObligationEntryUrl(
  miniAppBaseUrl: string,
  obligationId: string
): string {
  return `${normalizeMiniAppBaseUrl(miniAppBaseUrl)}/o/${obligationId}`;
}
