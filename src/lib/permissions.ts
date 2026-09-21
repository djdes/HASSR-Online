/**
 * Permission-матрица WeSetup.
 *
 * Что это: гибкая система прав поверх ролей. Роли (manager/head_chef/…)
 * остаются как «должностной уровень» для UX-ярлыков, но все role-gates
 * (API и UI) должны опираться на permissions — они переопределяемы
 * на уровне категории (Руководство/Сотрудники), должности (JobPosition)
 * и конкретного пользователя.
 *
 * Разрешение (permission) = короткий стабильный код (namespace.action).
 *
 * Resolve-цепочка:
 *   1. isRoot → всё (bypass).
 *   2. User.permissionsJson — если задан, он заменяет (не добавляет) право.
 *   3. JobPosition.permissionsJson — если задан, используется как базовый набор.
 *   4. DEFAULT_PERMISSIONS_BY_CATEGORY[category] — fallback.
 *
 * Если и у пользователя, и у должности заданы permissionsJson — user
 * имеет приоритет. Это даёт UI-редактору три уровня настройки:
 *   - сразу все должности группы (через обновление каждой JobPosition)
 *   - конкретная должность (permissionsJson на JobPosition)
 *   - конкретный человек (permissionsJson на User)
 */

import { isManagementRole } from "@/lib/user-roles";

export const PERMISSIONS = [
  "dashboard.view",
  "journals.view",
  "journals.fill",
  "journals.manage_documents",
  "journals.bulk_create",
  "journals.manage_settings",
  "reports.view",
  "reports.export",
  "staff.view",
  "staff.manage",
  "staff.invite",
  "staff.archive",
  "positions.manage",
  "equipment.view",
  "equipment.manage",
  "equipment.delete",
  "areas.view",
  "areas.manage",
  "areas.delete",
  "products.view",
  "products.manage",
  "products.delete",
  "batches.view",
  "batches.manage",
  "plans.view",
  "plans.manage",
  "capa.view",
  "capa.manage",
  "changes.view",
  "changes.manage",
  "losses.view",
  "losses.manage",
  "competencies.view",
  "competencies.manage",
  "integrations.manage",
  "settings.organization",
  "settings.auto_journals",
  "settings.permissions",
  "audit.view",
  "payments.manage",
] as const;

export type Permission = (typeof PERMISSIONS)[number];
export const PERMISSION_SET: ReadonlySet<Permission> = new Set(PERMISSIONS);

export function isKnownPermission(code: string): code is Permission {
  return PERMISSION_SET.has(code as Permission);
}

/**
 * Группировка для UI — карточки аккордеона со смысловыми блоками.
 */
export const PERMISSION_GROUPS: ReadonlyArray<{
  id: string;
  title: string;
  description: string;
  items: ReadonlyArray<{ code: Permission; label: string; hint?: string }>;
}> = [
  {
    id: "dashboard-journals",
    title: "Дашборд и журналы",
    description: "Доступ к главной, списку журналов и заполнению записей.",
    items: [
      { code: "dashboard.view", label: "Открывать дашборд" },
      { code: "journals.view", label: "Смотреть журналы" },
      { code: "journals.fill", label: "Заполнять журналы" },
      {
        code: "journals.manage_documents",
        label: "Создавать/закрывать документы журналов",
      },
      {
        code: "journals.bulk_create",
        label: "Создавать сразу по нескольким журналам",
      },
      {
        code: "journals.manage_settings",
        label: "Включать/выключать журналы",
      },
    ],
  },
  {
    id: "reports",
    title: "Отчёты",
    description: "PDF/Excel/ZIP-выгрузки для Роспотребнадзора.",
    items: [
      { code: "reports.view", label: "Открывать раздел «Отчёты»" },
      { code: "reports.export", label: "Скачивать PDF/Excel/ZIP" },
    ],
  },
  {
    id: "staff",
    title: "Сотрудники",
    description: "Список, должности, приглашения, архивирование.",
    items: [
      { code: "staff.view", label: "Видеть сотрудников" },
      { code: "staff.manage", label: "Редактировать ФИО, роли, должности" },
      { code: "staff.invite", label: "Приглашать новых сотрудников" },
      { code: "staff.archive", label: "Увольнять/архивировать" },
      { code: "positions.manage", label: "Управлять списком должностей" },
    ],
  },
  {
    id: "equipment-areas",
    title: "Цеха и оборудование",
    description: "Площадки, холодильники, датчики.",
    items: [
      { code: "areas.view", label: "Смотреть цеха/участки" },
      { code: "areas.manage", label: "Добавлять/править цеха" },
      { code: "areas.delete", label: "Удалять цех" },
      { code: "equipment.view", label: "Смотреть оборудование" },
      { code: "equipment.manage", label: "Добавлять/править оборудование" },
      { code: "equipment.delete", label: "Удалять оборудование" },
    ],
  },
  {
    id: "products-batches",
    title: "Продукция и партии",
    description:
      "Справочник продуктов, партии / прослеживаемость, партии для бракеража.",
    items: [
      { code: "products.view", label: "Смотреть справочник продуктов" },
      { code: "products.manage", label: "Редактировать продукты" },
      { code: "products.delete", label: "Удалять продукт" },
      { code: "batches.view", label: "Смотреть партии" },
      { code: "batches.manage", label: "Создавать/менять партии" },
    ],
  },
  {
    id: "planning",
    title: "Планирование и отклонения",
    description:
      "Производственный план, CAPA, изменения, потери, компетенции.",
    items: [
      { code: "plans.view", label: "Смотреть производственный план" },
      { code: "plans.manage", label: "Редактировать план" },
      { code: "capa.view", label: "Смотреть CAPA" },
      { code: "capa.manage", label: "Вести CAPA" },
      { code: "changes.view", label: "Смотреть изменения" },
      { code: "changes.manage", label: "Редактировать изменения" },
      { code: "losses.view", label: "Смотреть потери" },
      { code: "losses.manage", label: "Вести потери" },
      { code: "competencies.view", label: "Смотреть матрицу компетенций" },
      { code: "competencies.manage", label: "Управлять компетенциями" },
    ],
  },
  {
    id: "settings",
    title: "Настройки и интеграции",
    description: "Конфигурация организации, API, автосоздание, платежи.",
    items: [
      { code: "settings.organization", label: "Настройки организации" },
      { code: "settings.auto_journals", label: "Автосоздание журналов" },
      { code: "settings.permissions", label: "Управление правами доступа" },
      { code: "integrations.manage", label: "Интеграции (TasksFlow, API)" },
      { code: "audit.view", label: "Журнал действий (audit log)" },
      { code: "payments.manage", label: "Оплата и тариф" },
    ],
  },
];

