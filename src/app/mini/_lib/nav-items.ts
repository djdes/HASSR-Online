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
 * сайта. Единственное, что решает эта функция, — какие четыре кнопки
 * видно и какая из них подсвечена.
 */

import { getWebHomeHref, hasFullWorkspaceAccess } from "@/lib/role-access";

export type MiniNavActor = {
  role?: string | null;
  isRoot?: boolean | null;
};

/** Имя иконки lucide. Компоненты через границу RSC не передаются. */
export type MiniNavIcon = "Home" | "ClipboardList" | "LayoutGrid" | "UserRound";

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

/**
 * Что видно в нижнем меню.
 *
 * Руководство: «Главная» (`/dashboard`) + «Журналы» + «Разделы» +
 * «Профиль». Линейный сотрудник: у него домашний адрес — это и есть
 * список журналов, поэтому первая кнопка называется «Журналы» и второй
 * такой же кнопки не будет.
 */
export function miniNavItems(actor: MiniNavActor | null): MiniNavItem[] {
  const full = actor ? hasFullWorkspaceAccess(actor) : false;
  const home = getWebHomeHref(actor ?? {});

  if (!full) {
    return [{ href: home, label: "Журналы", icon: "Home" }, SECTIONS_ITEM, PROFILE_ITEM];
  }

  return [
    { href: home, label: "Главная", icon: "Home" },
    { href: "/journals", label: "Журналы", icon: "ClipboardList" },
    SECTIONS_ITEM,
    PROFILE_ITEM,
  ];
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
 * Отдельно учитываем два адреса, которые и есть «дом» по факту:
 *   • `/mini` — экран входа, после него человека уносит домой;
 *   • `/mini/today` — сюда сайт сам отправляет с `/journals` и
 *     `/dashboard` тех, кому журналы как журналы не показывают.
 * Без этого у повара на его же домашнем экране не подсвечено ничего.
 */
const HOME_ALIASES = ["/mini", "/mini/today", "/control-board"] as const;

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
  return best;
}
