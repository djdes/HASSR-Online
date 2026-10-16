/**
 * Меню кабинета — девять разделов слева (решение владельца 2026-10-16,
 * задача ProjectsFlow 3931776f, дизайн
 * `docs/superpowers/specs/2026-10-16-cabinet-sidebar-nav-design.md`).
 *
 * Один список на всё: сайдбар и мобильный лист сайта, вкладки раздела,
 * хлебные крошки, ⌘K и «Разделы» мини-приложения (П-3). Подразделы — не
 * пункты сайдбара, а вкладки над основным окном.
 *
 * Правила доступа новых не вводят: каждая вкладка повторяет guard своей
 * страницы и проверку `proxy.ts`. Пункт, ведущий на редирект, — обман,
 * поэтому `app-nav.test.ts` сверяет правило с текстом самой страницы.
 *
 * Модуль без React: его читают серверные компоненты, клиент и тесты.
 * Иконки — строками (функции через границу RSC не передаются).
 */

import { hasCapability, type Capability } from "@/lib/permission-presets";
import {
  canAccessWebPath,
  hasFullWorkspaceAccess,
  isStaffRestrictedWebPath,
} from "@/lib/role-access";
import { SETTINGS_CARDS, type SettingsCard } from "@/lib/settings-cards";

export type NavSectionKey =
  | "company"
  | "staff"
  | "points"
  | "journals"
  | "checklists"
  | "productionControl"
  | "billing"
  | "more"
  | "inspection";

export type NavActor = {
  role?: string | null;
  isRoot?: boolean | null;
  permissionPreset?: string | null;
  orgPresetOverrides?: Record<string, string[]> | null;
};

/** То, что нельзя вывести из роли: ACL журнала чек-листов и т.п. */
export type NavFacts = {
  checklists: boolean;
  /** Право `settings.permissions` из БД (роль/категория должности). */
  settingsPermissions: boolean;
};

/**
 * Какая проверка стоит на странице.
 *   • `staffPath`    — своей проверки нет, режет только `proxy.ts`;
 *   • `fullAccess`   — `hasFullWorkspaceAccess` (руководство и ROOT);
 *   • `anyOf`        — любая из возможностей пресета;
 *   • `fullAccessOr` — руководство или любая из возможностей;
 *   • `all`          — все правила сразу;
 *   • `fact`         — факт, посчитанный на сервере (`NavFacts`).
 */
export type NavAccess =
  | { kind: "staffPath" }
  | { kind: "fullAccess" }
  | { kind: "anyOf"; capabilities: Capability[] }
  | { kind: "fullAccessOr"; capabilities: Capability[] }
  | { kind: "all"; rules: NavAccess[] }
  | { kind: "fact"; fact: keyof NavFacts };

/** Ключ подписи вкладки: `navigation.shell.tabs.<label>`. */
export type NavTabLabel =
  | "main"
  | "organization"
  | "appearance"
  | "names"
  | "onboarding"
  | "template"
  | "users"
  | "team"
  | "schedule"
  | "health"
  | "setup"
  | "buildings"
  | "areas"
  | "equipment"
  | "qr"
  | "today"
  | "all"
  | "verify"
  | "program"
  | "orders"
  | "knowledge"
  | "sanpin"
  | "plan"
  | "balance"
  | "services"
  | "inspectionDay"
  | "portal"
  | "readiness";

export type NavTab = {
  id: string;
  label: NavTabLabel;
  href: string;
  access: NavAccess;
  /** Другие пути, которые подсвечивают эту вкладку (не корни). */
  match?: string[];
  /** Вкладку не показываем, если видна вкладка с этим id. */
  hideIfVisible?: string;
};

export type NavSection = {
  key: NavSectionKey;
  icon: string;
  /** Проверка раздела целиком — поверх правил вкладок. */
  access?: NavAccess;
  /** Первая видимая вкладка — корень раздела для этого человека. */
  tabs: NavTab[];
  /** Пути раздела без вкладки и карточки (скрытые из меню страницы). */
  hiddenMatch?: string[];
  /** Точные адреса раздела (редиректы, `/settings`). */
  aliases?: string[];
  /** Своё название раздела организации («Настройки → Названия»). */
  renameHref?: "/journals" | "/settings/users";
};

export type VisibleNavTab = { id: string; label: NavTabLabel; href: string };

export type VisibleNavSection = {
  key: NavSectionKey;
  icon: string;
  rootHref: string;
  tabs: VisibleNavTab[];
  renameHref?: NavSection["renameHref"];
};

const STAFF_PATH: NavAccess = { kind: "staffPath" };
const FULL_ACCESS: NavAccess = { kind: "fullAccess" };
const anyOf = (...capabilities: Capability[]): NavAccess => ({ kind: "anyOf", capabilities });
const fullAccessOr = (...capabilities: Capability[]): NavAccess => ({
  kind: "fullAccessOr",
  capabilities,
});
const ADMIN = anyOf("admin.full");

