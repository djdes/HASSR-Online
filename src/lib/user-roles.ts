import { isPlaceholderStaffUser } from "@/lib/journal-roster";

export const USER_ROLE_VALUES = [
  "manager",
  "head_chef",
  "cook",
  "waiter",
] as const;

export const LEGACY_USER_ROLE_VALUES = [
  "owner",
  "technologist",
  "operator",
] as const;

export type UserRole = (typeof USER_ROLE_VALUES)[number];
export type LegacyUserRole = (typeof LEGACY_USER_ROLE_VALUES)[number];
export type KnownUserRole = UserRole | LegacyUserRole;

export type UserLike = {
  id?: string;
  name: string;
  role?: string | null;
  positionTitle?: string | null;
  /// DB-backed structured job position. When present, takes priority over
  /// the legacy role enum everywhere that renders / filters by "должность"
  /// (journal selectors, grouped dropdowns, etc). Loaded by server pages
  /// with `include: { jobPosition: true }`.
  jobPosition?: {
    name: string;
    categoryKey: string;
  } | null;
};

/**
 * Position label priority: DB `jobPosition.name` > free-form `positionTitle`
 * > role enum label. Journal selectors should lean on this so the dropdown
 * always mirrors whatever the admin set up on /settings/users — no more
 * hard-coded «Управляющий/Шеф-повар/Повар/Официант» four-item enum once
 * the org has custom positions.
 */
export function getUserPositionLabel(user: UserLike): string {
  const posName = user.jobPosition?.name?.trim();
  if (posName) return posName;
  const pt = typeof user.positionTitle === "string" ? user.positionTitle.trim() : "";
  if (pt) return pt;
  return getUserRoleLabel(user.role);
}

/**
 * Category grouping for the "Должность" dropdown. Mirrors the two columns
 * on /settings/users. Falls back to `isManagerRole`-driven grouping when
 * `jobPosition` is absent.
 */
export function getUserPositionCategory(
  user: UserLike
): "management" | "staff" {
  const k = user.jobPosition?.categoryKey;
  if (k === "management" || k === "staff") return k;
  return isManagerRole(user.role) ? "management" : "staff";
}

const LEGACY_TO_ROLE: Record<string, UserRole> = {
  owner: "manager",
  technologist: "head_chef",
  operator: "cook",
};

const ROLE_TO_LEGACY: Partial<Record<UserRole, string[]>> = {
  manager: ["owner"],
  head_chef: ["technologist"],
  cook: ["operator"],
};

export const USER_ROLE_LABELS: Record<UserRole, string> = {
  manager: "Управляющий",
  head_chef: "Шеф-повар",
  cook: "Повар",
  waiter: "Официант",
};

export const USER_ROLE_OPTIONS = USER_ROLE_VALUES.map((value) => ({
  value,
  label: USER_ROLE_LABELS[value],
}));

export const USER_ROLE_LABEL_VALUES = USER_ROLE_OPTIONS.map(
  (option) => option.label
);

export const MANAGER_ROLES: UserRole[] = ["manager"];
export const MANAGEMENT_ROLES: UserRole[] = ["manager", "head_chef"];
export const STAFF_ROLES: UserRole[] = ["head_chef", "cook", "waiter"];

export function isUserRoleValue(role: string | null | undefined): role is UserRole {
  return !!role && USER_ROLE_VALUES.includes(role as UserRole);
}

export function isLegacyUserRoleValue(
  role: string | null | undefined
): role is LegacyUserRole {
  return !!role && LEGACY_USER_ROLE_VALUES.includes(role as LegacyUserRole);
}

export function normalizeUserRole(role: string | null | undefined): string {
  if (!role) return "cook";
  return LEGACY_TO_ROLE[role] || role;
}

export function toCanonicalUserRole(
  role: string | null | undefined,
  fallback: UserRole = "cook"
): UserRole {
  const normalized = normalizeUserRole(role);
  return isUserRoleValue(normalized) ? normalized : fallback;
}

export function getUserRoleLabel(role: string | null | undefined): string {
  const normalized = normalizeUserRole(role);
  if (normalized in USER_ROLE_LABELS) {
    return USER_ROLE_LABELS[normalized as UserRole];
  }

  return normalized || "Сотрудник";
}

/**
 * Resolve the display title for an employee on a journal. Prefers the DB-backed
 * `jobPosition.name` (the structured «должность» owner sets up on
 * /settings/users), then the legacy free-form `positionTitle`, and finally the
 * role enum label — so every journal automatically shows the admin's chosen
 * label without per-file edits.
 */
export function getUserDisplayTitle(
  user:
    | {
        role?: string | null;
        positionTitle?: string | null;
        jobPosition?: { name?: string | null } | null;
      }
    | null
    | undefined
): string {
  const pos =
    typeof user?.jobPosition?.name === "string"
      ? user.jobPosition.name.trim()
      : "";
  if (pos) return pos;
  const raw =
    typeof user?.positionTitle === "string" ? user.positionTitle.trim() : "";
  if (raw) return raw;
  return getUserRoleLabel(user?.role);
}

/**
 * Должность человека в строке журнала — всегда из его карточки
 * (`getUserDisplayTitle`). Копия, сохранённая в строке, — только если
 * человека нет в списке (уволен, удалён). Должность документа сюда не
 * подставляем: строку мог заполнить не ответственный документа.
 *
 * Сначала проверяем, что человек найден: `getUserDisplayTitle(undefined)`
 * вернул бы «Повар» (пустая роль нормализуется в cook).
 */
