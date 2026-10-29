/**
 * Карточки настроек. Раньше они жили одной стеной на хабе `/settings`
 * (~50 штук в семи группах); с 2026-10-16 хаба нет — каждая карточка
 * живёт в своём разделе меню (`lib/app-nav.ts`): на странице «Настройка
 * журналов» или на «Остальном». С 2026-10-17 карточки сотрудников и точек
 * стали пунктами меню своих разделов (у раздела своё левое меню).
 *
 * Название и описание — в каталогах `settingsManagement.home.cards.<id>`.
 * Иконка — строкой: модуль читают и сервер, и клиент. Цвет плашки —
 * по иконке (`nav-tones.ts`), как у пунктов меню.
 */

import type { NavAccess } from "@/lib/app-nav";
import type { AutomationFeature } from "@/lib/journal-controls";
import type { MessageContract } from "@/i18n/message-contract";

/** Ключ карточки = ключ её текстов в каталоге. */
export type SettingsCardId = keyof MessageContract["settingsManagement"]["home"]["cards"];

export type SettingsCardSection = "journals" | "more";

/** Группа на странице: заголовок `navigation.shell.groups.<group>`. */
export type SettingsCardGroup = "journals" | "tasks" | "work" | "connections" | "other";

export type SettingsCard = {
  /** Ключ текстов `settingsManagement.home.cards.<id>`. */
  id: SettingsCardId;
  href: string;
  /** Имя иконки lucide (`nav-icons.ts`); цвет плашки — по нему же (`nav-tones.ts`). */
  icon: string;
  section: SettingsCardSection;
  group: SettingsCardGroup;
  /** Повторяет guard страницы (сверяет `app-nav.test.ts`). */
  access: NavAccess;
  /** Другие пути той же настройки (редакторы, подстраницы). */
  match?: string[];
  /** Карточка видна, только если эта часть автоматики выбрана в спецрежиме. */
  requiresAutomation?: AutomationFeature;
};

const STAFF_PATH: NavAccess = { kind: "staffPath" };
const FULL_ACCESS: NavAccess = { kind: "fullAccess" };
const ADMIN: NavAccess = { kind: "anyOf", capabilities: ["admin.full"] };

