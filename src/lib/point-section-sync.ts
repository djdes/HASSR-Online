import { sectionForPath, type NavSectionKey } from "@/lib/app-nav";
import { HOME_HREF } from "@/lib/home-page";

/**
 * Точка в шапке и открытый раздел — согласованы (владелец, 2026-11-10):
 * раздел про всю компанию ⇒ в шапке офис («Вся организация»); страница
 * точки ⇒ в шапке эта точка; выбрали точку в шапке ⇒ открывается раздел,
 * который у точки есть. Модуль без React и Prisma: решения принимают
 * `PointSectionSync` и переключатель, проверяют тесты.
 */

/** Разделы про всю компанию: реквизиты, мастер-кабинет, офис, подписки, оформление. */
export const COMPANY_WIDE_SECTIONS: ReadonlySet<NavSectionKey> = new Set(["company", "office", "billing", "settings"]);

/**
 * Страницы всей организации вне этих разделов: список всех точек, «Все
 * журналы» и «Журналы точек» (в режиме точки они закрыты).
 */
const COMPANY_WIDE_PAGES: ReadonlySet<string> = new Set(["/settings/buildings", "/journals", "/journals/points"]);

const POINTS_LIST_HREF = "/settings/buildings";
const POINT_PAGE = /^\/settings\/buildings\/([^/]+)$/;

export function normalizePath(pathname: string | null | undefined): string {
  return (pathname || "/").split(/[?#]/)[0].replace(/(.)\/+$/, "$1");
}

/** Страница про всю компанию: выбор торговой точки на ней не имеет смысла. */
export function isCompanyWidePath(pathname: string | null | undefined): boolean {
  const path = normalizePath(pathname);
  if (path === HOME_HREF) return false;
  if (COMPANY_WIDE_PAGES.has(path)) return true;
  const owner = sectionForPath(path);
  return owner !== null && COMPANY_WIDE_SECTIONS.has(owner.section);
}

/** Id точки, если это её страница (`/settings/buildings/<id>`); мастер новой точки — нет. */
export function pointPageId(pathname: string | null | undefined): string | null {
  const id = POINT_PAGE.exec(normalizePath(pathname))?.[1] ?? null;
  return id && id !== "new" ? id : null;
}

export type PointSyncState = {
  pathname: string | null | undefined;
  /** Торговая точка, выбранная в шапке; null — офис или «Вся организация». */
  viewedPointId: string | null;
  /** Руководство на всю компанию: ему доступны офис / «Вся организация». */
  canViewOrganization: boolean;
  /** Куда переключать «на всю компанию»: id офиса или «Вся организация». */
  organizationTargetId: string | null;
  /** Торговые точки, которые человек может выбрать в шапке. */
  pointIds: readonly string[];
};

export type PointSyncAction =
  /** Раздел всей компании, а выбрана торговая точка — переключить на офис. */
  | { kind: "organization"; targetId: string }
  /** Открыта страница точки, а в шапке другое — переключить на неё. */
  | { kind: "point"; targetId: string };

/** Что шапка должна сделать сама, открыв эту страницу; null — ничего. */
export function pointSyncAction(state: PointSyncState): PointSyncAction | null {
  const pageId = pointPageId(state.pathname);
  if (pageId) {
    return pageId !== state.viewedPointId && state.pointIds.includes(pageId) ? { kind: "point", targetId: pageId } : null;
  }
  if (
    isCompanyWidePath(state.pathname) &&
    state.viewedPointId !== null &&
    state.canViewOrganization &&
    state.organizationTargetId
  ) {
    return { kind: "organization", targetId: state.organizationTargetId };
  }
  return null;
}

/**
 * Куда перейти после выбора в переключателе; null — остаться на странице
 * (она перерисуется для новой точки).
 *   • выбрали торговую точку на главной, в разделе компании или на странице
 *     другой точки — её страница (без права на «Точки» — «Сегодня»);
 *   • выбрали офис / всю организацию на странице точки — список точек.
 */
export function hrefAfterPointSwitch(input: {
  pathname: string | null | undefined;
  target: { id: string; office: boolean };
  /** Есть доступ к страницам точек (`/settings/buildings`). */
  canManagePoints: boolean;
}): string | null {
  const path = normalizePath(input.pathname);
  const pageId = pointPageId(path);
  if (input.target.office) return pageId ? (input.canManagePoints ? POINTS_LIST_HREF : "/dashboard") : null;
  if (pageId === input.target.id) return null;
  if (pageId || path === HOME_HREF || isCompanyWidePath(path)) {
    return input.canManagePoints ? `${POINTS_LIST_HREF}/${input.target.id}` : "/dashboard";
  }
  return null;
}
