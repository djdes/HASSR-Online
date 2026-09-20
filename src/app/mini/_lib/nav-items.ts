/**
 * Вкладки нижнего меню мини-приложения.
 *
 * Набор строго тот же, что на сайте: у приложения больше нет
 * собственных экранов-дублей — оно показывает страницы кабинета в
 * своей оболочке (П-3). Поэтому «Персонал», «Техника», «Отчёты»,
 * «Действия», «Датчики» и «Смены» из меню убраны: это разделы сайта,
 * и попадают в них через «Разделы».
 *
 * Права здесь ничего не разрешают — доступ проверяет сама страница
 * сайта. Но кнопка обязана вести туда, где человек и окажется: пункт,
 * после которого его перекидывает на другой адрес, — это обман. Поэтому
 * и домашний адрес, и наличие вкладки «Журналы» считаются по тем же
 * проверкам, что стоят на самих страницах.
 */

import { hasCapability } from "@/lib/permission-presets";
import { hasFullWorkspaceAccess } from "@/lib/role-access";

export type MiniNavActor = {
  role?: string | null;
  isRoot?: boolean | null;
  /** Пресет прав — тот же, что в сессии (`session.user`). */
  permissionPreset?: string | null;
  orgPresetOverrides?: Record<string, string[]> | null;
};

/** Имя иконки lucide. Компоненты через границу RSC не передаются. */
export type MiniNavIcon =
  | "Home"
  | "ClipboardList"
  | "LayoutGrid"
  | "UserRound"
  | "CalendarCheck";

export type MiniNavItem = {
  href: string;
  label: string;
  icon: MiniNavIcon;
};

const SECTIONS_ITEM: MiniNavItem = {
  href: "/mini/sections",
  label: "Разделы",
  icon: "LayoutGrid",
};

const PROFILE_ITEM: MiniNavItem = {
  href: "/mini/me",
  label: "Профиль",
  icon: "UserRound",
};

/** Видит ли человек список журналов как список журналов. */
function canOpenJournals(actor: MiniNavActor | null): boolean {
  return actor ? hasCapability(actor, "journals.view") : false;
}

/**
 * Домашняя вкладка — ровно тот адрес, который откроется.
 *
 * Повторяет цепочку редиректов самих страниц (`/dashboard/page.tsx` и
 * `/journals/page.tsx`):
 *   • руководство с журналами → «Главная», дашборд;
 *   • заведующая (проверяет задачи, журналов не видит) → «Главная»,
 *     контрольная доска — сразу, без прыжка через `/journals`;
 *   • линейный сотрудник → «Сегодня», список задач смены.
 */
export function miniHomeItem(actor: MiniNavActor | null): MiniNavItem {
  if (actor && canOpenJournals(actor)) {
    return hasFullWorkspaceAccess(actor)
      ? { href: "/dashboard", label: "Главная", icon: "Home" }
      : { href: "/journals", label: "Журналы", icon: "ClipboardList" };
  }
  if (actor && hasCapability(actor, "tasks.verify")) {
    return { href: "/control-board", label: "Главная", icon: "Home" };
  }
  return { href: "/mini/today", label: "Сегодня", icon: "CalendarCheck" };
}

/** Домашний адрес приложения — он же «корень» для кнопки «назад». */
export function miniHomeHref(actor: MiniNavActor | null): string {
  return miniHomeItem(actor).href;
}

/**
 * Что видно в нижнем меню.
 *
 * Вкладка «Журналы» — только у тех, у кого список журналов и правда
 * открывается (`journals.view`). У заведующей и линейного сотрудника её
 * нет: страница их всё равно уводила бы прочь.
 */
export function miniNavItems(actor: MiniNavActor | null): MiniNavItem[] {
  const home = miniHomeItem(actor);
  const items: MiniNavItem[] = [home];

  if (canOpenJournals(actor) && home.href !== "/journals") {
    items.push({ href: "/journals", label: "Журналы", icon: "ClipboardList" });
  }

  items.push(SECTIONS_ITEM, PROFILE_ITEM);
  return items;
}

function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/**
 * Какая вкладка подсвечена.
 *
 * Подсветка обязана работать и на страницах сайта (`/journals/hygiene`,
 * `/dashboard/...`): в оболочке они и есть содержимое приложения.
 * Берём самое длинное совпадение, иначе «Главная» на `/dashboard`
 * перебивала бы «Журналы» на `/journals`.
 *
 * `/mini` — экран входа, после него человека уносит домой, поэтому он
 * тоже подсвечивает домашнюю вкладку.
 *
 * Всё остальное — `/settings/*`, `/team`, `/verifications`, `/reports`,
 * `/batches`, `/capa` и прочее — это страницы, куда ведут «Разделы».
 * Раньше на них не было подсвечено ничего, и человек не понимал, где
 * он и как вернуться. Теперь подсвечены «Разделы».
 */
const HOME_ALIASES = ["/mini"] as const;

export function activeMiniNavHref(
  items: readonly MiniNavItem[],
  pathname: string
): string | null {
  const normalized = pathname.replace(/\/+$/, "") || "/";
  const home = items[0]?.href ?? null;
  if (HOME_ALIASES.some((alias) => alias === normalized)) return home;

  let best: string | null = null;
  for (const item of items) {
    if (!matchesPrefix(normalized, item.href)) continue;
    if (best === null || item.href.length > best.length) best = item.href;
  }
  if (best !== null) return best;

  // Ничего своего не совпало — значит это страница из «Разделов».
  return items.find((item) => item.href === SECTIONS_ITEM.href)?.href ?? null;
}