/**
 * Дефолтные пакеты прав по категории.
 *
 * management — всё, staff — только заполнение журналов и просмотр
 * справочных разделов, чтобы повар/официант из коробки мог видеть
 * задачи и заполнять журналы, но не лез в настройки и отчёты.
 */
export const DEFAULT_MANAGEMENT_PERMISSIONS: ReadonlyArray<Permission> =
  PERMISSIONS;

export const DEFAULT_STAFF_PERMISSIONS: ReadonlyArray<Permission> = [
  "dashboard.view",
  "journals.view",
  "journals.fill",
  "equipment.view",
  "areas.view",
  "products.view",
  "batches.view",
  "competencies.view",
];

/**
 * Сторонняя бракеражная комиссия: видит и подписывает журналы, к которым
 * ей дан доступ (бракеражи), — и только.
 */
export const DEFAULT_COMMISSION_PERMISSIONS: ReadonlyArray<Permission> = ["journals.view", "journals.fill"];

export function getDefaultPermissionsForCategory(
  categoryKey: "management" | "staff" | "commission" | string
): ReadonlyArray<Permission> {
  if (categoryKey === "management") return DEFAULT_MANAGEMENT_PERMISSIONS;
  if (categoryKey === "commission") return DEFAULT_COMMISSION_PERMISSIONS;
  // Незнакомая категория — права линейного персонала, а не руководителя.
  return DEFAULT_STAFF_PERMISSIONS;
}

/**
 * Права, которых заведомо НЕТ у линейного персонала (сверено с
 * `DEFAULT_STAFF_PERMISSIONS`). По ним и опознаётся руководитель.
 *
 * Список, а не одно право: должность настраивают вручную, и заведующая
 * без «управления сотрудниками», но с приёмкой задач — всё равно
 * руководитель.
 */
export const MANAGER_PERMISSIONS: ReadonlyArray<Permission> = [
  "staff.view",
  "staff.manage",
  "reports.view",
  "audit.view",
  "settings.permissions",
];

/**
 * Показывать ли человеку экран руководителя (сводка по заведению)
 * вместо своего списка задач — в Mini App и в ответе бота.
 *
 * Раньше каждое из трёх мест спрашивало это само, и все три спрашивали
 * `dashboard.view`. А он есть у линейного персонала по умолчанию: это
 * «можно открыть главную», а не «начальник». В результате повар,
 * открывший приложение, видел сводку по всему кафе вместо своих задач.
 *
 * Роль учитывается наравне с правами: у части руководителей должность
 * заведена в категории «персонал» (шеф-повар, управляющий-бариста), и по
 * одним правам они выглядели бы линейным сотрудником, хотя на сайте
 * система считает их руководством. Линейного персонала это не задевает —
 * управленческой роли у него нет.
 *
 * Держим признак здесь, чтобы копии снова не разъехались.
 */
export function isManagerLikePermissions(
  perms: ReadonlySet<Permission> | Set<string>,
  role?: string | null,
): boolean {
  if (isManagementRole(role)) return true;
  return MANAGER_PERMISSIONS.some((permission) =>
    (perms as Set<string>).has(permission),
  );
}

function parsePermissionsJson(value: unknown): Permission[] | null {
  if (value === null || value === undefined) return null;
  if (!Array.isArray(value)) return null;
  const out: Permission[] = [];
  for (const raw of value) {
    if (typeof raw === "string" && isKnownPermission(raw)) {
      out.push(raw);
    }
  }
  return out;
}

export function sanitizePermissionsJson(value: unknown): Permission[] {
  const parsed = parsePermissionsJson(value);
  return parsed ?? [];
}

export type PermissionActor = {
  isRoot?: boolean | null;
  userPermissionsJson?: unknown;
  positionPermissionsJson?: unknown;
  positionCategoryKey?: string | null;
  /// Fallback для пользователей без jobPosition — чтобы «руководители
  /// первой версии» без должности всё равно получали management defaults.
  fallbackCategoryKey?: "management" | "staff";
};

export function resolveActorPermissions(
  actor: PermissionActor
): Set<Permission> {
  if (actor.isRoot === true) return new Set(PERMISSIONS);
  const userOverride = parsePermissionsJson(actor.userPermissionsJson);
  if (userOverride !== null) return new Set(userOverride);
  const positionOverride = parsePermissionsJson(actor.positionPermissionsJson);
  if (positionOverride !== null) return new Set(positionOverride);
  const categoryKey =
    actor.positionCategoryKey ?? actor.fallbackCategoryKey ?? "staff";
  return new Set(getDefaultPermissionsForCategory(categoryKey));
}

export function actorHasPermission(
  actor: PermissionActor,
  permission: Permission
): boolean {
  if (actor.isRoot === true) return true;
  return resolveActorPermissions(actor).has(permission);
}
