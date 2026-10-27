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

/**
 * Разделы, куда `proxy.ts` не пускает линейного сотрудника (кроме
 * разрешённых `STAFF_WEB_ALLOWED_PREFIXES`). Лежит здесь, а не в proxy:
 * тот же список читает меню (`lib/app-nav.ts`) — пункт, ведущий на
 * редирект, показывать нельзя.
 */
export const STAFF_RESTRICTED_WEB_PREFIXES = [
  "/dashboard",
  "/settings",
  "/reports",
  "/plans",
  "/changes",
  "/losses",
  "/batches",
  "/competencies",
  "/capa",
  "/sanpin",
  "/more",
  "/production-control",
  "/home",
  "/monitoring",
] as const;

export function isStaffRestrictedWebPath(pathname: string): boolean {
  const normalized = normalizePathname(pathname);
  return STAFF_RESTRICTED_WEB_PREFIXES.some((prefix) =>
    matchesPrefix(normalized, prefix)
  );
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
  // Главная руководства — `/home` (эскиз 2026-10-28); тем, у кого нет
  // `admin.full` (заведующая), она сама отдаёт «Сегодня» / панель контроля.
  return hasFullWorkspaceAccess(actor) ? "/home" : "/journals";
}

export function getBotMiniAppLabel(actor: RoleAccessActor): string {
  return hasFullWorkspaceAccess(actor)
    ? "Открыть кабинет"
    : "Открыть журналы";
}
