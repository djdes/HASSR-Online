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
import { canAccessWebPath } from "@/lib/role-access";
import { getRouteTitle } from "@/lib/route-titles";

export type AppSectionGroupId = "work" | "production" | "money" | "settings";

export type AppSectionActor = {
  role?: string | null;
  isRoot?: boolean | null;
  permissionPreset?: string | null;
  orgPresetOverrides?: Record<string, string[]> | null;
};

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
   * Возможность, без которой раздела не видно. Совпадает с проверкой,
   * которую делает сама страница на сервере.
   */
  capability?: Capability;
};

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
  },
  {
    href: "/control-board",
    hint: "Что сделано сегодня и кем",
    icon: "Gauge",
    group: "work",
    capability: "tasks.verify",
  },
  {
    href: "/verifications",
    hint: "Проверить и подтвердить выполненное",
    icon: "BadgeCheck",
    group: "work",
    capability: "tasks.verify",
  },
  {
    href: "/journals-progress",
    hint: "Где отстаём по заполнению",
    icon: "TrendingUp",
    group: "work",
  },
  {
    href: "/team",
    hint: "Кто на смене и чем занят",
    icon: "Users",
    group: "work",
  },
  // ---- Производство --------------------------------------------------
  {
    href: "/batches",
    hint: "Прослеживаемость сырья и готовых блюд",
    icon: "Package",
    group: "production",
  },
  {
    href: "/plans",
    hint: "Что и сколько готовим",
    icon: "CalendarRange",
    group: "production",
  },
  {
    href: "/changes",
    hint: "Новое оборудование, рецептура, поставщик",
    icon: "GitBranch",
    group: "production",
  },
  {
    href: "/losses",
    hint: "Испорченные и просроченные продукты",
    icon: "TrendingDown",
    group: "production",
  },
  {
    href: "/capa",
    hint: "Что нашли и как исправили",
    icon: "AlertTriangle",
    group: "production",
  },
  {
    href: "/competencies",
    hint: "Кто что прошёл и когда повторять",
    icon: "GraduationCap",
    group: "production",
  },
  {
    href: "/orders",
    hint: "Заполнить реквизитами и распечатать",
    icon: "ScrollText",
    group: "production",
  },
  {
    href: "/mercury",
    hint: "Входящие ветеринарные документы",
    icon: "Plug",
    group: "production",
  },
  // ---- Отчёты и деньги -----------------------------------------------
  {
    href: "/reports",
    hint: "Выгрузки в PDF и Excel для проверяющего",
    icon: "FileText",
    group: "money",
    capability: "reports.view",
  },
  {
    href: "/bonuses",
    hint: "Сколько начислено команде за журналы",
    icon: "Coins",
    group: "money",
  },
  {
    href: "/settings/balance",
    hint: "Баллы за отзывы и приглашения",
    icon: "Coins",
    group: "money",
  },
  {
    href: "/ideas",
    hint: "Предложить и проголосовать",
    icon: "Lightbulb",
    group: "money",
  },
  // ---- Настройки ------------------------------------------------------
  {
    href: "/settings",
    label: "Все настройки",
    hint: "Полный список — организация, журналы, интеграции",
    icon: "Settings2",
    group: "settings",
    capability: "admin.full",
  },
  {
    href: "/settings/users",
    hint: "Роли, доступы, приглашения",
    icon: "Users",
    group: "settings",
    capability: "staff.view",
  },
  {
    href: "/settings/equipment",
    hint: "Холодильники, печи, датчики",
    icon: "Wrench",
    group: "settings",
    capability: "admin.full",
  },
  {
    href: "/settings/areas",
    hint: "Производственные зоны и помещения",
    icon: "Building2",
    group: "settings",
    capability: "admin.full",
  },
  {
    href: "/settings/products",
    hint: "Справочник продуктов",
    icon: "Package",
    group: "settings",
    capability: "admin.full",
  },
  {
    href: "/settings/buildings",
    hint: "Точки с адресами и помещения внутри",
    icon: "Building2",
    group: "settings",
    capability: "admin.full",
  },
  {
    href: "/settings/notifications",
    hint: "Telegram-бот, типы оповещений",
    icon: "Bell",
    group: "settings",
    capability: "admin.full",
  },
  {
    href: "/settings/security",
    hint: "История входов, выход со всех устройств",
    icon: "ShieldCheck",
    group: "settings",
  },
];

/** Название раздела: своё, если задано, иначе — из хлебных крошек. */
export function appSectionLabel(section: AppSection): string {
  return section.label ?? getRouteTitle(section.href) ?? section.href;
}

/**
 * Видит ли человек раздел.
 *
 * Две проверки, обе уже существующие:
 *   1. `canAccessWebPath` — тот самый guard, которым `proxy.ts`
 *      разворачивает линейного сотрудника с закрытых разделов;
 *   2. `hasCapability` — та самая возможность, которую проверяет сама
 *      страница (например `/settings` требует `admin.full`).
 */
export function canSeeAppSection(
  actor: AppSectionActor,
  section: AppSection
): boolean {
  if (!canAccessWebPath(actor, section.href)) return false;
  if (section.capability && !hasCapability(actor, section.capability)) {
    return false;
  }
  return true;
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