export const NAV_SECTIONS: NavSection[] = [
  {
    key: "company",
    icon: "Building2",
    // Реквизиты, оформление и быстрая настройка просят `admin.full`;
    // одних «Названий» мало, чтобы заводить заведующей целый раздел.
    access: ADMIN,
    aliases: ["/settings"],
    tabs: [
      { id: "organization", label: "organization", href: "/settings/organization", access: ADMIN },
      { id: "appearance", label: "appearance", href: "/settings/appearance", access: ADMIN },
      { id: "names", label: "names", href: "/settings/names", access: FULL_ACCESS },
      {
        id: "onboarding",
        label: "onboarding",
        href: "/settings/onboarding",
        access: ADMIN,
      },
      {
        id: "template",
        label: "template",
        href: "/settings/onboarding-template",
        access: ADMIN,
      },
    ],
  },
  {
    key: "staff",
    icon: "Users",
    access: fullAccessOr("staff.view", "tasks.verify"),
    renameHref: "/settings/users",
    hiddenMatch: ["/staff", "/competencies"],
    tabs: [
      { id: "users", label: "users", href: "/settings/users", access: FULL_ACCESS },
      {
        id: "team",
        label: "team",
        href: "/team",
        access: anyOf("staff.view", "tasks.verify", "admin.full"),
      },
      { id: "schedule", label: "schedule", href: "/settings/schedule", access: FULL_ACCESS },
      { id: "health", label: "health", href: "/settings/staff-health", access: FULL_ACCESS },
      { id: "setup", label: "setup", href: "/settings/sections/staff", access: FULL_ACCESS },
    ],
  },
  {
    key: "points",
    icon: "Store",
    access: FULL_ACCESS,
    tabs: [
      { id: "buildings", label: "buildings", href: "/settings/buildings", access: FULL_ACCESS },
      { id: "areas", label: "areas", href: "/settings/areas", access: STAFF_PATH },
      { id: "equipment", label: "equipment", href: "/settings/equipment", access: STAFF_PATH },
      { id: "qr", label: "qr", href: "/settings/qr-posters", access: FULL_ACCESS },
      { id: "setup", label: "setup", href: "/settings/sections/points", access: FULL_ACCESS },
    ],
  },
  {
    key: "journals",
    icon: "ClipboardList",
    renameHref: "/journals",
    hiddenMatch: ["/journals-progress"],
    tabs: [
      {
        id: "today",
        label: "today",
        href: "/dashboard",
        // `/dashboard` без `journals.view` уводит на панель контроля.
        access: { kind: "all", rules: [anyOf("journals.view"), FULL_ACCESS] },
        match: ["/dashboard/catch-up"],
      },
      {
        // «Сегодня» заведующей — панель контроля: журналов как журналов
        // она не видит. У управляющей вкладка не нужна — есть «Сегодня».
        id: "control",
        label: "today",
        href: "/control-board",
        access: anyOf("tasks.verify", "admin.full"),
        hideIfVisible: "today",
      },
      { id: "all", label: "all", href: "/journals", access: anyOf("journals.view") },
      { id: "verify", label: "verify", href: "/verifications", access: anyOf("tasks.verify") },
      { id: "setup", label: "setup", href: "/settings/sections/journals", access: FULL_ACCESS },
    ],
  },
  {
    key: "checklists",
    icon: "ListChecks",
    tabs: [
      { id: "main", label: "main", href: "/checklists", access: { kind: "fact", fact: "checklists" } },
    ],
  },
  {
    key: "productionControl",
    icon: "FileCheck2",
    access: FULL_ACCESS,
    tabs: [
      { id: "program", label: "program", href: "/production-control", access: FULL_ACCESS },
      { id: "orders", label: "orders", href: "/orders", access: FULL_ACCESS },
      { id: "knowledge", label: "knowledge", href: "/knowledge", access: anyOf("journals.view") },
      { id: "sanpin", label: "sanpin", href: "/sanpin", access: STAFF_PATH },
    ],
  },
  {
    key: "billing",
    icon: "CreditCard",
    // Баланс открыт и повару, но целый раздел ему ни к чему: свои баллы
    // он видит из меню аватара.
    access: FULL_ACCESS,
    tabs: [
      { id: "plan", label: "plan", href: "/settings/subscription", access: FULL_ACCESS },
      { id: "balance", label: "balance", href: "/settings/balance", access: STAFF_PATH },
      { id: "services", label: "services", href: "/settings/services", access: STAFF_PATH },
    ],
  },
  {
    key: "more",
    icon: "LayoutGrid",
    access: FULL_ACCESS,
    // Убраны из меню владельцем 2026-09-25 — открываются по адресу.
    hiddenMatch: ["/batches", "/losses", "/changes", "/bonuses"],
    tabs: [{ id: "main", label: "main", href: "/more", access: FULL_ACCESS }],
  },
  {
    key: "inspection",
    icon: "ShieldAlert",
    // Проверяющий часто приходит, когда на месте только заведующая.
    access: fullAccessOr("tasks.verify"),
    tabs: [
      {
        id: "day",
        label: "inspectionDay",
        href: "/inspection",
        access: fullAccessOr("tasks.verify"),
      },
      { id: "portal", label: "portal", href: "/settings/inspector-portal", access: FULL_ACCESS },
      { id: "readiness", label: "readiness", href: "/dashboard/compliance-audit", access: ADMIN },
    ],
  },
];

