/**
 * Разделы кабинета — один список для сайта и мини-приложения.
 *
 * Раньше перечень разделов жил в двух местах: выпадающее меню шапки
 * (`components/layout/header.tsx`) и карточки `/settings`. В
 * мини-приложении разделов не было вовсе, и всё, что не успели
 * перенести, открывалось «в полной версии» — то есть выкидывало
 * человека из приложения.
 *
 * Теперь список один. Мини-приложение показывает страницы сайта в своей
 * оболочке, поэтому и набор пунктов обязан совпадать (П-3), и права —
 * тоже. Новых правил доступа здесь НЕТ: `canSeeAppSection` складывает
 * ровно те же две проверки, что и сайт, — `canAccessWebPath`
 * (её же делает `proxy.ts`) и `hasCapability` (её же делают сами
 * страницы).
 *
 * Иконки лежат строками: модуль читают и серверные компоненты, а функции
 * (какими являются компоненты lucide) через границу RSC не передаются.
 * Соответствие «имя → компонент» держат клиентские компоненты.
 */

import { hasCapability, type Capability } from "@/lib/permission-presets";
import { canAccessWebPath, hasFullWorkspaceAccess } from "@/lib/role-access";
import { getRouteTitle } from "@/lib/route-titles";

export type AppSectionGroupId = "work" | "production" | "money" | "settings";

export type AppSectionActor = {
  role?: string | null;
  isRoot?: boolean | null;
  permissionPreset?: string | null;
  orgPresetOverrides?: Record<string, string[]> | null;
};

/**
 * Какая проверка стоит на самой странице раздела.
 *
 * Значение переписывает фактический guard из `page.tsx`, а не «как
 * задумано»: список разделов обязан показывать ровно то, что человек и
 * правда откроет. Раньше здесь была одна `capability`, и у заведующей
 * половина доступных ей страниц в списке просто не появлялась.
 *
 *   • `webPath`   — своей проверки на странице нет, доступ режет только
 *                   `canAccessWebPath` (тот же guard, что в `proxy.ts`);
 *   • `fullAccess`— страница делает `hasFullWorkspaceAccess(session.user)`
 *                   (руководство: управляющая, заведующая, ROOT);
 *   • `anyOf`     — страница пускает при любой из перечисленных
 *                   возможностей (`hasCapability`).
 */
export type AppSectionAccess =
  | { kind: "webPath" }
  | { kind: "fullAccess" }
  | { kind: "anyOf"; capabilities: Capability[] };

export type AppSection = {
  href: string;
  /** Название. По умолчанию берётся из `route-titles.ts`. */
  label?: string;
  /** Одна строка «что внутри» — человек не должен гадать. */
  hint: string;
  /** Имя иконки lucide-react. */
  icon: string;
  group: AppSectionGroupId;
  /**
   * Проверка, которую делает сама страница. Обязательна: раздел без
   * явного правила легко расходится со своей страницей.
   */
  access: AppSectionAccess;
};

/** Короткая запись для `access: { kind: "anyOf", … }`. */
function anyOf(...capabilities: Capability[]): AppSectionAccess {
  return { kind: "anyOf", capabilities };
}

/** Своей проверки на странице нет — пускает `canAccessWebPath`. */
const WEB_PATH: AppSectionAccess = { kind: "webPath" };
/** `hasFullWorkspaceAccess(session.user)` в самой странице. */
const FULL_ACCESS: AppSectionAccess = { kind: "fullAccess" };

export const APP_SECTION_GROUPS: {
  id: AppSectionGroupId;
  title: string;
  subtitle: string;
}[] = [
  { id: "work", title: "Работа", subtitle: "Журналы, проверка, команда" },
  {
    id: "production",
    title: "Производство",
    subtitle: "Партии, план, отклонения, обучение",
  },
  {
    id: "money",
    title: "Отчёты и деньги",
    subtitle: "Выгрузки, премии, баланс, идеи",
  },
  {
    id: "settings",
    title: "Настройки",
    subtitle: "Организация, сотрудники, оборудование, уведомления",
  },
];

