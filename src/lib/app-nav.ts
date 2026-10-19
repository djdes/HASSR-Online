/**
 * Меню кабинета — девять разделов слева (решение владельца 2026-10-16,
 * задача ProjectsFlow 3931776f, дизайн
 * `docs/superpowers/specs/2026-10-16-cabinet-sidebar-nav-design.md`).
 *
 * Один список на всё: сайдбар и мобильный лист сайта, вкладки раздела,
 * хлебные крошки, ⌘K и «Разделы» мини-приложения (П-3).
 *
 * С 2026-10-17 (эскизы руководителя, план «Кабинет по эскизам», 4.0) у
 * каждого раздела, кроме «Остального», своё левое меню (`menu`): при входе в
 * раздел сайдбар целиком меняется на его пункты, у пункта могут быть вкладки
 * над страницей (третий уровень). Вкладки раздела (`tabs`) остаются только
 * кандидатами на корень раздела для разных ролей.
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
import {
  PPK_MENU_GROUPS,
  PPK_OVERVIEW_HREF,
  ppkBlockHref,
  ppkMenuBlocks,
  ppkReadyTabs,
  type PpkBlockAccess,
} from "@/lib/ppk/registry";

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

/**
 * Подписи меню раздела — своё пространство на раздел:
 * `navigation.shell.menus.<раздел>.groups/items/tabs.<id>`. У разных разделов
 * одинаковые id (`team`, `points`) значат разное, поэтому плоских ключей нет.
 */
/** Вкладка пункта меню раздела (над страницей). Подпись — `menus.<раздел>.tabs.<id>`. */
export type NavMenuTab = { id: string; href: string; access: NavAccess };

/** Пункт меню раздела (левое меню целиком меняется). Подпись — `menus.<раздел>.items.<id>`. */
export type NavMenuItem = {
  id: string;
  icon: string;
  href: string;
  access: NavAccess;
  tabs?: NavMenuTab[];
  /**
   * Другие пути пункта (префиксом): страницы-карточки и подстраницы, у которых
   * своего пункта нет, — например карточки «Настройки журналов».
   */
  match?: string[];
  /** Пункт не показываем, если виден пункт с этим id (как у вкладок). */
  hideIfVisible?: string;
};

/** Ключ подписи группы: `menus.<раздел>.groups.<label>`. */
export type NavMenuGroupLabel = "haccp" | "documents" | "directories" | "more";

/** Группа пунктов меню раздела; `label: null` — группа без подписи. */
export type NavMenuGroup = { label: NavMenuGroupLabel | null; items: NavMenuItem[] };

export type NavSection = {
  key: NavSectionKey;
  icon: string;
  /** Проверка раздела целиком — поверх правил вкладок. */
  access?: NavAccess;
  /** Первая видимая вкладка — корень раздела для этого человека. */
  tabs: NavTab[];
  /** Меню раздела: при входе в раздел левое меню меняется на него. */
  menu?: NavMenuGroup[];
  /** Пути раздела без вкладки и карточки (скрытые из меню страницы). */
  hiddenMatch?: string[];
  /** Точные адреса раздела (редиректы, `/settings`). */
  aliases?: string[];
  /** Своё название раздела организации («Настройки → Названия»). */
  renameHref?: "/journals" | "/settings/users";
};

export type VisibleNavTab = {
  id: string;
  label: NavTabLabel;
  href: string;
};

export type VisibleNavMenuItem = {
  id: string;
  icon: string;
  href: string;
  tabs?: { id: string; href: string }[];
};
export type VisibleNavMenuGroup = { label: NavMenuGroupLabel | null; items: VisibleNavMenuItem[] };

