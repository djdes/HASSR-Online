import type { MessageContract } from "@/i18n/message-contract";
import type { Locale } from "@/i18n/locales";

export type RouteTitleKey = keyof MessageContract["navigation"]["routes"];
export type RouteTitleTranslator = (key: RouteTitleKey) => string;

// Stable path identity; Russian compatibility captions below are also search aliases.
export const ROUTE_TITLE_KEYS = {
  "/batches": "batches",
  "/batches/new": "batches_new",
  "/bonuses": "bonuses",
  "/capa": "capa",
  "/ideas": "ideas",
  "/capa/new": "capa_new",
  "/changes": "changes",
  "/changes/new": "changes_new",
  "/competencies": "competencies",
  "/control-board": "control_board",
  "/dashboard": "dashboard",
  "/dashboard/catch-up": "dashboard_catch_up",
  "/dashboard/compliance-audit": "dashboard_compliance_audit",
  "/equipment-fill": "equipment_fill",
  "/room-fill": "room_fill",
  "/journals": "journals",
  "/orders": "orders",
  "/journals-progress": "journals_progress",
  "/journals/new": "journals_new",
  "/journals/traceability": "journals_traceability",
  "/losses": "losses",
  "/losses/new": "losses_new",
  "/plans": "plans",
  "/plans/new": "plans_new",
  "/reports": "reports",
  "/reports/by-user": "reports_by_user",
  "/sanpin": "sanpin",
  "/settings": "settings",
  "/settings/accounting": "settings_accounting",
  "/settings/api": "settings_api",
  "/settings/areas": "settings_areas",
  "/settings/audit": "settings_audit",
  "/settings/auto-journals": "settings_auto_journals",
  "/settings/backup": "settings_backup",
  "/settings/appearance": "settings_appearance",
  "/settings/security": "settings_security",
  "/settings/calendar": "settings_calendar",
  "/settings/webhooks": "settings_webhooks",
  "/settings/balance": "settings_balance",
  "/settings/buildings": "settings_buildings",
  "/settings/compliance": "settings_compliance",
  "/settings/consultant": "settings_consultant",
  "/settings/equipment": "settings_equipment",
  "/settings/equipment/qr-sheet": "settings_equipment_qr_sheet",
  "/settings/qr-posters": "settings_qr_posters",
  "/settings/experimental": "settings_experimental",
  "/settings/inspector-portal": "settings_inspector_portal",
  "/settings/integrations/tasksflow": "settings_integrations_tasksflow",
  "/settings/integrations/mercury": "settings_integrations_mercury",
  "/mercury": "mercury",
  "/settings/journal-access": "settings_journal_access",
  "/settings/journal-bonuses": "settings_journal_bonuses",
  "/settings/journal-checklists": "settings_journal_checklists",
  "/settings/journal-difficulty": "settings_journal_difficulty",
  "/settings/journal-flow": "settings_journal_flow",
  "/settings/journal-guides-tree": "settings_journal_guides_tree",
  "/settings/journal-periods": "settings_journal_periods",
  "/settings/journal-pipelines": "settings_journal_pipelines",
  "/settings/journal-pipelines-tree": "settings_journal_pipelines_tree",
  "/settings/journal-responsibles": "settings_journal_responsibles",
  "/settings/journal-task-mode": "settings_journal_task_mode",
  "/settings/journals": "settings_journals",
  "/settings/journals-by-position": "settings_journals_by_position",
  "/settings/names": "settings_names",
  "/settings/journals/paper": "settings_journals_paper",
  "/settings/notifications": "settings_notifications",
  "/settings/onboarding": "settings_onboarding",
  "/settings/onboarding-template": "settings_onboarding_template",
  "/settings/onboarding/advanced": "settings_onboarding_advanced",
  "/settings/organization": "settings_organization",
  "/settings/partner": "settings_partner",
  "/settings/permissions": "settings_permissions",
  "/settings/phone": "settings_phone",
  "/settings/position-staff-visibility": "settings_position_staff_visibility",
  "/settings/print-agent": "settings_print_agent",
  "/settings/products": "settings_products",
  "/settings/role-presets": "settings_role_presets",
  "/settings/schedule": "settings_schedule",
  "/settings/staff-hierarchy": "settings_staff_hierarchy",
  "/settings/services": "settings_services",
  "/settings/subscription": "settings_subscription",
  "/settings/task-visibility": "settings_task_visibility",
  "/settings/kiosk": "settings_kiosk",
  "/settings/master-cabinet": "settings_master_cabinet",
  "/settings/users": "settings_users",
  "/settings/users/invite": "settings_users_invite",
  "/settings/workload-balance": "settings_workload_balance",
  "/staff": "staff",
  "/task-fill": "task_fill",
  "/tasks": "tasks",
  "/team": "team",
  "/verifications": "verifications",
  "/inspection": "inspection",
  "/production-control": "production_control",
  "/more": "more",
  "/knowledge": "knowledge",
  "/checklists": "checklists",
  "/settings/staff-health": "settings_staff_health",
  "/settings/sections/journals": "settings_sections_journals",
  "/settings/sections/staff": "settings_sections_staff",
  "/settings/sections/points": "settings_sections_points"
} as const satisfies Record<string, RouteTitleKey>;

