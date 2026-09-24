/**
 * Доступ сессии мастер-кабинета справочников — чистая логика для proxy
 * (`src/proxy.ts`) без БД.
 *
 * Организация `kind="directory"` — не пищеблок: её сотрудник бэк-офиса
 * ведёт только меню и сырьё пула. Всё остальное (журналы, сотрудники,
 * настройки, их API) ему недоступно; и наоборот, `/master*` открыт только
 * такой сессии.
 */

export type OrgKind = "regular" | "directory";

export const DIRECTORY_ONLY_API_ERROR = "Доступно только в мастер-кабинете";

export function parseOrgKind(value: unknown): OrgKind {
  return value === "directory" ? "directory" : "regular";
}

/** Организация, в которой сессия работает: ROOT «Войти как» → переключённая → домашняя. */
export function tokenActiveOrgId(token: {
  isRoot?: unknown;
  actingAsOrganizationId?: unknown;
  activeOrganizationId?: unknown;
  organizationId?: unknown;
}): string | null {
  if (token.isRoot === true && typeof token.actingAsOrganizationId === "string" && token.actingAsOrganizationId) {
    return token.actingAsOrganizationId;
  }
  if (typeof token.activeOrganizationId === "string" && token.activeOrganizationId) {
    return token.activeOrganizationId;
  }
  return typeof token.organizationId === "string" && token.organizationId ? token.organizationId : null;
}

function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/** Что открыто сессии мастер-кабинета. */
const DIRECTORY_ALLOWED_PREFIXES = [
  "/master",
  "/api/master",
  "/api/auth",
  "/api/me/active-organization",
  // Проверка новой сборки (sw-register, build-version-watcher в корневом layout).
  "/api/build-info",
  "/login",
  "/invite",
  "/_next",
] as const;

/** Статика: файл с расширением в последнем сегменте (иконки, шрифты, картинки). */
function isStaticAsset(pathname: string): boolean {
  const last = pathname.slice(pathname.lastIndexOf("/") + 1);
  return /\.[a-z0-9]{1,8}$/i.test(last);
}

export type DirectoryVerdict =
  | { action: "allow" }
  | { action: "redirect"; location: "/master" | "/dashboard" }
  | { action: "deny"; status: 403; error: string };

/**
 * Решение для запроса по признаку организации сессии.
 *   directory: белый список, страницы → /master, API → 403;
 *   иначе: `/master*` → /dashboard, `/api/master/*` → 403.
 */
export function evaluateDirectoryRequest(pathname: string, orgKind: unknown): DirectoryVerdict {
  const kind = parseOrgKind(orgKind);
  const isApi = matchesPrefix(pathname, "/api");
  if (kind === "directory") {
    if (DIRECTORY_ALLOWED_PREFIXES.some((prefix) => matchesPrefix(pathname, prefix))) return { action: "allow" };
    if (!isApi && isStaticAsset(pathname)) return { action: "allow" };
    return isApi
      ? { action: "deny", status: 403, error: DIRECTORY_ONLY_API_ERROR }
      : { action: "redirect", location: "/master" };
  }
  if (matchesPrefix(pathname, "/api/master")) {
    return { action: "deny", status: 403, error: DIRECTORY_ONLY_API_ERROR };
  }
  if (matchesPrefix(pathname, "/master")) return { action: "redirect", location: "/dashboard" };
  return { action: "allow" };
}