export type VisibleNavSection = {
  key: NavSectionKey;
  icon: string;
  rootHref: string;
  tabs: VisibleNavTab[];
  menu?: VisibleNavMenuGroup[];
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
// Страницы прав и иерархии пускают по праву `settings.permissions` из БД.
const PERMISSIONS_FACT: NavAccess = { kind: "fact", fact: "settingsPermissions" };
const CHECKLISTS_FACT: NavAccess = { kind: "fact", fact: "checklists" };
// `/dashboard` без `journals.view` уводит на панель контроля.
const JOURNALS_TODAY: NavAccess = { kind: "all", rules: [anyOf("journals.view"), FULL_ACCESS] };

/** Правило пункта реестра ППК — по виду доступа блока. */
const PPK_ACCESS: Record<PpkBlockAccess, NavAccess> = {
  fullAccess: FULL_ACCESS,
  journalsView: anyOf("journals.view"),
  staffPath: STAFF_PATH,
};

/**
 * Меню «Производственного контроля» строит реестр блоков: группы, готовые
 * блоки и их готовые вкладки. Адрес пункта — первая готовая вкладка.
 */
function ppkMenu(): NavMenuGroup[] {
  return PPK_MENU_GROUPS.map((group): NavMenuGroup => ({
    label: group.labelled ? (group.key as Exclude<typeof group.key, "main">) : null,
    items: ppkMenuBlocks(group.key).map((block): NavMenuItem => {
      const tabs = ppkReadyTabs(block);
      return {
        id: block.key,
        icon: block.icon,
        href: ppkBlockHref(block),
        access: PPK_ACCESS[block.access],
        ...(tabs.length > 0
          ? { tabs: tabs.map((tab) => ({ id: tab.id, href: tab.href, access: PPK_ACCESS[tab.access] })) }
          : {}),
      };
    }),
  })).filter((group) => group.items.length > 0);
}

/**
 * Меню разделов по эскизам руководителя (сканы 82–83, 2026-10-17): у раздела
 * своё левое меню. Пункт — существующая страница; вкладки раздела (`tabs`)
 * остаются кандидатами на корень раздела для разных ролей и в разделе с меню
 * не рисуются. Что не нарисовано на эскизе, — в нижней группе «Ещё».
 */
const COMPANY_MENU: NavMenuGroup[] = [
  {
    label: null,
    // Скан 82, лист 2: реквизиты, блок сведений «в любом документе», логотип
    // и цвета; контакты — бывшие секции формы реквизитов.
    items: [
      { id: "organization", icon: "Building2", href: "/settings/organization", access: ADMIN },
      { id: "documents", icon: "ScrollText", href: "/settings/organization/documents", access: ADMIN },
      { id: "branding", icon: "SwatchBook", href: "/settings/organization/branding", access: ADMIN },
      { id: "contacts", icon: "Contact", href: "/settings/organization/contacts", access: ADMIN },
    ],
  },
  {
    label: "more",
    items: [
      { id: "names", icon: "PenLine", href: "/settings/names", access: FULL_ACCESS },
      { id: "onboarding", icon: "Rocket", href: "/settings/onboarding", access: ADMIN },
      { id: "template", icon: "LayoutTemplate", href: "/settings/onboarding-template", access: ADMIN },
      { id: "appearance", icon: "Palette", href: "/settings/appearance", access: ADMIN },
    ],
  },
];

const STAFF_MENU: NavMenuGroup[] = [
  {
    label: "directories",
    items: [
      { id: "users", icon: "Users", href: "/settings/users", access: FULL_ACCESS },
      {
        // «Доступ и права» — четыре страницы прав вкладками одного пункта
        // (одна страница вместо четырёх — следующая задача).
        id: "access",
        icon: "ShieldCheck",
        href: "/settings/journal-access",
        access: FULL_ACCESS,
        tabs: [
          { id: "permissions", href: "/settings/permissions", access: PERMISSIONS_FACT },
          { id: "presets", href: "/settings/role-presets", access: ADMIN },
          { id: "journals", href: "/settings/journal-access", access: FULL_ACCESS },
          { id: "positions", href: "/settings/journals-by-position", access: FULL_ACCESS },
        ],
      },
    ],
  },
  {
    label: "more",
    items: [
      { id: "team", icon: "UsersRound", href: "/team", access: anyOf("staff.view", "tasks.verify", "admin.full") },
      { id: "schedule", icon: "CalendarDays", href: "/settings/schedule", access: FULL_ACCESS },
      { id: "health", icon: "HeartPulse", href: "/settings/staff-health", access: FULL_ACCESS },
      { id: "responsibles", icon: "UserCheck", href: "/settings/journal-responsibles", access: ADMIN },
      { id: "hierarchy", icon: "Network", href: "/settings/staff-hierarchy", access: PERMISSIONS_FACT },
      { id: "visibility", icon: "Eye", href: "/settings/position-staff-visibility", access: FULL_ACCESS },
      { id: "workload", icon: "Scale", href: "/settings/workload-balance", access: ADMIN },
      { id: "phone", icon: "Phone", href: "/settings/phone", access: STAFF_PATH },
    ],
  },
];

const POINTS_MENU: NavMenuGroup[] = [
  {
    label: null,
    items: [
      { id: "buildings", icon: "Store", href: "/settings/buildings", access: FULL_ACCESS },
      { id: "areas", icon: "DoorOpen", href: "/settings/areas", access: STAFF_PATH },
      { id: "equipment", icon: "Refrigerator", href: "/settings/equipment", access: STAFF_PATH },
      { id: "qr", icon: "QrCode", href: "/settings/qr-posters", access: FULL_ACCESS },
    ],
  },
  {
    label: "more",
    items: [
      { id: "printer", icon: "Printer", href: "/settings/print-agent", access: FULL_ACCESS },
      { id: "kiosk", icon: "TabletSmartphone", href: "/settings/kiosk", access: FULL_ACCESS },
      { id: "products", icon: "Package", href: "/settings/products", access: FULL_ACCESS },
      { id: "master", icon: "Library", href: "/settings/master-cabinet", access: FULL_ACCESS },
    ],
  },
];

/** Пути карточек «Настройки журналов» — они подсвечивают её пункт. */
const JOURNAL_SETUP_MATCH = SETTINGS_CARDS.filter((card) => card.section === "journals").flatMap((card) => [
  card.href,
  ...(card.match ?? []),
]);

const JOURNALS_MENU: NavMenuGroup[] = [
  {
    label: null,
    items: [
      { id: "today", icon: "CalendarCheck", href: "/dashboard", access: JOURNALS_TODAY, match: ["/dashboard/catch-up"] },
      // «Сегодня» заведующей — панель контроля (у управляющей есть своё «Сегодня»).
      {
        id: "control",
        icon: "CalendarCheck",
        href: "/control-board",
        access: anyOf("tasks.verify", "admin.full"),
        hideIfVisible: "today",
      },
      { id: "all", icon: "ClipboardList", href: "/journals", access: anyOf("journals.view") },
      { id: "verify", icon: "BadgeCheck", href: "/verifications", access: anyOf("tasks.verify") },
      { id: "setup", icon: "Settings2", href: "/settings/sections/journals", access: FULL_ACCESS, match: JOURNAL_SETUP_MATCH },
    ],
  },
];

const CHECKLISTS_MENU: NavMenuGroup[] = [
  { label: null, items: [{ id: "builder", icon: "ListChecks", href: "/checklists", access: CHECKLISTS_FACT }] },
];

const BILLING_MENU: NavMenuGroup[] = [
  {
    label: null,
    items: [
      { id: "plan", icon: "CreditCard", href: "/settings/subscription", access: FULL_ACCESS },
      { id: "balance", icon: "Wallet", href: "/settings/balance", access: STAFF_PATH },
      { id: "services", icon: "Handshake", href: "/settings/services", access: STAFF_PATH },
    ],
  },
];

const INSPECTION_MENU: NavMenuGroup[] = [
  {
    label: null,
    items: [
      { id: "now", icon: "ShieldAlert", href: "/inspection", access: fullAccessOr("tasks.verify") },
      { id: "portal", icon: "QrCode", href: "/settings/inspector-portal", access: FULL_ACCESS },
      { id: "readiness", icon: "Gauge", href: "/dashboard/compliance-audit", access: ADMIN },
    ],
  },
];

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
    menu: COMPANY_MENU,
  },
  {
    key: "staff",
    icon: "Users",
    access: fullAccessOr("staff.view", "tasks.verify"),
    renameHref: "/settings/users",
    // `/settings/sections/staff` — бывшая «Настройка»: её карточки стали
    // пунктами меню, сама страница уводит к сотрудникам.
    hiddenMatch: ["/staff", "/competencies", "/settings/sections/staff"],
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
    ],
    menu: STAFF_MENU,
  },
  {
    key: "points",
    icon: "Store",
    access: FULL_ACCESS,
    // `/settings/sections/points` — бывшая «Настройка», см. «Сотрудники».
    hiddenMatch: ["/settings/sections/points"],
    tabs: [
      { id: "buildings", label: "buildings", href: "/settings/buildings", access: FULL_ACCESS },
      { id: "areas", label: "areas", href: "/settings/areas", access: STAFF_PATH },
      { id: "equipment", label: "equipment", href: "/settings/equipment", access: STAFF_PATH },
      { id: "qr", label: "qr", href: "/settings/qr-posters", access: FULL_ACCESS },
    ],
    menu: POINTS_MENU,
  },
  {
    key: "journals",
    icon: "ClipboardList",
    renameHref: "/journals",
    hiddenMatch: ["/journals-progress", "/acknowledge"],
    tabs: [
      {
        id: "today",
        label: "today",
        href: "/dashboard",
        access: JOURNALS_TODAY,
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
    menu: JOURNALS_MENU,
  },
  {
    key: "checklists",
    icon: "ListChecks",
    tabs: [{ id: "main", label: "main", href: "/checklists", access: CHECKLISTS_FACT }],
    menu: CHECKLISTS_MENU,
  },
  {
    key: "productionControl",
    icon: "FileCheck2",
    access: FULL_ACCESS,
    // Вкладка одна — корень раздела; навигация внутри — меню раздела слева.
    tabs: [{ id: "program", label: "program", href: PPK_OVERVIEW_HREF, access: FULL_ACCESS }],
    menu: ppkMenu(),
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
    menu: BILLING_MENU,
  },
  {
    key: "more",
    icon: "LayoutGrid",
    access: FULL_ACCESS,
    // Убраны из меню владельцем 2026-09-25 — открываются по адресу.
    // Своего меню нет: раздел — одна страница с карточками.
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
    menu: INSPECTION_MENU,
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

/**
 * Меню раздела, которое человек откроет: пункты и вкладки — через `navAllows`;
 * у пункта с вкладками адрес — первая видимая вкладка, без видимых вкладок
 * пункт убирается; пункт с `hideIfVisible` прячется, если виден тот пункт;
 * пустые группы тоже убираются.
 */
function visibleMenu(actor: NavActor, groups: NavMenuGroup[], facts: NavFacts): VisibleNavMenuGroup[] {
  const allowed = groups.map((group) => {
    const items: (VisibleNavMenuItem & { hideIfVisible?: string })[] = [];
    for (const item of group.items) {
      if (!navAllows(actor, item.href, item.access, facts)) continue;
      const hide = item.hideIfVisible ? { hideIfVisible: item.hideIfVisible } : {};
      if (!item.tabs) {
        items.push({ id: item.id, icon: item.icon, href: item.href, ...hide });
        continue;
      }
      const tabs = item.tabs
        .filter((tab) => navAllows(actor, tab.href, tab.access, facts))
        .map(({ id, href }) => ({ id, href }));
      if (tabs.length === 0) continue;
      items.push({ id: item.id, icon: item.icon, href: tabs[0].href, tabs, ...hide });
    }
    return { label: group.label, items };
  });
  const allowedIds = new Set(allowed.flatMap((group) => group.items.map((item) => item.id)));
  const result: VisibleNavMenuGroup[] = [];
  for (const group of allowed) {
    const items = group.items
      .filter((item) => !item.hideIfVisible || !allowedIds.has(item.hideIfVisible))
      .map(({ hideIfVisible: _hidden, ...item }) => item);
    if (items.length > 0) result.push({ label: group.label, items });
  }
  return result;
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
      .map((tab): VisibleNavTab => ({ id: tab.id, label: tab.label, href: tab.href }));
    if (tabs.length === 0) continue;
    const menu = visibleMenu(actor, section.menu ?? [], facts);
    result.push({
      key: section.key,
      icon: section.icon,
      rootHref: tabs[0].href,
      tabs,
      ...(menu.length > 0 ? { menu } : {}),
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
  /** Адрес, который подсвечивает путь (вкладка, пункт меню или сам путь). */
  ownerHref: string;
  tabRoot: boolean;
  exact: boolean;
  /** Пункт меню раздела, которому принадлежит путь. */
  menuItemId: string | null;
  /** Вкладка пункта меню, к которой относится путь. */
  menuTabHref: string | null;
};

const PATH_OWNERS: PathOwner[] = (() => {
  const owners: PathOwner[] = [];
  for (const section of NAV_SECTIONS) {
    const sectionTabHrefs = new Set(section.tabs.map((tab) => tab.href));
    // Пункт меню — владелец своего адреса и адресов своих вкладок (префикс):
    // `/orders/x` — это «Приказы», `/sanpin` — вкладка «Нормативных документов».
    // Идут раньше вкладок раздела: при равном адресе (корень раздела) выигрывает пункт.
    for (const group of section.menu ?? []) {
      for (const item of group.items) {
        const hrefs = item.tabs ? item.tabs.map((tab) => tab.href) : [item.href];
        for (const href of hrefs) {
          owners.push({
            prefix: href,
            section: section.key,
            ownerHref: href,
            tabRoot: sectionTabHrefs.has(href),
            exact: false,
            menuItemId: item.id,
            menuTabHref: item.tabs ? href : null,
          });
        }
        // Пути без своего пункта (карточки, подстраницы) — глубина пункта:
        // подсвечивают его, а над страницей стоит «‹ {пункт}».
        for (const extra of item.match ?? []) {
          owners.push({
            prefix: extra,
            section: section.key,
            ownerHref: item.href,
            tabRoot: false,
            exact: false,
            menuItemId: item.id,
            menuTabHref: null,
          });
        }
      }
    }
    for (const tab of section.tabs) {
      if (!owners.some((owner) => owner.section === section.key && owner.prefix === tab.href)) {
        owners.push({ prefix: tab.href, section: section.key, ownerHref: tab.href, tabRoot: true, exact: false, menuItemId: null, menuTabHref: null });
      }
      for (const extra of tab.match ?? []) {
        owners.push({ prefix: extra, section: section.key, ownerHref: tab.href, tabRoot: false, exact: false, menuItemId: null, menuTabHref: null });
      }
    }
    for (const hidden of section.hiddenMatch ?? []) {
      owners.push({ prefix: hidden, section: section.key, ownerHref: hidden, tabRoot: false, exact: false, menuItemId: null, menuTabHref: null });
    }
    for (const alias of section.aliases ?? []) {
      owners.push({ prefix: alias, section: section.key, ownerHref: alias, tabRoot: false, exact: true, menuItemId: null, menuTabHref: null });
    }
  }
  for (const card of SETTINGS_CARDS) {
    for (const prefix of [card.href, ...(card.match ?? [])]) {
      owners.push({ prefix, section: card.section, ownerHref: card.href, tabRoot: false, exact: false, menuItemId: null, menuTabHref: null });
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
export function sectionForPath(pathname: string): {
  section: NavSectionKey;
  ownerHref: string;
  isTabRoot: boolean;
  menuItemId: string | null;
  menuTabHref: string | null;
} | null {
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
    menuItemId: best.menuItemId,
    // Вкладка пункта — только когда путь равен её адресу или лежит глубже.
    menuTabHref: best.menuTabHref,
  };
}