/**
 * Полный список разделов. Порядок внутри группы — порядок показа.
 *
 * Первые десять пунктов (от «Журналов» до «Идей») повторяют меню шапки
 * сайта один в один: его собирает `headerNavSections()` ниже, чтобы
 * список нельзя было поменять в одном месте и забыть про другое.
 */
export const APP_SECTIONS: AppSection[] = [
  // ---- Работа --------------------------------------------------------
  {
    href: "/journals",
    hint: "Заполнить и посмотреть записи",
    icon: "ClipboardList",
    group: "work",
    // Страница без `journals.view` уводит на «Контрольную доску» или
    // «Сегодня» — значит и пункта у такого человека быть не должно.
    access: anyOf("journals.view"),
  },
  {
    href: "/control-board",
    hint: "Что сделано сегодня и кем",
    icon: "Gauge",
    group: "work",
    access: anyOf("tasks.verify", "admin.full"),
  },
  {
    href: "/verifications",
    hint: "Проверить и подтвердить выполненное",
    icon: "BadgeCheck",
    group: "work",
    access: anyOf("tasks.verify"),
  },
  {
    href: "/journals-progress",
    hint: "Где отстаём по заполнению",
    icon: "TrendingUp",
    group: "work",
    access: anyOf("tasks.verify", "admin.full"),
  },
  {
    href: "/team",
    hint: "Кто на смене и чем занят",
    icon: "Users",
    group: "work",
    access: anyOf("staff.view", "tasks.verify", "admin.full"),
  },
  {
    href: "/settings/schedule",
    hint: "Кто в какой день выходит",
    icon: "CalendarRange",
    group: "work",
    access: FULL_ACCESS,
  },
  // ---- Производство --------------------------------------------------
  {
    href: "/batches",
    hint: "Прослеживаемость сырья и готовых блюд",
    icon: "Package",
    group: "production",
    access: WEB_PATH,
  },
  {
    href: "/plans",
    hint: "Что и сколько готовим",
    icon: "CalendarRange",
    group: "production",
    access: WEB_PATH,
  },
  {
    href: "/changes",
    hint: "Новое оборудование, рецептура, поставщик",
    icon: "GitBranch",
    group: "production",
    access: WEB_PATH,
  },
  {
    href: "/losses",
    hint: "Испорченные и просроченные продукты",
    icon: "TrendingDown",
    group: "production",
    access: WEB_PATH,
  },
  {
    href: "/capa",
    hint: "Что нашли и как исправили",
    icon: "AlertTriangle",
    group: "production",
    access: WEB_PATH,
  },
  {
    href: "/competencies",
    hint: "Кто что прошёл и когда повторять",
    icon: "GraduationCap",
    group: "production",
    access: WEB_PATH,
  },
  {
    href: "/orders",
    hint: "Заполнить реквизитами и распечатать",
    icon: "ScrollText",
    group: "production",
    access: WEB_PATH,
  },
  {
    href: "/mercury",
    hint: "Входящие ветеринарные документы",
    icon: "Plug",
    group: "production",
    access: WEB_PATH,
  },
  {
    href: "/sanpin",
    hint: "Требования СанПиН простыми словами",
    icon: "BookOpen",
    group: "production",
    // `page.tsx`: только `await requireAuth()` — открыта всем вошедшим.
    access: WEB_PATH,
  },
  // ---- Отчёты и деньги -----------------------------------------------
  {
    href: "/reports",
    hint: "Выгрузки в PDF и Excel для проверяющего",
    icon: "FileText",
    group: "money",
    // Страница проверяет `hasFullWorkspaceAccess`, а НЕ `reports.view`:
    // заведующая её открывает, и раньше пункта у неё не было.
    access: FULL_ACCESS,
  },
  {
    href: "/bonuses",
    hint: "Сколько начислено команде за журналы",
    icon: "Coins",
    group: "money",
    access: FULL_ACCESS,
  },
  {
    href: "/settings/balance",
    hint: "Баллы за отзывы и приглашения",
    icon: "Coins",
    group: "money",
    // Единственный раздел настроек, открытый линейному сотруднику:
    // отзыв за баллы пишет и повар (см. `role-access.ts`).
    access: WEB_PATH,
  },
  {
    href: "/ideas",
    hint: "Предложить и проголосовать",
    icon: "Lightbulb",
    group: "money",
    access: FULL_ACCESS,
  },
  // ---- Настройки ------------------------------------------------------
  {
    href: "/settings",
    label: "Все настройки",
    hint: "Полный список — организация, журналы, интеграции",
    icon: "Settings2",
    group: "settings",
    // Хаб настроек — единственная страница, которая и правда просит
    // `admin.full`: заведующую он уводит на «Контрольную доску».
    access: anyOf("admin.full"),
  },
  {
    href: "/settings/users",
    hint: "Роли, доступы, приглашения",
    icon: "Users",
    group: "settings",
    // Страница пускает по роли руководства, а не по `staff.view`.
    access: FULL_ACCESS,
  },
  {
    href: "/settings/journals",
    hint: "Какие журналы ведёт заведение",
    icon: "ClipboardList",
    group: "settings",
    // `page.tsx`: `hasFullWorkspaceAccess(session.user)`, иначе /dashboard.
    // Страница заведующей открывается и работает (PATCH проходит), а
    // пункта в разделах у неё не было — список расходился с правдой.
    access: FULL_ACCESS,
  },
  {
    href: "/settings/permissions",
    hint: "Кто что может делать в кабинете",
    icon: "ShieldCheck",
    group: "settings",
    // `page.tsx`: `sessionHasPermission(session, "settings.permissions")`.
    // Это право лежит в БД и проверяется асинхронно, а список разделов
    // считается на месте. Ближайшее синхронное соответствие —
    // управленческая роль: линейному персоналу право не выдаётся по
    // умолчанию, и `canAccessWebPath` его сюда всё равно не пускает.
    access: FULL_ACCESS,
  },
  {
    href: "/settings/integrations/tasksflow",
    label: "Интеграция с TasksFlow",
    hint: "Связка сотрудников и задач с TasksFlow",
    icon: "Plug",
    group: "settings",
    // `page.tsx`: `hasFullWorkspaceAccess(session.user)`, иначе /journals.
    access: FULL_ACCESS,
  },
  {
    href: "/settings/equipment",
    hint: "Холодильники, печи, датчики",
    icon: "Wrench",
    group: "settings",
    access: WEB_PATH,
  },
  {
    href: "/settings/areas",
    hint: "Производственные зоны и помещения",
    icon: "Building2",
    group: "settings",
    access: WEB_PATH,
  },
  {
    href: "/settings/products",
    // Подсказка повторяла название пункта слово в слово и ничего
    // человеку не сообщала.
    hint: "Названия, сроки годности и условия хранения",
    icon: "Package",
    group: "settings",
    access: WEB_PATH,
  },
  {
    href: "/settings/buildings",
    hint: "Точки с адресами и помещения внутри",
    icon: "Building2",
    group: "settings",
    access: FULL_ACCESS,
  },
  {
    href: "/settings/notifications",
    hint: "Telegram-бот, типы оповещений",
    icon: "Bell",
    group: "settings",
    access: WEB_PATH,
  },
  {
    href: "/settings/audit",
    hint: "Кто что менял в журналах и настройках",
    icon: "ScrollText",
    group: "settings",
    // `requireRole(["owner"])` здесь давно снят — страница проверяет
    // `hasFullWorkspaceAccess`, и заведующая её открывает.
    access: FULL_ACCESS,
  },
  {
    href: "/settings/security",
    hint: "История входов, выход со всех устройств",
    icon: "ShieldCheck",
    group: "settings",
    access: WEB_PATH,
  },
  {
    href: "/settings/subscription",
    hint: "Тариф, счета и автопродление",
    icon: "CreditCard",
    group: "money",
    // `page.tsx`: `hasFullWorkspaceAccess(session.user)`, иначе /dashboard.
    access: FULL_ACCESS,
  },
  {
    href: "/settings/appearance",
    hint: "Тема, логотип и цвета кабинета",
    icon: "Palette",
    group: "settings",
    // `page.tsx`: `hasCapability(session.user, "admin.full")`, иначе /journals.
    access: anyOf("admin.full"),
  },
  {
    href: "/dashboard/catch-up",
    hint: "Заполнить пропущенные дни задним числом",
    icon: "History",
    group: "work",
    // `page.tsx`: `hasFullWorkspaceAccess(session.user)`, иначе /dashboard.
    access: FULL_ACCESS,
  },
  {
    href: "/dashboard/compliance-audit",
    hint: "12 проверок и что починить до прихода инспектора",
    icon: "ShieldCheck",
    group: "work",
    // `page.tsx`: `hasCapability(session.user, "admin.full")`, иначе /dashboard.
    access: anyOf("admin.full"),
  },
];