/**
 * Человеческие названия маршрутов кабинета — для хлебных крошек и кнопки
 * «Назад» (`components/layout/page-nav.tsx`).
 *
 * Это единственный источник подписей: карточки `/settings` берут `title`
 * отсюда же (`settings/page.tsx`), поэтому крошка и карточка не могут
 * разъехаться. Динамические сегменты (`[id]`, `[code]`) здесь не живут —
 * их подписи страницы кладут через `<PageCrumbs>`.
 */
export const ROUTE_TITLES: Record<string, string> = {
  "/batches": "Партии",
  "/batches/new": "Новая партия",
  "/bonuses": "Премии",
  "/capa": "Нарушения",
  "/ideas": "Идеи и голосование",
  "/capa/new": "Новое нарушение",
  "/changes": "Изменения",
  "/changes/new": "Новое изменение",
  "/competencies": "Компетенции",
  "/control-board": "Панель контроля",
  "/dashboard": "Сегодня",
  "/dashboard/catch-up": "Догнать пропуски",
  "/dashboard/compliance-audit": "Готовность к проверке",
  "/equipment-fill": "Заполнение оборудования",
  "/room-fill": "Замер температуры и влажности",
  "/journals": "Журналы",
  "/orders": "Приказы",
  "/journals-progress": "Прогресс по журналам",
  "/journals/new": "Новый журнал",
  "/journals/traceability": "Прослеживаемость",
  "/losses": "Потери",
  "/losses/new": "Новая потеря",
  "/plans": "Производственный план",
  "/plans/new": "Новый план",
  "/reports": "Отчёты",
  "/reports/by-user": "Отчёт по сотруднику",
  "/sanpin": "Справочник СанПиН",
  "/settings": "Настройки",
  "/settings/accounting": "Бухгалтерия",
  "/settings/api": "API интеграций",
  "/settings/areas": "Цеха и участки",
  "/settings/audit": "Журнал действий",
  "/settings/auto-journals": "Автосоздание журналов",
  "/settings/backup": "Авто-бэкап на Я.Диск",
  "/settings/appearance": "Внешний вид",
  "/settings/security": "Безопасность",
  "/settings/calendar": "Календарь",
  "/settings/webhooks": "Вебхуки",
  "/settings/balance": "Баланс и бонусы",
  "/settings/buildings": "Точки и помещения",
  "/settings/compliance": "Строгость журналов",
  "/settings/consultant": "Консультант",
  "/settings/equipment": "Оборудование",
  "/settings/equipment/qr-sheet": "QR-наклейки оборудования",
  "/settings/qr-posters": "QR-коды",
  "/settings/experimental": "Бета-функции",
  "/settings/inspector-portal": "Портал инспектора",
  "/settings/integrations/tasksflow": "TasksFlow",
  "/settings/integrations/mercury": "ФГИС «Меркурий»",
  "/mercury": "Входящие ВСД",
  "/settings/journal-access": "Журналы для сотрудников",
  "/settings/journal-bonuses": "Премии за журналы",
  "/settings/journal-checklists": "Чек-листы для журналов",
  "/settings/journal-difficulty": "Сложность журналов",
  "/settings/journal-flow": "Кто забирает задачу",
  "/settings/journal-guides-tree": "Гайды по журналам",
  "/settings/journal-periods": "Периоды журналов",
  "/settings/journal-pipelines": "Пошаговые инструкции журналов",
  "/settings/journal-pipelines-tree": "Пошаговые сценарии",
  "/settings/journal-responsibles": "Ответственные за журналы",
  "/settings/journal-task-mode": "Раздача и проверка задач",
  "/settings/journals": "Набор журналов",
  "/settings/journals-by-position": "Матрица «должность × журнал»",
  "/settings/names": "Названия",
  "/settings/journals/paper": "Бумажные журналы",
  "/settings/notifications": "Уведомления",
  "/settings/onboarding": "Быстрая настройка",
  "/settings/onboarding-template": "Шаблоны заведений",
  "/settings/onboarding/advanced": "Продвинутая настройка",
  "/settings/organization": "Информация об организации",
  "/settings/partner": "Стать партнёром",
  "/settings/permissions": "Права доступа",
  "/settings/phone": "Привязка телефона",
  "/settings/position-staff-visibility": "Кто видит коллег",
  "/settings/print-agent": "Онлайн принтер",
  "/settings/products": "Справочник продуктов",
  "/settings/role-presets": "Наборы прав по ролям",
  "/settings/schedule": "График смен",
  "/settings/staff-hierarchy": "Иерархия управления",
  "/settings/services": "Услуги специалиста",
  "/settings/subscription": "Тарифы",
  "/settings/task-visibility": "Кто видит все задачи в TasksFlow",
  "/settings/kiosk": "Общий планшет",
  "/settings/master-cabinet": "Мастер-кабинет справочников",
  "/settings/users": "Сотрудники",
  "/settings/users/invite": "Приглашение сотрудника",
  "/settings/workload-balance": "Нагрузка сотрудников",
  "/staff": "Сотрудники",
  "/task-fill": "Заполнение задачи",
  "/tasks": "Задачи",
  "/team": "Команда",
  "/verifications": "Подтверждения",
  "/inspection": "Пришла проверка",
  "/production-control": "Программа производственного контроля",
  "/more": "Остальное",
  "/knowledge": "Инструкции",
  "/checklists": "Чек-листы",
  "/settings/staff-health": "Медкнижки и обучение",
  "/settings/sections/journals": "Настройка журналов",
  "/settings/sections/staff": "Настройка сотрудников",
  "/settings/sections/points": "Настройка точек",
};

