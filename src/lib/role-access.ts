import { isManagementRole } from "@/lib/user-roles";

export type RoleAccessActor = {
  role?: string | null;
  isRoot?: boolean | null;
};

// «Баланс и бонусы» открыт линейному сотруднику намеренно: отзыв за
// баллы пишет и повар, и ему важно видеть, сколько за это начислят.
// Сам баланс организации внутри страницы виден только `admin.full`.
const STAFF_WEB_ALLOWED_PREFIXES = ["/journals", "/settings/balance"] as const;

function normalizePathname(pathname: string): string {
  if (!pathname) return "/";
  if (pathname === "/") return pathname;
  return pathname.replace(/\/+$/, "") || "/";
}

function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function hasFullWorkspaceAccess(actor: RoleAccessActor): boolean {
  return actor.isRoot === true || isManagementRole(actor.role);
}

export function canAccessWebPath(
  actor: RoleAccessActor,
  pathname: string
): boolean {
  if (hasFullWorkspaceAccess(actor)) return true;
  const normalized = normalizePathname(pathname);
  return STAFF_WEB_ALLOWED_PREFIXES.some((prefix) =>
    matchesPrefix(normalized, prefix)
  );
}

/**
 * Домашний адрес кабинета. Он же «корень» мини-приложения: собственных
 * экранов-дублей у приложения больше нет — оно показывает страницы
 * сайта в своей оболочке (П-3).
 */
export function getWebHomeHref(actor: RoleAccessActor): string {
  return hasFullWorkspaceAccess(actor) ? "/dashboard" : "/journals";
}

export function getBotMiniAppLabel(actor: RoleAccessActor): string {
  return hasFullWorkspaceAccess(actor)
    ? "Открыть кабинет"
    : "Открыть журналы";
}
