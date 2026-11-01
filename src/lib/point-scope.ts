/**
 * Руководитель точки (фаза 2 «Офис и точки», 2026-10-27): человек,
 * закреплённый только за частью торговых точек организации — с офисом или
 * без него (с 2026-11-01) (`pointScopeForUser` в building-scope.ts). Он ведёт свои точки и их людей,
 * а общее на всю компанию — реквизиты, оплата, должности, права, общие
 * настройки журналов, подключения — дело офиса.
 *
 * `pointScope` (id его точек) сессия считает на каждый запрос, а в токен
 * он кладётся при входе (`point-scope.server.ts`). Proxy по токену
 * закрывает общие страницы и изменения через их API, меню (`navAllows`)
 * прячет те же адреса, страницы и API сотрудников и точек режут данные по
 * точкам. Модуль без Prisma — его читают proxy, меню и тесты. Дизайн: docs/superpowers/specs/2026-10-26-office-and-points-design.md
 */

export type PointScopeActor = { pointScope?: readonly string[] | null };

export const COMPANY_ONLY_API_ERROR = "Это общие настройки компании — их меняет руководство компании";
export const STAFF_OUT_OF_SCOPE_ERROR = "Этот сотрудник работает не на вашей точке — его ведёт руководство компании";
export const BUILDING_OUT_OF_SCOPE_ERROR = "Это не ваша точка — её ведёт руководство компании";

export function isPointScoped(actor: PointScopeActor | null | undefined): boolean {
  return Array.isArray(actor?.pointScope) && actor.pointScope.length > 0;
}

/** `pointScope` из токена: массив непустых строк или null. */
export function parsePointScope(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const ids = value.filter((id): id is string => typeof id === "string" && id.length > 0);
  return ids.length > 0 ? ids : null;
}

/** Страницы на всю компанию — руководителю точки закрыты. */
export const COMPANY_ONLY_PAGE_PREFIXES = [
  // «Моя компания»: реквизиты, офис, документы, бренд, контакты, названия, быстрая настройка.
  "/settings/organization",
  // Мастер-кабинет: подключает точки всей компании и приглашает операторов.
  "/settings/master-cabinet",
  "/settings/names",
  "/settings/onboarding",
  "/settings/onboarding-template",
  "/settings/appearance",
  // «Оплата»: тариф и услуги (личные баллы — «Баланс» — остаются).
  "/settings/subscription",
  "/settings/services",
  // Справочники и права на всю компанию.
  "/settings/positions",
  "/settings/access",
  "/settings/permissions",
  "/settings/role-presets",
  "/settings/journal-access",
  "/settings/journals-by-position",
  "/settings/staff-hierarchy",
  "/settings/position-staff-visibility",
  "/settings/control-group",
  "/settings/haccp-group",
  // «Ответственные за журналы» открыты (2026-10-31): руководитель точки
  // назначает ответственных своей точки, общие — офис.
  "/settings/workload-balance",
  "/settings/products",
  // Новая точка — решение компании.
  "/settings/buildings/new",
  // Общие настройки журналов (набор, автоматика и комиссия — по точке, открыты).
  "/settings/journal-periods",
  "/settings/compliance",
  "/settings/journal-pipelines",
  "/settings/journal-pipelines-tree",
  "/settings/journal-guides-tree",
  "/settings/journal-checklists",
  "/settings/journal-task-mode",
  "/settings/journal-flow",
  "/settings/task-visibility",
  "/settings/journal-difficulty",
  "/settings/journal-bonuses",
  // Подключения и прочее на всю компанию.
  "/settings/integrations",
  // «Портал инспектора» открыт (2026-11-01): ссылка проверяющего — на точку,
  // руководитель точки выпускает и отзывает ссылки своей точки.
  "/settings/webhooks",
  "/settings/calendar",
  "/settings/backup",
  "/settings/accounting",
  "/settings/api",
  "/settings/audit",
  "/settings/experimental",
  "/settings/partner",
  "/settings/consultant",
  // Приказы компании (владелец 2026-11-01: «закрытым») — руководству компании.
  "/orders",
] as const;

/** API тех же страниц: изменения (не GET) руководителю точки закрыты. */
export const COMPANY_ONLY_API_PREFIXES = [
  "/api/settings/organization",
  // Публичный бейдж компании — карточка на «Моей компании» (аудит 2026-11-01).
  "/api/settings/badge",
  "/api/settings/master-cabinet",
  "/api/settings/office",
  "/api/settings/custom-names",
  "/api/settings/onboarding",
  "/api/settings/onboarding-template",
  "/api/settings/subscription",
  "/api/settings/positions",
  "/api/settings/role-presets",
  "/api/settings/journal-periods",
  "/api/settings/compliance",
  "/api/settings/journal-pipelines",
  "/api/settings/journal-checklists",
  "/api/settings/journal-task-mode",
  "/api/settings/journal-flow",
  "/api/settings/task-visibility",
  "/api/settings/journal-difficulty",
  // Ответственные: сохранение журнала (`/<code>`) само проверяет точку —
  // руководителю точки можно только по своей; общие действия — офису.
  "/api/settings/journal-responsibles/apply-presets",
  "/api/settings/journal-responsibles/backfill-verifiers",
  "/api/settings/journal-responsibles/recreate-documents",
  "/api/settings/journal-responsibles/resync-all",
  "/api/settings/webhooks",
  "/api/settings/api-keys",
  "/api/settings/external-token",
  "/api/settings/calendar-token",
  "/api/settings/yandex-backup",
  "/api/settings/accountant-email",
  "/api/settings/experimental",
  "/api/settings/partner",
  "/api/settings/consultant",
  "/api/staff/control-group",
  // Приказы и закрывающие документы (УПД) — руководству компании (2026-11-01).
  "/api/orders",
  "/api/closing-documents",
  "/api/manager-scope",
  // Права людей и должностей, справочник продукции, быстрая настройка — на всю компанию.
  "/api/organizations/permissions",
  "/api/products",
  "/api/onboarding/apply",
  // Удалить все документы организации — только офис.
  "/api/settings/journals/delete-all-documents",
  // Подключения (страница /settings/integrations — офиса): ЭДО и iiko, 1С,
  // Меркурий, Max, общие действия TasksFlow.
  "/api/settings/supply",
  "/api/settings/hr1c",
  "/api/integrations/mercury",
  "/api/max/organization",
  "/api/integrations/tasksflow/cleanup-pending",
  "/api/integrations/tasksflow/cleanup-completed",
  "/api/integrations/tasksflow/reset-negative-balances",
  "/api/integrations/tasksflow/sync-users",
  "/api/integrations/tasksflow/sync-hierarchy",
  // `/api/settings/inspector-tokens` открыт (2026-11-01): ссылка проверяющего —
  // на точку, руководителю точки — только своей (проверка в маршруте).
] as const;