export function getRowEmployeeTitle(
  user: Parameters<typeof getUserDisplayTitle>[0],
  storedTitle?: string | null
): string {
  if (user) return getUserDisplayTitle(user);
  return typeof storedTitle === "string" ? storedTitle.trim() : "";
}

export function getPermissionRole(role: string | null | undefined): string {
  switch (normalizeUserRole(role)) {
    case "manager":
      return "owner";
    case "head_chef":
      return "technologist";
    default:
      return "operator";
  }
}

export function getUserRoleGroupLabel(role: string | null | undefined): string {
  return isManagerRole(role) ? "Руководство" : "Сотрудники";
}

export function getUserRoleSortOrder(role: string | null | undefined): number {
  switch (normalizeUserRole(role)) {
    case "manager":
      return 0;
    case "head_chef":
      return 1;
    case "cook":
      return 2;
    case "waiter":
      return 3;
    default:
      return 4;
  }
}

/**
 * Distinct «должности» across a user set — DB-backed jobPosition.name when
 * available, else positionTitle/role fallback. This is what journal dropdowns
 * bind to, so changing the admin's positions on /settings/users immediately
 * propagates here without per-journal edits.
 */
export function getDistinctRoleLabels(users: UserLike[]): string[] {
  return [...new Set(users.map((u) => getUserPositionLabel(u)))];
}

/**
 * Возвращает пользователей с указанной должностью.
 *
 * `opts.keepUserId` — id пользователя, которого ВСЕГДА включаем в
 * результат, даже если его должность не совпадает с фильтром. Нужно
 * для row-edit dialog'ов: если строка журнала была сохранена с
 * employeeId='X' (повар), а в dropdown'е отфильтровано «Управляющий»
 * — без keepUserId этот повар пропадал из списка, и выбранное значение
 * визуально становилось пустым. С keepUserId он остаётся видимым
 * (manager видит свой выбор и может сменить если хочет).
 */
export function getUsersForRoleLabel<T extends UserLike & { id: string }>(
  users: T[],
  positionLabel: string,
  opts?: { keepUserId?: string | null }
): T[] {
  const matched = users.filter(
    (u) => getUserPositionLabel(u) === positionLabel
  );
  const keepId = opts?.keepUserId;
  if (!keepId) return matched;
  if (matched.some((u) => u.id === keepId)) return matched;
  const kept = users.find((u) => u.id === keepId);
  if (!kept) return matched;
  return [kept, ...matched];
}

/**
 * Return distinct positions split into the two categories — for a single
 * Select with Руководство / Сотрудники optgroups. Labels are unique across
 * the whole list, but listed in the category where the first user with that
 * label happens to land.
 */
export function getPositionLabelsGrouped(users: UserLike[]): {
  management: string[];
  staff: string[];
} {
  const management: string[] = [];
  const staff: string[] = [];
  const seen = new Set<string>();
  for (const u of users) {
    const label = getUserPositionLabel(u);
    if (seen.has(label)) continue;
    seen.add(label);
    if (getUserPositionCategory(u) === "management") management.push(label);
    else staff.push(label);
  }
  return { management, staff };
}

export function hasAnyUserRole(
  role: string | null | undefined,
  allowedRoles: readonly string[]
): boolean {
  return allowedRoles.includes(normalizeUserRole(role));
}

export function hasNormalizedUserRole(
  role: string | null | undefined,
  expectedRole: UserRole
): boolean {
  return normalizeUserRole(role) === expectedRole;
}

/**
 * Аккаунт, которого нельзя подставлять «по умолчанию»: ROOT и заглушки
 * (имя = почта из мгновенной регистрации, демо «Иванов И.И.»). Если имени
 * в объекте нет, судить не по чему — считаем обычным сотрудником.
 */
function isDefaultPickExcluded(user: { role?: string | null }): boolean {
  const record = user as { name?: unknown; email?: unknown; isRoot?: unknown };
  if (record.isRoot === true) return true;
  if (typeof record.name !== "string") return false;
  return isPlaceholderStaffUser({
    name: record.name,
    email: typeof record.email === "string" ? record.email : null,
  });
}

export function pickUserByRolePriority<
  T extends { role?: string | null }
>(users: T[], roles: readonly UserRole[]): T | null {
  // Раньше первым «управляющим» оказывался аккаунт мгновенной регистрации,
  // названный почтой, — и он вставал ответственным журнала. Заглушки и ROOT
  // берём, только если больше некого.
  const real = users.filter((user) => !isDefaultPickExcluded(user));
  const pool = real.length > 0 ? real : users;
  for (const role of roles) {
    const match = pool.find((user) => hasNormalizedUserRole(user.role, role));
    if (match) {
      return match;
    }
  }

  return pool[0] || null;
}

export function isManagerRole(role: string | null | undefined): boolean {
  return hasAnyUserRole(role, MANAGER_ROLES);
}

export function isManagementRole(role: string | null | undefined): boolean {
  return hasAnyUserRole(role, MANAGEMENT_ROLES);
}

export function getDbRoleValuesWithLegacy(
  roles: readonly UserRole[]
): string[] {
  return [...new Set(roles.flatMap((role) => [role, ...(ROLE_TO_LEGACY[role] || [])]))];
}

export function pickPrimaryManager<T extends { role?: string | null }>(
  users: T[]
): T | null {
  return pickUserByRolePriority(users, ["manager", "head_chef"]);
}

export function pickPrimaryStaff<T extends { role?: string | null }>(
  users: T[]
): T | null {
  return pickUserByRolePriority(users, ["cook", "waiter", "head_chef", "manager"]);
}