/**
 * Подписи динамических экранов, у которых шапка иначе взяла бы название
 * родителя: `/settings/journals/<code>/scope` без этого назывался
 * «Набор журналов», хотя это настройки задач одного журнала.
 */
const DYNAMIC_ROUTE_TITLES: Array<[RegExp, string]> = [
  [/^\/settings\/journals\/[^/]+\/scope$/, "Задачи журнала"],
];

/** Подпись динамического экрана по шаблону пути; иначе null. */
export function getDynamicRouteTitle(pathname: string, t?: RouteTitleTranslator): string | null {
  const clean = pathname.replace(/\/+$/, "") || "/";
  const title = DYNAMIC_ROUTE_TITLES.find(([pattern]) => pattern.test(clean))?.[1];
  return title ? (t ? t("journal_scope") : title) : null;
}

/** Точное совпадение пути. Для динамических путей вернёт null. */
export function getRouteTitle(pathname: string, t?: RouteTitleTranslator): string | null {
  const clean = pathname.replace(/\/+$/, "") || "/";
  if (!Object.hasOwn(ROUTE_TITLE_KEYS, clean)) return null;
  return t ? t(ROUTE_TITLE_KEYS[clean as keyof typeof ROUTE_TITLE_KEYS]) : ROUTE_TITLES[clean];
}

/** Родительский путь: `/settings/buildings` → `/settings`, `/batches` → ``. */
function parentOf(pathname: string): string {
  return pathname.slice(0, pathname.lastIndexOf("/"));
}

/**
 * Соседи по уровню — из них собирается выпадающий список у звена крошек.
 *
 * Смысл тот же, что у переключателя журналов: находясь в «Здания и
 * помещения», проще перепрыгнуть в «Оборудование» прямо из крошки, чем
 * возвращаться в список настроек. Работает для любого раздела бесплатно,
 * потому что весь словарь маршрутов и так лежит здесь.
 *
 * Сам путь в результат не входит — он и есть текущее звено.
 */
export function getSiblingRoutes(
  pathname: string,
  t?: RouteTitleTranslator,
  locale: Locale = "ru",
): { path: string; title: string }[] {
  const clean = pathname.replace(/\/+$/, "") || "/";
  const parent = parentOf(clean);
  return Object.entries(ROUTE_TITLES)
    .filter(([path]) => path !== clean && parentOf(path) === parent)
    .map(([path]) => ({ path, title: getRouteTitle(path, t)! }))
    .sort((a, b) => a.title.localeCompare(b.title, locale));
}
