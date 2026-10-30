/**
 * Меню кабинета — дерево разделов слева (2026-10-28; девять разделов — 2026-10-16,
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
import { isCompanyOnlyPath, isPointScoped } from "@/lib/point-scope";
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
  | "office"
  | "monitoring"
  | "settings"
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
  /** Руководитель точки: общие разделы компании ему закрыты (lib/point-scope.ts). */
  pointScope?: readonly string[] | null;
};

/** То, что нельзя вывести из роли: ACL журнала чек-листов и т.п. */
export type NavFacts = {
  checklists: boolean;
  /** Право `settings.permissions` из БД (роль/категория должности). */
  settingsPermissions: boolean;
  /**
   * «Журналы» в режиме точки (`journalsPointMode`, 2026-10-28): в шапке
   * выбрана торговая точка или человек — руководитель точки. Не задано —
   * режима нет (точки выключены).
   */
  journalsPointMode?: boolean;
};

/**
 * Какая проверка стоит на странице.
 *   • `staffPath`    — своей проверки нет, режет только `proxy.ts`;
 *   • `fullAccess`   — `hasFullWorkspaceAccess` (руководство и ROOT);
 *   • `anyOf`        — любая из возможностей пресета;
 *   • `fullAccessOr` — руководство или любая из возможностей;
 *   • `all`          — все правила сразу;
 *   • `fact`         — факт, посчитанный на сервере (`NavFacts`);
 *   • `notPointMode` — страница всей организации: в режиме точки закрыта
 *     (страница показывает «недоступно при выбранной точке»).
 */
export type NavAccess =
  | { kind: "staffPath" }
  | { kind: "fullAccess" }
  | { kind: "anyOf"; capabilities: Capability[] }
  | { kind: "fullAccessOr"; capabilities: Capability[] }
  | { kind: "all"; rules: NavAccess[] }
  | { kind: "fact"; fact: Exclude<keyof NavFacts, "journalsPointMode"> }
  | { kind: "notPointMode" };

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
  | "readiness"
  | "office"
  | "access"
  | "overview"
  | "points";

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
  /** Метка у пункта: «PRO» — возможность тарифа PRO (эскиз: «доступно в PRO»). */
  badge?: "pro";
};

/** Ключ подписи группы: `menus.<раздел>.groups.<label>`. */
export type NavMenuGroupLabel =
  | "haccp"
  | "documents"
  | "directories"
  | "groups"
  | "sets"
  | "more";

/**
 * Группа пунктов меню раздела; `label: null` — группа без подписи.
 * `sections` — вложенные разделы (эскизы 2026-10-28: «Моя компания → Торговые
 * точки → Журналы»): пункт ведёт на корень вложенного раздела, у раздела со
 * своим меню — стрелка ›. Идут первыми, перед обычными пунктами группы;
 * подпись — `menus.<раздел>.items.<ключ вложенного раздела>`.
 */
export type NavMenuGroup = { label: NavMenuGroupLabel | null; items: NavMenuItem[]; sections?: NavSectionKey[] };

export type NavSection = {
  key: NavSectionKey;
  icon: string;
  /**
   * Раздел-родитель: раздел — пункт его меню, а не главного. Если родитель
   * человеку закрыт, раздел стоит в главном меню — права не меняются.
   */
  parent?: NavSectionKey;
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
  /** Раздел целиком про всю компанию — руководителю точки не показываем. */
  companyOnly?: boolean;
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
  /** Пункт — вложенный раздел: ведёт на его корень. */
  section?: NavSectionKey;
  /** У вложенного раздела своё меню — у пункта стрелка ›. */
  hasMenu?: boolean;
  badge?: NavMenuItem["badge"];
};
export type VisibleNavMenuGroup = { label: NavMenuGroupLabel | null; items: VisibleNavMenuItem[] };