/**
 * Ровно эти адреса (без вложенных): подключение и отключение TasksFlow —
 * офису, а задачи точки (`/api/integrations/tasksflow/bulk-assign-today` и
 * др.) руководитель точки отправляет сам.
 */
export const COMPANY_ONLY_API_EXACT = ["/api/integrations/tasksflow"] as const;

/**
 * Только вложенные адреса: должность заводят и при добавлении сотрудника
 * (`POST /api/positions`), а переименовать, удалить и переставить — офис.
 */
export const COMPANY_ONLY_API_CHILDREN = ["/api/positions"] as const;

function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

function normalize(pathname: string): string {
  const clean = (pathname || "/").split(/[?#]/)[0];
  return clean.length > 1 ? clean.replace(/\/+$/, "") : clean;
}

/** Страница на всю компанию (руководителю точки закрыта). */
export function isCompanyOnlyPath(pathname: string): boolean {
  const path = normalize(pathname);
  return COMPANY_ONLY_PAGE_PREFIXES.some((prefix) => matchesPrefix(path, prefix));
}

export type PointScopeVerdict =
  | { action: "allow" }
  | { action: "redirect"; location: "/dashboard" }
  | { action: "deny"; status: 403; error: string };

/** Решение proxy: общие страницы → «Сегодня», изменения через их API → 403. */
export function evaluatePointScopeRequest(args: {
  method: string;
  pathname: string;
  pointScope: unknown;
}): PointScopeVerdict {
  if (!parsePointScope(args.pointScope)) return { action: "allow" };
  const path = normalize(args.pathname);
  if (matchesPrefix(path, "/api")) {
    const method = args.method.toUpperCase();
    if (method === "GET" || method === "HEAD" || method === "OPTIONS") return { action: "allow" };
    const companyOnly =
      COMPANY_ONLY_API_PREFIXES.some((prefix) => matchesPrefix(path, prefix)) ||
      COMPANY_ONLY_API_EXACT.some((exact) => path === exact) ||
      COMPANY_ONLY_API_CHILDREN.some((parent) => path.startsWith(`${parent}/`));
    return companyOnly ? { action: "deny", status: 403, error: COMPANY_ONLY_API_ERROR } : { action: "allow" };
  }
  return isCompanyOnlyPath(path) ? { action: "redirect", location: "/dashboard" } : { action: "allow" };
}

/** Точка в пределах человека (без ограничения — любая). */
export function buildingInScope(actor: PointScopeActor | null | undefined, buildingId: string | null | undefined): boolean {
  if (!isPointScoped(actor)) return true;
  return Boolean(buildingId) && actor!.pointScope!.includes(buildingId!);
}

/** Сотрудник в пределах: работает хотя бы на одной из точек руководителя. */
export function staffInScope(actor: PointScopeActor | null | undefined, userBuildingIds: readonly string[] | null | undefined): boolean {
  if (!isPointScoped(actor)) return true;
  return (userBuildingIds ?? []).some((id) => actor!.pointScope!.includes(id));
}

/** То же условие для `db.user.findMany` (без ограничения — пустое). */
export function staffScopeWhere(actor: PointScopeActor | null | undefined): { buildingIds?: { hasSome: string[] } } {
  return isPointScoped(actor) ? { buildingIds: { hasSome: [...actor!.pointScope!] } } : {};
}

/**
 * Места сотрудника после правки руководителем точки: чужие точки человека не
 * трогаем, свои — как выбрал руководитель; пусто — все точки руководителя
 * (сотрудник «без места» работал бы на всех точках компании). Без
 * ограничения — как прислали.
 */
export function mergeScopedBuildingIds(
  actor: PointScopeActor | null | undefined,
  existing: readonly string[],
  requested: readonly string[],
): string[] {
  if (!isPointScoped(actor)) return [...requested];
  const scope = actor!.pointScope!;
  const foreign = existing.filter((id) => !scope.includes(id));
  const mine = requested.filter((id, index) => scope.includes(id) && requested.indexOf(id) === index);
  const result = [...foreign, ...mine];
  return result.length > 0 ? result : [...scope];
}
