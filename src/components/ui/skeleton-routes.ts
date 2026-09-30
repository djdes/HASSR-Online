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