export type VisibleNavSection = {
  key: NavSectionKey;
  icon: string;
  /** Видимый родитель; нет — раздел в главном меню. */
  parent?: NavSectionKey;
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
// «Журналы точек» и «Все журналы» — страницы всей организации: при выбранной
// в шапке торговой точке их нет (владелец, 2026-10-28).
const NOT_POINT_MODE: NavAccess = { kind: "notPointMode" };
const JOURNALS_POINTS: NavAccess = { kind: "all", rules: [ADMIN, NOT_POINT_MODE] };
const JOURNALS_ALL: NavAccess = { kind: "all", rules: [anyOf("journals.view"), NOT_POINT_MODE] };

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
 * Меню разделов по эскизам руководителя (2026-10-17, сканы 82–83; дерево —
 * 2026-10-28, «Отсканированный документ 95»): у раздела своё левое меню.
 * Пункт — существующая страница или вложенный раздел (`sections` группы);
 * вкладки раздела (`tabs`) остаются кандидатами на корень раздела для разных
 * ролей и в разделе с меню не рисуются. Что не нарисовано на эскизе, — в
 * нижней группе «Ещё».
 *
 * Главное меню руководителя — четыре раздела (Моя компания, Мониторинг,
 * Подписки, Настройки и оформление) и «Пришла проверка» внизу.
 */
const COMPANY_MENU: NavMenuGroup[] = [
  // Лист 2: Офис ›, Торговые точки ›, Мастер-кабинет (PRO), Остальное, Реквизиты.
  {
    label: null,
    sections: ["office", "points"],
    items: [{ id: "master", icon: "Library", href: "/settings/master-cabinet", access: FULL_ACCESS, badge: "pro" }],
  },
  {
    label: null,
    sections: ["more"],
    items: [
      {
        // Реквизиты, блок сведений «в любом документе» и контакты — вкладки одного пункта.
        id: "organization",
        icon: "Building2",
        href: "/settings/organization",
        access: ADMIN,
        tabs: [
          { id: "organization", href: "/settings/organization", access: ADMIN },
          { id: "documents", href: "/settings/organization/documents", access: ADMIN },
          { id: "contacts", href: "/settings/organization/contacts", access: ADMIN },
        ],
      },
    ],
  },
];

/**
 * Прежние страницы прав — подробные редакторы пункта «Права и доступ»: он
 * одна страница со сводкой, а они открываются из её блоков (с теми же
 * правами, что у страниц) и подсвечивают пункт.
 */
const ACCESS_EDITORS = [
  "/settings/permissions",
  "/settings/role-presets",
  "/settings/journal-access",
  "/settings/journals-by-position",
];

/** «Офис» (лист 3): сотрудники офиса и права доступа — всё про всю компанию. */
const OFFICE_MENU: NavMenuGroup[] = [
  {
    label: null,
    items: [
      { id: "office", icon: "BriefcaseBusiness", href: "/settings/organization/office", access: ADMIN },
      { id: "access", icon: "ShieldCheck", href: "/settings/access", access: FULL_ACCESS, match: ACCESS_EDITORS },
    ],
  },
];

/** «Сотрудники» — вложенный раздел «Торговых точек»: корень — сотрудники по точкам. */
const STAFF_MENU: NavMenuGroup[] = [
  {
    label: "directories",
    items: [
      { id: "users", icon: "Users", href: "/settings/users", access: FULL_ACCESS },
      { id: "positions", icon: "BriefcaseBusiness", href: "/settings/positions", access: FULL_ACCESS },
    ],
  },
  {
    // «Отдельно» на эскизе (скан 82, лист 4): группы людей с особой ролью.
    label: "groups",
    items: [
      { id: "commission", icon: "UtensilsCrossed", href: "/settings/brakerage-commission", access: FULL_ACCESS },
      { id: "haccpGroup", icon: "ShieldPlus", href: "/settings/haccp-group", access: FULL_ACCESS },
      { id: "controlGroup", icon: "Binoculars", href: "/settings/control-group", access: FULL_ACCESS },
      { id: "inspectors", icon: "UserSearch", href: "/settings/inspectors", access: FULL_ACCESS },
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

/**
 * «Торговые точки» (лист 4): корень — список всех точек и «Добавить точку»;
 * сотрудники, журналы и ППК — вложенные разделы, справочники — по всем точкам.
 */
const POINTS_MENU: NavMenuGroup[] = [
  {
    label: null,
    sections: ["staff", "journals", "productionControl"],
    items: [
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
    ],
  },
];

/** Пути карточек «Настройки журналов» — они подсвечивают её пункт. */
const JOURNAL_SETUP_MATCH = SETTINGS_CARDS.filter((card) => card.section === "journals").flatMap((card) => [
  card.href,
  ...(card.match ?? []),
]);

/**
 * Меню «Журналов» (владелец, 2026-10-28): «Настройка» — в общем списке, под
 * ним наборы журналов. При выбранной в шапке торговой точке «Журналы точек»
 * и «Все журналы» пропадают (`NOT_POINT_MODE`) — вход в раздел «Сегодня».
 */
const JOURNALS_MENU: NavMenuGroup[] = [
  {
    label: null,
    items: [
      // Журналы всех точек: что ведётся на каждой, добавить/убрать журнал точке.
      { id: "points", icon: "Store", href: "/journals/points", access: JOURNALS_POINTS },
      { id: "today", icon: "CalendarCheck", href: "/dashboard", access: JOURNALS_TODAY, match: ["/dashboard/catch-up"] },
      // «Сегодня» заведующей — панель контроля (у управляющей есть своё «Сегодня»).
      {
        id: "control",
        icon: "CalendarCheck",
        href: "/control-board",
        access: anyOf("tasks.verify", "admin.full"),
        hideIfVisible: "today",
      },
      { id: "all", icon: "ClipboardList", href: "/journals", access: JOURNALS_ALL },
      { id: "verify", icon: "BadgeCheck", href: "/verifications", access: anyOf("tasks.verify") },
      { id: "setup", icon: "Settings2", href: "/settings/sections/journals", access: FULL_ACCESS, match: JOURNAL_SETUP_MATCH },
    ],
  },
  {
    // Наборы журналов (скан 82, лист 1): состав — `JOURNAL_SETS`, guard — как у
    // API наборов (`hasFullWorkspaceAccess`).
    label: "sets",
    items: [
      { id: "standard", icon: "ListOrdered", href: "/journals/sets/standard", access: FULL_ACCESS },
      { id: "haccp", icon: "ShieldCheck", href: "/journals/sets/haccp", access: FULL_ACCESS },
      { id: "extra", icon: "ListPlus", href: "/journals/sets/extra", access: FULL_ACCESS },
    ],
  },
];

/**
 * «Чек-листы» (скан 82, лист 3; решения раздела 7, 2026-10-19): готовые
 * шаблоны → конструктор → назначение (только руководителю) → результаты.
 * Корень раздела — «Шаблоны»: новичок сначала видит готовые чек-листы.
 * Страница проверки (`/checklists/inspections/<id>`) — глубина «Результатов».
 * С 2026-10-28 — вложенный раздел «Мониторинга».
 */
const CHECKLISTS_MENU: NavMenuGroup[] = [
  {
    label: null,
    items: [
      { id: "templates", icon: "LayoutTemplate", href: "/checklists/templates", access: CHECKLISTS_FACT },
      { id: "builder", icon: "ListChecks", href: "/checklists", access: CHECKLISTS_FACT },
      { id: "assignments", icon: "CalendarRange", href: "/checklists/assignments", access: ADMIN },
      {
        id: "results",
        icon: "ClipboardCheck",
        href: "/checklists/results",
        access: CHECKLISTS_FACT,
        match: ["/checklists/inspections"],
      },
    ],
  },
];

/** «Мониторинг» (лист 5): сводка — журналы, чек-листы и ППК в процентах. */
const MONITORING_MENU: NavMenuGroup[] = [
  { label: null, items: [{ id: "overview", icon: "Gauge", href: "/monitoring", access: FULL_ACCESS }] },
  { label: null, sections: ["checklists"], items: [] },
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

/** «Настройки и оформление» (лист 1): внешний вид кабинета и быстрый старт. */
const SETTINGS_MENU: NavMenuGroup[] = [
  {
    label: null,
    items: [
      { id: "appearance", icon: "Palette", href: "/settings/appearance", access: ADMIN },
      { id: "branding", icon: "SwatchBook", href: "/settings/organization/branding", access: ADMIN },
      { id: "names", icon: "PenLine", href: "/settings/names", access: FULL_ACCESS },
      { id: "onboarding", icon: "Rocket", href: "/settings/onboarding", access: ADMIN },
      { id: "template", icon: "LayoutTemplate", href: "/settings/onboarding-template", access: ADMIN },
    ],
  },
];

// Фото 6-го листа: нормативные документы, ППК и ХАССП («как сейчас»), QR для
// проверяющего, консалтинг; остальные блоки раздела — в «Ещё». Заведующей
// открыто всё, что не требует руководства: проверка часто приходит при ней одной.
const INSPECTION_MENU: NavMenuGroup[] = [
  {
    label: null,
    items: [
      { id: "laws", icon: "Scale", href: "/inspection/laws", access: FULL_ACCESS },
      { id: "norms", icon: "BookOpen", href: "/inspection/norms", access: fullAccessOr("tasks.verify") },
      { id: "portal", icon: "QrCode", href: "/settings/inspector-portal", access: FULL_ACCESS },
      { id: "experts", icon: "Handshake", href: "/inspection/experts", access: FULL_ACCESS },
    ],
  },
  {
    label: "more",
    items: [
      { id: "now", icon: "ShieldAlert", href: "/inspection", access: fullAccessOr("tasks.verify") },
      { id: "visits", icon: "ScrollText", href: "/inspection/visits", access: fullAccessOr("tasks.verify") },
      { id: "readiness", icon: "Gauge", href: "/dashboard/compliance-audit", access: ADMIN },
      { id: "special", icon: "ShieldCheck", href: "/inspection/special-mode", access: fullAccessOr("tasks.verify") },
    ],
  },
];

/**
 * Порядок — порядок главного меню: разделы без видимого родителя идут в нём
 * в этом порядке, вложенные стоят за родителем (на случай, когда родитель
 * человеку закрыт и раздел поднимается в главное меню).
 */
export const NAV_SECTIONS: NavSection[] = [
  {
    key: "company",
    icon: "Building2",
    // Реквизиты и мастер-кабинет просят `admin.full` / руководство;
    // заведующей целый раздел ни к чему — её разделы поднимаются в главное меню.
    access: ADMIN,
    companyOnly: true,
    aliases: ["/settings"],
    tabs: [{ id: "organization", label: "organization", href: "/settings/organization", access: ADMIN }],
    menu: COMPANY_MENU,
  },
  {
    key: "office",
    icon: "BriefcaseBusiness",
    parent: "company",
    companyOnly: true,
    tabs: [
      { id: "office", label: "office", href: "/settings/organization/office", access: ADMIN },
      { id: "access", label: "access", href: "/settings/access", access: FULL_ACCESS },
    ],
    menu: OFFICE_MENU,
  },
  {
    key: "points",
    icon: "Store",
    parent: "company",
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
    key: "staff",
    icon: "Users",
    parent: "points",
    access: fullAccessOr("staff.view", "tasks.verify"),
    renameHref: "/settings/users",
    // `/settings/sections/staff` — бывшая «Настройка»: её карточки стали
    // пунктами меню, сама страница уводит к сотрудникам.
    hiddenMatch: ["/staff", "/settings/sections/staff"],
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
    key: "journals",
    icon: "ClipboardList",
    parent: "points",
    renameHref: "/journals",
    hiddenMatch: ["/journals-progress", "/acknowledge"],
    tabs: [
      { id: "points", label: "points", href: "/journals/points", access: JOURNALS_POINTS },
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
      { id: "all", label: "all", href: "/journals", access: JOURNALS_ALL },
      { id: "verify", label: "verify", href: "/verifications", access: anyOf("tasks.verify") },
      { id: "setup", label: "setup", href: "/settings/sections/journals", access: FULL_ACCESS },
    ],
    menu: JOURNALS_MENU,
  },
  {
    key: "productionControl",
    icon: "FileCheck2",
    parent: "points",
    access: FULL_ACCESS,
    // Вкладка одна — корень раздела; навигация внутри — меню раздела слева.
    tabs: [{ id: "program", label: "program", href: PPK_OVERVIEW_HREF, access: FULL_ACCESS }],
    menu: ppkMenu(),
  },
  {
    key: "monitoring",
    icon: "Gauge",
    access: FULL_ACCESS,
    tabs: [{ id: "overview", label: "overview", href: "/monitoring", access: FULL_ACCESS }],
    menu: MONITORING_MENU,
  },
  {
    key: "checklists",
    icon: "ListChecks",
    parent: "monitoring",
    tabs: [{ id: "main", label: "main", href: "/checklists/templates", access: CHECKLISTS_FACT }],
    menu: CHECKLISTS_MENU,
  },
  {
    key: "billing",
    icon: "CreditCard",
    // Баланс открыт и повару, но целый раздел ему ни к чему: свои баллы
    // он видит из меню аватара.
    access: FULL_ACCESS,
    // Тариф и услуги — дело офиса; руководителю точки раздел не нужен.
    companyOnly: true,
    tabs: [
      { id: "plan", label: "plan", href: "/settings/subscription", access: FULL_ACCESS },
      { id: "balance", label: "balance", href: "/settings/balance", access: STAFF_PATH },
      { id: "services", label: "services", href: "/settings/services", access: STAFF_PATH },
    ],
    menu: BILLING_MENU,
  },
  {
    key: "settings",
    icon: "Palette",
    access: FULL_ACCESS,
    companyOnly: true,
    tabs: [
      { id: "appearance", label: "appearance", href: "/settings/appearance", access: ADMIN },
      { id: "names", label: "names", href: "/settings/names", access: FULL_ACCESS },
    ],
    menu: SETTINGS_MENU,
  },
  {
    key: "more",
    icon: "LayoutGrid",
    parent: "company",
    access: FULL_ACCESS,
    // Своего меню нет: раздел — одна страница с карточками (`settings-cards.ts`).
    // Партии, потери, изменения, премии — карточки «Остального» (2026-10-28).
    // `/translations` — редактор переводов (2026-10-24): вход из меню профиля.
    hiddenMatch: ["/translations", "/settings/integrations/max"],
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
    case "notPointMode":
      return facts.journalsPointMode !== true;
  }
}

/** Откроется ли страница: сначала проверки `proxy.ts`, потом её собственная. */
export function navAllows(
  actor: NavActor,
  href: string,
  access: NavAccess,
  facts: NavFacts,
): boolean {
  if (isStaffRestrictedWebPath(href) && !canAccessWebPath(actor, href)) return false;
  if (isPointScoped(actor) && isCompanyOnlyPath(href)) return false;
  return ruleAllows(actor, access, facts);
}

/**
 * Меню раздела, которое человек откроет: пункты и вкладки — через `navAllows`;
 * у пункта с вкладками адрес — первая видимая вкладка, без видимых вкладок
 * пункт убирается; пункт с `hideIfVisible` прячется, если виден тот пункт;
 * вложенные разделы (`sections`) — первыми, если раздел человеку виден;
 * пустые группы тоже убираются.
 */
function visibleMenu(
  actor: NavActor,
  groups: NavMenuGroup[],
  facts: NavFacts,
  sectionItem: (key: NavSectionKey) => VisibleNavMenuItem | null,
): VisibleNavMenuGroup[] {
  const allowed = groups.map((group) => {
    const items: (VisibleNavMenuItem & { hideIfVisible?: string })[] = [];
    for (const key of group.sections ?? []) {
      const item = sectionItem(key);
      if (item) items.push(item);
    }
    for (const item of group.items) {
      if (!navAllows(actor, item.href, item.access, facts)) continue;
      const hide = {
        ...(item.hideIfVisible ? { hideIfVisible: item.hideIfVisible } : {}),
        ...(item.badge ? { badge: item.badge } : {}),
      };
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

/**
 * Разделы и вкладки, которые человек откроет. Пустые разделы отброшены.
 * Вложенный раздел — пункт меню родителя (`parent`), если родитель виден;
 * иначе он стоит в главном меню (см. `mainNavSections`).
 */
export function visibleNav(actor: NavActor, facts: NavFacts): VisibleNavSection[] {
  const shown = new Map<NavSectionKey, { section: NavSection; tabs: VisibleNavTab[] }>();
  for (const section of NAV_SECTIONS) {
    if (section.access && !ruleAllows(actor, section.access, facts)) continue;
    if (section.companyOnly && isPointScoped(actor)) continue;
    const allowed = section.tabs.filter((tab) => navAllows(actor, tab.href, tab.access, facts));
    const allowedIds = new Set(allowed.map((tab) => tab.id));
    const tabs = allowed
      .filter((tab) => !tab.hideIfVisible || !allowedIds.has(tab.hideIfVisible))
      .map((tab): VisibleNavTab => ({ id: tab.id, label: tab.label, href: tab.href }));
    if (tabs.length > 0) shown.set(section.key, { section, tabs });
  }
  const parentOf = (section: NavSection) =>
    section.parent && shown.has(section.parent) ? section.parent : undefined;

  const menus = new Map<NavSectionKey, VisibleNavMenuGroup[]>();
  const menuOf = (key: NavSectionKey): VisibleNavMenuGroup[] => {
    const known = menus.get(key);
    if (known) return known;
    const { section } = shown.get(key)!;
    const menu = visibleMenu(actor, section.menu ?? [], facts, (childKey) => {
      const child = shown.get(childKey);
      if (!child || parentOf(child.section) !== key) return null;
      return {
        id: childKey,
        icon: child.section.icon,
        href: child.tabs[0].href,
        section: childKey,
        ...(menuOf(childKey).length > 0 ? { hasMenu: true } : {}),
      };
    });
    menus.set(key, menu);
    return menu;
  };

  return [...shown.values()].map(({ section, tabs }) => {
    const menu = menuOf(section.key);
    const parent = parentOf(section);
    return {
      key: section.key,
      icon: section.icon,
      ...(parent ? { parent } : {}),
      rootHref: tabs[0].href,
      tabs,
      ...(menu.length > 0 ? { menu } : {}),
      ...(section.renameHref ? { renameHref: section.renameHref } : {}),
    };
  });
}

/** Главное меню: разделы без видимого родителя, в порядке `NAV_SECTIONS`. */
export function mainNavSections<T extends { parent?: NavSectionKey }>(sections: readonly T[]): T[] {
  return sections.filter((section) => !section.parent);
}

/**
 * Путь к разделу сверху вниз — по видимым родителям: раздел главного меню,
 * вложенные разделы, сам раздел («Моя компания → Торговые точки → Журналы»).
 * Его показывает карточка «Вы здесь» над меню раздела.
 */
export function navSectionPath<T extends { key: NavSectionKey; parent?: NavSectionKey }>(
  sections: readonly T[],
  key: NavSectionKey,
): T[] {
  const path: T[] = [];
  let current = sections.find((section) => section.key === key);
  while (current && !path.includes(current)) {
    path.unshift(current);
    const parent: NavSectionKey | undefined = current.parent;
    current = parent ? sections.find((section) => section.key === parent) : undefined;
  }
  return path;
}

/** Карточки настроек, которые человек откроет (для поиска ⌘K). */
export function visibleSettingsCards(actor: NavActor, facts: NavFacts): SettingsCard[] {
  const sections = new Set<string>(visibleNav(actor, facts).map((section) => section.key));
  return SETTINGS_CARDS.filter(
    (card) => sections.has(card.section) && navAllows(actor, card.href, card.access, facts),
  );
}

/**
 * Страницы пунктов меню без жёсткой проверки: открываются всем, руководству —
 * с правкой (`canManage`). В меню они только у руководства, но «Нет доступа»
 * на них не показываем. Остальные страницы пунктов обязаны уходить сами
 * (`forbidden()` / редирект) — это сверяет тест.
 */
export const OPEN_TO_ALL_NAV_HREFS: readonly string[] = ["/orders", "/settings/products"];

/**
 * Домашние по роли: не отказывают, а уводят человека к его домашней
 * («Журналы» и «Сегодня» повара — на «Сегодня» приложения, заведующей — на
 * панель контроля). «Нет доступа» на них не показываем, иначе редирект
 * страницы не успел бы сработать.
 */
export const ROLE_HOME_NAV_HREFS: readonly string[] = ["/dashboard", "/journals", "/control-board", "/team"];

/**
 * Адреса пунктов меню, вкладок и карточек, закрытые человеку по роли и правам
 * (2026-10-29): на них `SectionFrame` вместо страницы показывает «Нет доступа»
 * с подсказкой выбрать раздел в меню. Правило каждого адреса повторяет guard
 * его страницы (тест «правило каждой вкладки и карточки повторяет guard
 * страницы»), поэтому панель не спорит с сервером. Режим точки не в счёт:
 * такие страницы сами объясняют, что нужна «Вся организация»
 * (`PointModeUnavailable`). Адрес, который открывает хоть одно правило (одна
 * страница бывает и вкладкой, и пунктом), закрытым не считается.
 */
export function deniedNavHrefs(actor: NavActor, facts: NavFacts): string[] {
  return closedNavHrefs(actor, facts)
    .filter((href) => !OPEN_TO_ALL_NAV_HREFS.includes(href) && !ROLE_HOME_NAV_HREFS.includes(href))
    .sort();
}

/**
 * Домашние по роли, с которых человека уведут к его домашней (повар на
 * «Журналах» → «Сегодня» приложения): плашка «раздел закрыт» там не
 * показывается — её покажет страница, куда уведут.
 */
export function routedAwayNavHrefs(actor: NavActor, facts: NavFacts): string[] {
  return closedNavHrefs(actor, facts)
    .filter((href) => ROLE_HOME_NAV_HREFS.includes(href))
    .sort();
}

/** Адреса пунктов, вкладок и карточек, которые не открывает ни одно правило (режим точки не в счёт). */
function closedNavHrefs(actor: NavActor, facts: NavFacts): string[] {
  const relaxed: NavFacts = { ...facts, journalsPointMode: false };
  const seen = new Set<string>();
  const allowed = new Set<string>();
  const visit = (href: string, access: NavAccess) => {
    seen.add(href);
    if (navAllows(actor, href, access, relaxed)) allowed.add(href);
  };
  for (const section of NAV_SECTIONS) {
    for (const tab of section.tabs) visit(tab.href, tab.access);
    for (const group of section.menu ?? []) {
      for (const item of group.items) {
        visit(item.href, item.access);
        for (const tab of item.tabs ?? []) visit(tab.href, tab.access);
      }
    }
  }
  for (const card of SETTINGS_CARDS) visit(card.href, card.access);
  return [...seen].filter((href) => !allowed.has(href));
}

/** Открытая страница — закрытый человеку пункт меню (точное совпадение адреса). */
export function isNavHrefDenied(pathname: string, denied: readonly string[] | undefined): boolean {
  if (!denied || denied.length === 0) return false;
  return denied.includes(normalize(pathname));
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