function ruleAllows(actor: NavActor, access: NavAccess, facts: NavFacts): boolean {
  switch (access.kind) {
    case "staffPath":
      return true;
    case "fullAccess":
      return hasFullWorkspaceAccess(actor);
    case "anyOf":
      return access.capabilities.some((capability) => hasCapability(actor, capability));
    case "fullAccessOr":
      return (
        hasFullWorkspaceAccess(actor) ||
        access.capabilities.some((capability) => hasCapability(actor, capability))
      );
    case "all":
      return access.rules.every((rule) => ruleAllows(actor, rule, facts));
    case "fact":
      return facts[access.fact] === true;
  }
}

/** Откроется ли страница: сначала проверка `proxy.ts`, потом её собственная. */
export function navAllows(
  actor: NavActor,
  href: string,
  access: NavAccess,
  facts: NavFacts,
): boolean {
  if (isStaffRestrictedWebPath(href) && !canAccessWebPath(actor, href)) return false;
  return ruleAllows(actor, access, facts);
}

/** Разделы и вкладки, которые человек откроет. Пустые разделы отброшены. */
export function visibleNav(actor: NavActor, facts: NavFacts): VisibleNavSection[] {
  const result: VisibleNavSection[] = [];
  for (const section of NAV_SECTIONS) {
    if (section.access && !ruleAllows(actor, section.access, facts)) continue;
    const allowed = section.tabs.filter((tab) => navAllows(actor, tab.href, tab.access, facts));
    const allowedIds = new Set(allowed.map((tab) => tab.id));
    const tabs = allowed
      .filter((tab) => !tab.hideIfVisible || !allowedIds.has(tab.hideIfVisible))
      .map(({ id, label, href }) => ({ id, label, href }));
    if (tabs.length === 0) continue;
    result.push({
      key: section.key,
      icon: section.icon,
      rootHref: tabs[0].href,
      tabs,
      ...(section.renameHref ? { renameHref: section.renameHref } : {}),
    });
  }
  return result;
}

/** Карточки настроек, которые человек откроет (для поиска ⌘K). */
export function visibleSettingsCards(actor: NavActor, facts: NavFacts): SettingsCard[] {
  const sections = new Set<string>(visibleNav(actor, facts).map((section) => section.key));
  return SETTINGS_CARDS.filter(
    (card) => sections.has(card.section) && navAllows(actor, card.href, card.access, facts),
  );
}

type PathOwner = {
  prefix: string;
  section: NavSectionKey;
  /** Адрес вкладки, которую подсвечивает путь (или сам путь). */
  ownerHref: string;
  tabRoot: boolean;
  exact: boolean;
};

const PATH_OWNERS: PathOwner[] = (() => {
  const owners: PathOwner[] = [];
  for (const section of NAV_SECTIONS) {
    for (const tab of section.tabs) {
      owners.push({ prefix: tab.href, section: section.key, ownerHref: tab.href, tabRoot: true, exact: false });
      for (const extra of tab.match ?? []) {
        owners.push({ prefix: extra, section: section.key, ownerHref: tab.href, tabRoot: false, exact: false });
      }
    }
    for (const hidden of section.hiddenMatch ?? []) {
      owners.push({ prefix: hidden, section: section.key, ownerHref: hidden, tabRoot: false, exact: false });
    }
    for (const alias of section.aliases ?? []) {
      owners.push({ prefix: alias, section: section.key, ownerHref: alias, tabRoot: false, exact: true });
    }
  }
  for (const card of SETTINGS_CARDS) {
    for (const prefix of [card.href, ...(card.match ?? [])]) {
      owners.push({ prefix, section: card.section, ownerHref: card.href, tabRoot: false, exact: false });
    }
  }
  return owners;
})();

function normalize(pathname: string): string {
  const clean = (pathname || "/").split(/[?#]/)[0];
  return clean.length > 1 ? clean.replace(/\/+$/, "") : clean;
}

/**
 * Раздел, которому принадлежит путь: самый длинный префикс по границе
 * `/`. `isTabRoot` — путь и есть адрес вкладки (там рисуем вкладки, а не
 * крошки).
 */
export function sectionForPath(
  pathname: string,
): { section: NavSectionKey; ownerHref: string; isTabRoot: boolean } | null {
  const path = normalize(pathname);
  let best: PathOwner | null = null;
  for (const owner of PATH_OWNERS) {
    const hit = owner.exact
      ? path === owner.prefix
      : path === owner.prefix || path.startsWith(`${owner.prefix}/`);
    if (hit && (!best || owner.prefix.length > best.prefix.length)) best = owner;
  }
  if (!best) return null;
  return {
    section: best.section,
    ownerHref: best.ownerHref,
    isTabRoot: best.tabRoot && path === best.prefix,
  };
}