export const SETTINGS_CARDS: SettingsCard[] = [
  // ---- Журналы → Настройка журналов: журналы --------------------------
  { id: "settings_journals", href: "/settings/journals", icon: "ClipboardList", section: "journals", group: "journals", access: FULL_ACCESS },
  { id: "settings_journal_periods", href: "/settings/journal-periods", icon: "CalendarRange", section: "journals", group: "journals", access: FULL_ACCESS },
  { id: "settings_auto_journals", href: "/settings/auto-journals", icon: "Sparkles", section: "journals", group: "journals", access: FULL_ACCESS, requiresAutomation: "autoCreate" },
  { id: "settings_compliance", href: "/settings/compliance", icon: "ShieldCheck", section: "journals", group: "journals", access: FULL_ACCESS },
  {
    id: "settings_journal_pipelines",
    href: "/settings/journal-pipelines",
    icon: "ListChecks",
    section: "journals",
    group: "journals",
    access: ADMIN,
    match: ["/settings/journal-pipelines-tree", "/settings/journal-guides-tree"],
  },
  { id: "settings_journal_checklists", href: "/settings/journal-checklists", icon: "ListChecks", section: "journals", group: "journals", access: ADMIN },

  // ---- Журналы → Настройка журналов: раздача задач ---------------------
  { id: "settings_journal_task_mode", href: "/settings/journal-task-mode", icon: "Settings2", section: "journals", group: "tasks", access: FULL_ACCESS },
  { id: "settings_journal_flow", href: "/settings/journal-flow", icon: "Shuffle", section: "journals", group: "tasks", access: ADMIN },
  { id: "settings_task_visibility", href: "/settings/task-visibility", icon: "Eye", section: "journals", group: "tasks", access: ADMIN },
  { id: "settings_journal_difficulty", href: "/settings/journal-difficulty", icon: "Gauge", section: "journals", group: "tasks", access: ADMIN },
  { id: "settings_journal_bonuses", href: "/settings/journal-bonuses", icon: "Coins", section: "journals", group: "tasks", access: FULL_ACCESS },

  // ---- Остальное: работа ----------------------------------------------
  { id: "plans", href: "/plans", icon: "CalendarRange", section: "more", group: "work", access: STAFF_PATH },
  { id: "capa", href: "/capa", icon: "AlertTriangle", section: "more", group: "work", access: STAFF_PATH },
  { id: "reports", href: "/reports", icon: "FileText", section: "more", group: "work", access: FULL_ACCESS },
  { id: "ideas", href: "/ideas", icon: "Lightbulb", section: "more", group: "work", access: FULL_ACCESS },
  { id: "mercury", href: "/mercury", icon: "Plug", section: "more", group: "work", access: STAFF_PATH },
  // Страницы без места в новом меню (владелец, 2026-10-28: «всё, что пока не
  // распределили, — в „Остальное“, потом разнесём по назначению»).
  { id: "batches", href: "/batches", icon: "Package", section: "more", group: "work", access: STAFF_PATH },
  { id: "losses", href: "/losses", icon: "TrendingDown", section: "more", group: "work", access: STAFF_PATH },
  { id: "changes", href: "/changes", icon: "GitBranch", section: "more", group: "work", access: STAFF_PATH },
  { id: "competencies", href: "/competencies", icon: "GraduationCap", section: "more", group: "work", access: STAFF_PATH },
  { id: "bonuses", href: "/bonuses", icon: "Coins", section: "more", group: "work", access: FULL_ACCESS },

  // ---- Остальное: подключения -----------------------------------------
  { id: "settings_notifications", href: "/settings/notifications", icon: "Bell", section: "more", group: "connections", access: STAFF_PATH },
  { id: "settings_integrations_tasksflow", href: "/settings/integrations/tasksflow", icon: "Plug", section: "more", group: "connections", access: FULL_ACCESS },
  { id: "settings_integrations_mercury", href: "/settings/integrations/mercury", icon: "Plug", section: "more", group: "connections", access: FULL_ACCESS },
  { id: "settings_webhooks", href: "/settings/webhooks", icon: "Webhook", section: "more", group: "connections", access: FULL_ACCESS },
  { id: "settings_calendar", href: "/settings/calendar", icon: "CalendarDays", section: "more", group: "connections", access: FULL_ACCESS },
  { id: "settings_backup", href: "/settings/backup", icon: "CloudUpload", section: "more", group: "connections", access: FULL_ACCESS },
  { id: "settings_accounting", href: "/settings/accounting", icon: "FileSpreadsheet", section: "more", group: "connections", access: FULL_ACCESS },
  { id: "settings_api", href: "/settings/api", icon: "KeyRound", section: "more", group: "connections", access: FULL_ACCESS },

  // ---- Остальное: прочее ----------------------------------------------
  { id: "settings_audit", href: "/settings/audit", icon: "ScrollText", section: "more", group: "other", access: FULL_ACCESS },
  { id: "settings_security", href: "/settings/security", icon: "ShieldCheck", section: "more", group: "other", access: STAFF_PATH },
  { id: "settings_experimental", href: "/settings/experimental", icon: "FlaskConical", section: "more", group: "other", access: FULL_ACCESS },
  { id: "settings_partner", href: "/settings/partner", icon: "Award", section: "more", group: "other", access: FULL_ACCESS },
  { id: "settings_consultant", href: "/settings/consultant", icon: "Handshake", section: "more", group: "other", access: FULL_ACCESS },
];

/** Карточки раздела (и группы) в порядке списка. */
export function settingsCardsFor(
  section: SettingsCardSection,
  group?: SettingsCardGroup,
): SettingsCard[] {
  return SETTINGS_CARDS.filter(
    (card) => card.section === section && (!group || card.group === group),
  );
}

/** Группы раздела в порядке первого появления. */
export function settingsCardGroups(section: SettingsCardSection): SettingsCardGroup[] {
  const groups: SettingsCardGroup[] = [];
  for (const card of settingsCardsFor(section)) {
    if (!groups.includes(card.group)) groups.push(card.group);
  }
  return groups;
}