/** Название раздела: своё, если задано, иначе — из хлебных крошек. */
export function appSectionLabel(section: AppSection): string {
  return section.label ?? getRouteTitle(section.href) ?? section.href;
}

/**
 * Видит ли человек раздел.
 *
 * Новых правил доступа здесь нет — повторяются ровно те, что стоят на
 * самих страницах:
 *   1. `canAccessWebPath` — guard, которым `proxy.ts` разворачивает
 *      линейного сотрудника с закрытых разделов;
 *   2. `section.access` — то, что страница проверяет у себя внутри.
 *
 * Правило одно на оба места: список разделов должен показывать ровно
 * то, что откроется. Пункт, ведущий на редирект, — это обман.
 */
export function canSeeAppSection(
  actor: AppSectionActor,
  section: AppSection
): boolean {
  if (!canAccessWebPath(actor, section.href)) return false;
  switch (section.access.kind) {
    case "webPath":
      return true;
    case "fullAccess":
      return hasFullWorkspaceAccess(actor);
    case "anyOf":
      return section.access.capabilities.some((capability) =>
        hasCapability(actor, capability)
      );
  }
}

export function visibleAppSections(actor: AppSectionActor): AppSection[] {
  return APP_SECTIONS.filter((section) => canSeeAppSection(actor, section));
}

