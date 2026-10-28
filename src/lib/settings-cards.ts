/**
 * Карточки настроек. Раньше они жили одной стеной на хабе `/settings`
 * (~50 штук в семи группах); с 2026-10-16 хаба нет — каждая карточка
 * живёт в своём разделе меню (`lib/app-nav.ts`): на странице «Настройка
 * журналов» или на «Остальном». С 2026-10-17 карточки сотрудников и точек
 * стали пунктами меню своих разделов (у раздела своё левое меню).
 *
 * Название и описание — в каталогах `settingsManagement.home.cards.<id>`.
 * Иконка — строкой: модуль читают и сервер, и клиент.
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
  icon: string;
  iconClass: string;
  bgClass: string;
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

const INDIGO = { iconClass: "text-[#3848c7]", bgClass: "bg-[#eef1ff]" };
const BRIGHT = { iconClass: "text-[#5566f6]", bgClass: "bg-[#eef1ff]" };
const VIOLET = { iconClass: "text-[#7a5cff]", bgClass: "bg-[#f0edff]" };
const SKY = { iconClass: "text-[#0ea5e9]", bgClass: "bg-[#e8f7ff]" };
const AMBER = { iconClass: "text-[#f59e0b]", bgClass: "bg-[#fff8eb]" };
const MINT = { iconClass: "text-[#10b981]", bgClass: "bg-[#ecfdf5]" };

export const SETTINGS_CARDS: SettingsCard[] = [
  // ---- Журналы → Настройка журналов: журналы --------------------------
  { id: "settings_journals", href: "/settings/journals", icon: "ClipboardList", iconClass: "text-[#d946ef]", bgClass: "bg-[#fdf4ff]", section: "journals", group: "journals", access: FULL_ACCESS },
  { id: "settings_journal_periods", href: "/settings/journal-periods", icon: "CalendarRange", ...MINT, section: "journals", group: "journals", access: FULL_ACCESS },
  { id: "settings_auto_journals", href: "/settings/auto-journals", icon: "Sparkles", ...BRIGHT, section: "journals", group: "journals", access: FULL_ACCESS, requiresAutomation: "autoCreate" },
  { id: "settings_compliance", href: "/settings/compliance", icon: "ShieldCheck", ...INDIGO, section: "journals", group: "journals", access: FULL_ACCESS },
  {
    id: "settings_journal_pipelines",
    href: "/settings/journal-pipelines",
    icon: "ListChecks",
    ...BRIGHT,
    section: "journals",
    group: "journals",
    access: ADMIN,
    match: ["/settings/journal-pipelines-tree", "/settings/journal-guides-tree"],
  },
  { id: "settings_journal_checklists", href: "/settings/journal-checklists", icon: "ListChecks", iconClass: "text-emerald-700", bgClass: "bg-emerald-100", section: "journals", group: "journals", access: ADMIN },

  // ---- Журналы → Настройка журналов: раздача задач ---------------------
  { id: "settings_journal_task_mode", href: "/settings/journal-task-mode", icon: "Settings2", ...INDIGO, section: "journals", group: "tasks", access: FULL_ACCESS },
  { id: "settings_journal_flow", href: "/settings/journal-flow", icon: "Shuffle", ...VIOLET, section: "journals", group: "tasks", access: ADMIN },
  { id: "settings_task_visibility", href: "/settings/task-visibility", icon: "Eye", ...INDIGO, section: "journals", group: "tasks", access: ADMIN },
  { id: "settings_journal_difficulty", href: "/settings/journal-difficulty", icon: "Gauge", iconClass: "text-[#a16d32]", bgClass: "bg-[#fff8eb]", section: "journals", group: "tasks", access: ADMIN },
  { id: "settings_journal_bonuses", href: "/settings/journal-bonuses", icon: "Coins", iconClass: "text-[#b45309]", bgClass: "bg-[#fef3c7]", section: "journals", group: "tasks", access: FULL_ACCESS },

  // ---- Остальное: работа ----------------------------------------------
  { id: "plans", href: "/plans", icon: "CalendarRange", ...MINT, section: "more", group: "work", access: STAFF_PATH },
  { id: "capa", href: "/capa", icon: "AlertTriangle", iconClass: "text-[#a13a32]", bgClass: "bg-[#fff4f2]", section: "more", group: "work", access: STAFF_PATH },
  { id: "reports", href: "/reports", icon: "FileText", ...INDIGO, section: "more", group: "work", access: FULL_ACCESS },
  { id: "ideas", href: "/ideas", icon: "Lightbulb", ...AMBER, section: "more", group: "work", access: FULL_ACCESS },
  { id: "mercury", href: "/mercury", icon: "Plug", ...SKY, section: "more", group: "work", access: STAFF_PATH },
  // Страницы без места в новом меню (владелец, 2026-10-28: «всё, что пока не
  // распределили, — в „Остальное“, потом разнесём по назначению»).
  { id: "batches", href: "/batches", icon: "Package", ...AMBER, section: "more", group: "work", access: STAFF_PATH },
  { id: "losses", href: "/losses", icon: "TrendingDown", iconClass: "text-[#c2410c]", bgClass: "bg-[#fff7ed]", section: "more", group: "work", access: STAFF_PATH },
  { id: "changes", href: "/changes", icon: "GitBranch", ...VIOLET, section: "more", group: "work", access: STAFF_PATH },
  { id: "competencies", href: "/competencies", icon: "GraduationCap", ...MINT, section: "more", group: "work", access: STAFF_PATH },
  { id: "bonuses", href: "/bonuses", icon: "Coins", iconClass: "text-[#b45309]", bgClass: "bg-[#fef3c7]", section: "more", group: "work", access: FULL_ACCESS },

  // ---- Остальное: подключения -----------------------------------------
  { id: "settings_notifications", href: "/settings/notifications", icon: "Bell", ...MINT, section: "more", group: "connections", access: STAFF_PATH },
  { id: "settings_integrations_tasksflow", href: "/settings/integrations/tasksflow", icon: "Plug", ...SKY, section: "more", group: "connections", access: FULL_ACCESS },
  { id: "settings_integrations_mercury", href: "/settings/integrations/mercury", icon: "Plug", ...SKY, section: "more", group: "connections", access: FULL_ACCESS },
  { id: "settings_webhooks", href: "/settings/webhooks", icon: "Webhook", ...INDIGO, section: "more", group: "connections", access: FULL_ACCESS },
  { id: "settings_calendar", href: "/settings/calendar", icon: "CalendarDays", ...INDIGO, section: "more", group: "connections", access: FULL_ACCESS },
  { id: "settings_backup", href: "/settings/backup", icon: "CloudUpload", ...INDIGO, section: "more", group: "connections", access: FULL_ACCESS },
  { id: "settings_accounting", href: "/settings/accounting", icon: "FileSpreadsheet", ...INDIGO, section: "more", group: "connections", access: FULL_ACCESS },
  { id: "settings_api", href: "/settings/api", icon: "KeyRound", iconClass: "text-[#8b5cf6]", bgClass: "bg-[#f5f3ff]", section: "more", group: "connections", access: FULL_ACCESS },

  // ---- Остальное: прочее ----------------------------------------------
  { id: "settings_audit", href: "/settings/audit", icon: "ScrollText", iconClass: "text-[#6b7280]", bgClass: "bg-[#f3f4f6]", section: "more", group: "other", access: FULL_ACCESS },
  { id: "settings_security", href: "/settings/security", icon: "ShieldCheck", iconClass: "text-[#a13a32]", bgClass: "bg-[#fff4f2]", section: "more", group: "other", access: STAFF_PATH },
  { id: "settings_experimental", href: "/settings/experimental", icon: "FlaskConical", iconClass: "text-[#7a5cff]", bgClass: "bg-[#f5f6ff]", section: "more", group: "other", access: FULL_ACCESS },
  { id: "settings_partner", href: "/settings/partner", icon: "Award", iconClass: "text-[#9a4a06]", bgClass: "bg-[#fff7ed]", section: "more", group: "other", access: FULL_ACCESS },
  { id: "settings_consultant", href: "/settings/consultant", icon: "Handshake", ...INDIGO, section: "more", group: "other", access: FULL_ACCESS },
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
