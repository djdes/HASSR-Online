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
  "/capa": "CAPA",
  "/ideas": "Идеи и голосование",
  "/capa/new": "Новое CAPA",
  "/changes": "Изменения",
  "/changes/new": "Новое изменение",
  "/competencies": "Компетенции",
  "/control-board": "Панель контроля",
  "/dashboard": "Главная",
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
  "/settings/compliance": "Compliance",
  "/settings/consultant": "Консультант",
  "/settings/equipment": "Оборудование",
  "/settings/equipment/qr-sheet": "QR-наклейки оборудования",
  "/settings/qr-posters": "QR-плакаты",
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
  "/settings/journal-pipelines": "Настройки журналов (pipeline)",
  "/settings/journal-pipelines-tree": "Пошаговые сценарии",
  "/settings/journal-responsibles": "Ответственные за журналы",
  "/settings/journal-task-mode": "Раздача и проверка задач",
  "/settings/journals": "Набор журналов",
  "/settings/journals-by-position": "Матрица «должность × журнал»",
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
  "/settings/role-presets": "Пресеты ролей",
  "/settings/schedule": "График смен",
  "/settings/staff-hierarchy": "Иерархия управления",
  "/settings/services": "Услуги специалиста",
  "/settings/subscription": "Тарифы",
  "/settings/task-visibility": "Admin-флаг в TasksFlow",
  "/settings/kiosk": "Общий планшет",
  "/settings/users": "Сотрудники",
  "/settings/users/invite": "Приглашение сотрудника",
  "/settings/workload-balance": "Дашборд нагрузки",
  "/staff": "Сотрудники",
  "/task-fill": "Заполнение задачи",
  "/tasks": "Задачи",
  "/team": "Команда",
  "/verifications": "Подтверждения",
};

/** Точное совпадение пути. Для динамических путей вернёт null. */
export function getRouteTitle(pathname: string): string | null {
  const clean = pathname.replace(/\/+$/, "") || "/";
  return ROUTE_TITLES[clean] ?? null;
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
): { path: string; title: string }[] {
  const clean = pathname.replace(/\/+$/, "") || "/";
  const parent = parentOf(clean);
  return Object.entries(ROUTE_TITLES)
    .filter(([path]) => path !== clean && parentOf(path) === parent)
    .map(([path, title]) => ({ path, title }))
    .sort((a, b) => a.title.localeCompare(b.title, "ru"));
}
