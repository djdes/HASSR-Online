/**
 * Нижнее меню кабинета на телефоне и планшете (владелец, 2026-11-23: «Домой»,
 * «Журналы», «Контакты», «Настройки» — плавающими, как в Telegram). Модуль без
 * React: какие вкладки видны и какая выбрана; рисует `mobile-tab-bar.tsx`.
 *
 *   • «Домой» — домашняя по роли (`getWebHomeHref`: руководству — главная,
 *     остальным — журналы);
 *   • «Журналы» — список журналов, если он человеку открыт (пункт «Все
 *     журналы» в его меню), иначе корень раздела журналов; вкладки нет, когда
 *     журналы и есть домашняя или раздела нет;
 *   • «Контакты» — действие (лист «Контакты и помощь»), выбранной не бывает;
 *   • «Настройки» — действие (лист меню кабинета); выбрана на остальных
 *     страницах кабинета: в них ведёт меню.
 */

import { sectionForPath } from "@/lib/app-nav";

export type MobileTabId = "home" | "journals" | "contacts" | "settings";

export type MobileTab =
  | { id: "home" | "journals"; kind: "link"; href: string }
  | { id: "contacts" | "settings"; kind: "action" };

type JournalsSection = {
  key: string;
  rootHref: string;
  menu?: ReadonlyArray<{ items: ReadonlyArray<{ id: string; href: string; section?: string }> }>;
};

/** Куда ведут «Журналы»: «Все журналы», если пункт виден, иначе корень раздела. */
export function journalsTabHref(sections: readonly JournalsSection[]): string | null {
  const journals = sections.find((section) => section.key === "journals");
  if (!journals) return null;
  const all = journals.menu?.flatMap((group) => group.items).find((item) => item.id === "all" && !item.section);
  return all?.href ?? journals.rootHref;
}

function cleanPath(pathname: string): string {
  const path = (pathname || "/").split(/[?#]/)[0];
  return path.length > 1 ? path.replace(/\/+$/, "") : path;
}

const under = (path: string, href: string) => path === href || path.startsWith(`${href}/`);

/** Вкладки по порядку: «Домой», «Журналы» (если есть), «Контакты», «Настройки». */
export function mobileTabs({ homeHref, journalsHref }: { homeHref: string; journalsHref: string | null }): MobileTab[] {
  const tabs: MobileTab[] = [{ id: "home", kind: "link", href: homeHref }];
  if (journalsHref && cleanPath(journalsHref) !== cleanPath(homeHref)) {
    tabs.push({ id: "journals", kind: "link", href: journalsHref });
  }
  tabs.push({ id: "contacts", kind: "action" }, { id: "settings", kind: "action" });
  return tabs;
}

/** Какая вкладка выбрана на этой странице. */
export function activeMobileTab(tabs: readonly MobileTab[], pathname: string): MobileTabId {
  const path = cleanPath(pathname);
  const home = tabs.find((tab) => tab.id === "home");
  if (home && home.kind === "link" && under(path, cleanPath(home.href))) return "home";
  const journals = tabs.find((tab) => tab.id === "journals");
  if (journals && journals.kind === "link") {
    if (under(path, "/journals") || under(path, cleanPath(journals.href)) || sectionForPath(path)?.section === "journals") {
      return "journals";
    }
  }
  return "settings";
}
