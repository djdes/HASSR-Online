/**
 * Шаблон меню «Новый» (владелец, 2026-11-09): слева только два уровня —
 * разделы главного меню и раскрывающийся под разделом список его пунктов;
 * всё, что глубже, — строка над страницей с выпадающим подменю; над
 * страницей — хлебные крошки.
 *
 * Это другое представление той же модели меню (`NavModel`): дерево, права и
 * адреса не меняются. Здесь — один расчёт «где человек» для сайдбара, строки
 * над страницей и крошек, чтобы они не разошлись.
 *
 * Модуль без React: его берут клиентские компоненты и тесты.
 */

import { navSectionPath, sectionForPath, type NavSectionKey } from "@/lib/app-nav";
import type { NavModelMenuItem, NavModelSection, NavModelTab } from "@/lib/app-nav.server";

export type NewNavLink = { id: string; href: string; label: string; active: boolean };
/** Пункт выпадающей панели; под ним — его вкладки (следующий уровень). */
export type NewNavPanelLink = NewNavLink & { tabs: NewNavLink[] };
export type NewNavPanelGroup = { label: string | null; links: NewNavPanelLink[] };
/** Пункт строки над страницей; `panel` — выпадающее подменю. */
export type NewNavEntry = NewNavLink & { badge?: string; panel?: NewNavPanelGroup[] };
export type NewNavCrumb = { label: string; href: string };

export type NewNav = {
  /** Раздел главного меню, в котором человек находится. */
  top: NavSectionKey | null;
  /** Текущий пункт второго уровня (id пункта меню раздела `top`). */
  secondId: string | null;
  /** Строка над страницей: третий уровень. Пусто — строки нет. */
  entries: NewNavEntry[];
  /** Строка — вкладки обычного пункта второго уровня (а не пункты вложенного раздела). */
  entriesAreTabs: boolean;
  /** Цепочка для крошек: разделы сверху вниз, пункт, вкладка. */
  trail: NewNavCrumb[];
  /** Страница лежит глубже последнего звена цепочки. */
  deep: boolean;
};

const EMPTY: NewNav = { top: null, secondId: null, entries: [], entriesAreTabs: false, trail: [], deep: false };

function cleanPath(pathname: string): string {
  const path = (pathname || "/").split(/[?#]/)[0];
  return path.length > 1 ? path.replace(/\/+$/, "") : path;
}

const menuItems = (section: NavModelSection | undefined): NavModelMenuItem[] =>
  section?.menu?.flatMap((group) => group.items) ?? [];

/** Вкладки пункта — уровень меню, только когда их две и больше. */
const levelTabs = (item: NavModelMenuItem | undefined): NavModelTab[] =>
  item?.tabs && item.tabs.length > 1 ? item.tabs : [];

export function buildNewNav(sections: readonly NavModelSection[], pathname: string): NewNav {
  const owner = sectionForPath(pathname);
  if (!owner) return EMPTY;
  const chain = navSectionPath(sections, owner.section);
  const current = chain.at(-1);
  if (!current) return EMPTY;
  const clean = cleanPath(pathname);

  // Пункт меню текущего раздела и его вкладка, которым принадлежит путь.
  const item = owner.menuItemId
    ? menuItems(current).find((entry) => entry.id === owner.menuItemId && !entry.section)
    : undefined;
  const tabHref = owner.menuTabHref ?? clean;
  const tab = levelTabs(item).find((entry) => entry.href === tabHref);

  const tabLinks = (source: NavModelMenuItem, parentActive: boolean): NewNavLink[] =>
    levelTabs(source).map((entry) => ({
      id: entry.id,
      href: entry.href,
      label: entry.label,
      active: parentActive && entry.href === tabHref,
    }));

  const [top, host] = chain;
  let entries: NewNavEntry[] = [];
  let entriesAreTabs = false;

  if (host) {
    // Второй уровень — вложенный раздел: строка — его пункты.
    entries = menuItems(host).map((entry): NewNavEntry => {
      const base = { id: entry.id, href: entry.href, label: entry.label, ...(entry.badge ? { badge: entry.badge } : {}) };
      if (entry.section) {
        const child = sections.find((section) => section.key === entry.section);
        const active = chain[2]?.key === entry.section;
        if (!child?.menu) return { ...base, active };
        const panel = child.menu.map((group) => ({
          label: group.label,
          links: group.items.map((link): NewNavPanelLink => {
            const linkActive = link.section
              ? chain[3]?.key === link.section
              : active && current.key === child.key && item?.id === link.id;
            return { id: link.id, href: link.href, label: link.label, active: linkActive, tabs: tabLinks(link, linkActive) };
          }),
        }));
        return { ...base, active, panel };
      }
      const active = chain.length === 2 && item?.id === entry.id;
      const tabs = tabLinks(entry, active);
      return tabs.length > 0
        ? { ...base, active, panel: [{ label: null, links: tabs.map((link) => ({ ...link, tabs: [] })) }] }
        : { ...base, active };
    });
  } else if (item && levelTabs(item).length > 0) {
    // Второй уровень — обычный пункт с вкладками: строка — его вкладки.
    entries = tabLinks(item, true);
    entriesAreTabs = true;
  }

  const trail: NewNavCrumb[] = [];
  const push = (label: string, href: string) => {
    // «Журналы › Журналы»: повтор подряд ничего не объясняет.
    if (trail.at(-1)?.label.trim().toLowerCase() === label.trim().toLowerCase()) return;
    trail.push({ label, href });
  };
  for (const section of chain) push(section.label, section.rootHref);
  if (item) push(item.label, item.href);
  if (tab) push(tab.label, tab.href);

  const here = tab?.href ?? item?.href ?? current.rootHref;
  return {
    top: top.key,
    secondId: host ? host.key : (item?.id ?? null),
    entries,
    entriesAreTabs,
    trail,
    deep: cleanPath(here) !== clean,
  };
}

/**
 * Куда ведёт раздел главного меню. «Моя компания» открывает первую строчку
 * своего меню — «Офис» (владелец, 2026-11-11), а не «Реквизиты»; остальные
 * разделы — свой корень.
 */
export function sectionEntryHref(section: {
  key: string;
  rootHref: string;
  menu?: ReadonlyArray<{ items: ReadonlyArray<{ href: string }> }>;
}): string {
  if (section.key !== "company") return section.rootHref;
  return section.menu?.[0]?.items[0]?.href ?? section.rootHref;
}