export type AppSectionGroup = {
  id: AppSectionGroupId;
  title: string;
  subtitle: string;
  sections: AppSection[];
};

/** Разделы, сгруппированные для экрана «Все разделы». Пустые группы отброшены. */
export function visibleAppSectionGroups(
  actor: AppSectionActor
): AppSectionGroup[] {
  const visible = visibleAppSections(actor);
  return APP_SECTION_GROUPS.map((group) => ({
    ...group,
    sections: visible.filter((section) => section.group === group.id),
  })).filter((group) => group.sections.length > 0);
}

/**
 * Пункты выпадающего меню в шапке сайта — подмножество того же списка.
 *
 * Порядок зафиксирован здесь, чтобы шапка не завела свою копию перечня.
 */
const HEADER_NAV_HREFS = [
  "/journals",
  "/batches",
  "/plans",
  "/changes",
  "/losses",
  "/competencies",
  "/capa",
  "/reports",
  "/bonuses",
  "/ideas",
] as const;

const HEADER_NAV_LABELS: Record<string, string> = {
  "/plans": "Производственный план",
  "/ideas": "Идеи",
};

export function headerNavSections(): {
  href: string;
  label: string;
  icon: string;
}[] {
  return HEADER_NAV_HREFS.map((href) => {
    const section = APP_SECTIONS.find((item) => item.href === href);
    if (!section) throw new Error(`Нет раздела ${href} в APP_SECTIONS`);
    return {
      href,
      label: HEADER_NAV_LABELS[href] ?? appSectionLabel(section),
      icon: section.icon,
    };
  });
}
