/**
 * Адреса-окна: страница, которая с другой страницы раздела открывается окном
 * поверх неё (перехват маршрута Next.js, слот `@modal`), а по прямой ссылке —
 * отдельной страницей. Пока окно открыто, адрес — адрес окна, а под ним всё та
 * же базовая страница: оболочка кабинета (вкладки, «‹ назад», проявление
 * страницы) должна вести себя так, будто адрес не менялся.
 *
 * Пункты структуры ППК (2026-11-24): `/production-control/item/<id>` поверх
 * обзора `/production-control`.
 */
const ROUTE_OVERLAYS: readonly { prefix: string; base: string }[] = [
  { prefix: "/production-control/item/", base: "/production-control" },
];

/** Базовая страница адреса-окна; обычный адрес — null. */
export function routeOverlayBase(pathname: string | null | undefined): string | null {
  if (!pathname) return null;
  return ROUTE_OVERLAYS.find((overlay) => pathname.startsWith(overlay.prefix))?.base ?? null;
}
