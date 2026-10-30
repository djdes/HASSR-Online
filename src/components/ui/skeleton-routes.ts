/**
 * Какой скелетон показывать, пока грузится страница, — по адресу.
 *
 * `loading.tsx` раздела — граница загрузки для ВСЕХ его подстраниц (своих
 * у них нет). Без выбора по адресу подстраница показывала раскладку главной
 * страницы раздела, а потом «перепрыгивала» в свою: «Сотрудники» и «Баланс»
 * грузились под тёмным баннером хаба настроек, документ журнала — под сеткой
 * каталога журналов, «Догнать пропущенное» — под скелетом дашборда.
 *
 * Модуль без React: его читают `loading.tsx` разделов и тест
 * (`skeleton-routes.test.ts`).
 */

/** Адрес без хвостового слэша; `null` — адрес неизвестен. */
function normalize(pathname: string | null | undefined): string | null {
  if (!pathname) return null;
  return pathname.replace(/\/+$/, "") || "/";
}

/**
 * Открывается сама главная страница раздела (`root`), а не подстраница.
 * Адрес неизвестен — считаем, что главная: у неё и был этот скелет.
 */
export function isSectionRoot(pathname: string | null | undefined, root: string): boolean {
  const path = normalize(pathname);
  return path === null || path === root;
}

export type JournalsSkeleton = "catalog" | "documents" | "document" | "page";

/**
 * Раздел журналов:
 *   `/journals`                              — каталог журналов;
 *   `/journals/<код>`                        — список документов журнала;
 *   `/journals/<код>/documents/<id>`         — документ (сетка);
 *   всё остальное (новая запись, инструкция, справка, запись, проверка
 *   документа, прослеживаемость) — общий скелет страницы.
 */
export function journalsSkeletonFor(pathname: string | null | undefined): JournalsSkeleton {
  const path = normalize(pathname);
  if (path === null) return "catalog";
  const parts = path.split("/").filter(Boolean);
  if (parts[0] !== "journals" || parts.length === 1) return "catalog";
  if (parts[1] === "traceability") return "page";
  if (parts.length === 2) return "documents";
  if (parts[2] === "documents" && parts.length === 4) return "document";
  return "page";
}

export type GenericSkeletonBody = "cards" | "list" | "table" | "panel";

/**
 * Тело общего скелета (`PageSkeleton`) для разделов без своего клиентского
 * `loading.tsx` — по тому, что на странице: таблица, список, панель-форма или
 * карточки (по умолчанию). Партии и потери — как их серверные `loading.tsx`.
 */
const GENERIC_BODIES: Record<string, GenericSkeletonBody> = {
  acknowledge: "list",
  batches: "table",
  capa: "list",
  changes: "list",
  competencies: "table",
  ideas: "list",
  losses: "table",
  mercury: "panel",
  orders: "list",
  plans: "list",
  staff: "list",
  translations: "table",
};

export type RouteSkeletonChoice =
  | { kind: "section"; section: string }
  | { kind: "generic"; body: GenericSkeletonBody };

/**
 * Какой скелет показать по адресу (2026-10-29): раздел со своим скелетом
 * (`sectionsWithOwn` — первый сегмент пути) — его; остальным — общий
 * `PageSkeleton` с подходящим телом. Так корневой `(dashboard)/loading.tsx`
 * и ожидание после смены точки рисуют то же, что свой скелет раздела.
 */
export function routeSkeletonFor(
  pathname: string | null | undefined,
  sectionsWithOwn: readonly string[],
): RouteSkeletonChoice {
  const first = normalize(pathname)?.split("/").filter(Boolean)[0] ?? "";
  if (first && sectionsWithOwn.includes(first)) return { kind: "section", section: first };
  return { kind: "generic", body: GENERIC_BODIES[first] ?? "cards" };
}
