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

/**
 * Вкладки со своим фильтром по местам над списком (`PlaceFilterChips`,
 * `?place=`). С 2026-11-11 (владелец: «зашёл в сотрудники — выбор сверху
 * пропал, не понимаю, где я») переключатель в шапке на них виден, а фильтр с
 * ним согласован: без `?place=` список — по точке из шапки, выбор точки в
 * фильтре переключает и шапку. «Журналы точек» — страница всей организации:
 * там шапка стоит на офисе, а фильтр — сам по себе.
 */
export const PLACE_FILTER_PATHS: ReadonlySet<string> = new Set(["/settings/users", "/settings/areas", "/settings/equipment"]);

/** Значение `place`, которое означает «все места». */
const PLACE_ALL = "all";
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
  /** `?place=` вкладки с фильтром по местам (`PLACE_FILTER_PATHS`); null — нет. */
  placeParam?: string | null;
};

export type PointSyncAction =
  /** Раздел всей компании, а выбрана торговая точка — переключить на офис. */
  | { kind: "organization"; targetId: string }
  /** Открыта страница точки, а в шапке другое — переключить на неё. */
  | { kind: "point"; targetId: string }
  /** В фильтре мест выбрана точка (или «Все»), а в шапке другое — шапку за ним. */
  | { kind: "place"; targetId: string };

/** Что шапка должна сделать сама, открыв эту страницу; null — ничего. */
export function pointSyncAction(state: PointSyncState): PointSyncAction | null {
  const pageId = pointPageId(state.pathname);
  if (pageId) {
    return pageId !== state.viewedPointId && state.pointIds.includes(pageId) ? { kind: "point", targetId: pageId } : null;
  }
  const place = state.placeParam ?? null;
  if (place && PLACE_FILTER_PATHS.has(normalizePath(state.pathname))) {
    if (state.pointIds.includes(place)) {
      return place !== state.viewedPointId ? { kind: "place", targetId: place } : null;
    }
    // «Все» или офис в фильтре — в шапке вся организация.
    const wholeOrganization = place === PLACE_ALL || place === state.organizationTargetId;
    if (wholeOrganization && state.viewedPointId !== null && state.canViewOrganization && state.organizationTargetId) {
      return { kind: "place", targetId: state.organizationTargetId };
    }
    return null;
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
  /** В адресе выбран фильтр мест (`?place=`). */
  hasPlaceParam?: boolean;
}): string | null {
  const path = normalizePath(input.pathname);
  const pageId = pointPageId(path);
  // Вкладка с фильтром мест: выбор в шапке сбрасывает `?place=` — список
  // встаёт на выбранную точку, а фильтр не тянет шапку обратно.
  if (input.hasPlaceParam && PLACE_FILTER_PATHS.has(path)) return path;
  if (input.target.office) return pageId ? (input.canManagePoints ? POINTS_LIST_HREF : "/dashboard") : null;
  if (pageId === input.target.id) return null;
  if (pageId || path === HOME_HREF || isCompanyWidePath(path)) {
    return input.canManagePoints ? `${POINTS_LIST_HREF}/${input.target.id}` : "/dashboard";
  }
  return null;
}

/**
 * «Назад» после автосмены на офис (2026-11-11): человек с точки зашёл в раздел
 * всей компании — выбор стал офисом, — и вернулся назад (стрелка страницы или
 * кнопка браузера). Возвращаем и точку, с которой он пришёл: иначе «назад»
 * приводит на ту же страницу, но уже про всю организацию. Только по истории:
 * переход по меню дальше — осознанный, точку не трогаем.
 */
export function pointReturnTarget(input: {
  pathname: string | null | undefined;
  /** Торговая точка в шапке сейчас; null — офис / вся организация. */
  viewedPointId: string | null;
  /** Точка, с которой человека увела автосмена; null — возвращать нечего. */
  returnPointId: string | null;
  /** Страница открыта переходом по истории («назад» / «вперёд»). */
  viaHistory: boolean;
  pointIds: readonly string[];
}): string | null {
  if (!input.viaHistory || !input.returnPointId || input.viewedPointId !== null) return null;
  if (!input.pointIds.includes(input.returnPointId)) return null;
  if (isCompanyWidePath(input.pathname) || pointPageId(input.pathname)) return null;
  return input.returnPointId;
}
