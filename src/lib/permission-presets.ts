/**
 * Permission presets — конкретные роли + capabilities для UI-gating и
 * terminology. Только "admin" видит интерфейс журналов как журналов;
 * остальные пресеты скрывают слово «журнал» и показывают «задача».
 *
 * Заведующая (head_chef) — особый пресет: видит сотрудников + проверку
 * выполненных задач, но НЕ заходит в /journals и не использует
 * терминологию «журналов».
 */

export type PermissionPreset =
  | "admin"
  | "head_chef"
  | "cook"
  | "waiter"
  | "seller"
  | "cashier"
  | "cleaner";

/**
 * Capability tokens — что юзер может делать. UI и API проверяют через
 * `hasCapability(user, capability)`.
 */
export type Capability =
  /** Видеть и заходить в /dashboard и /journals/* */
  | "journals.view"
  /** Создавать/редактировать журнал-документы */
  | "journals.manage"
  /** Видеть список сотрудников + редактировать их */
  | "staff.manage"
  /** Видеть список сотрудников (read-only) */
  | "staff.view"
  /** Видеть verification-страницу (заведующая проверяет задачи) */
  | "tasks.verify"
  /** Заходить в /reports, генерировать сводки */
  | "reports.view"
  /** Видеть админ-функции: настройки, интеграции, biling */
  | "admin.full"
  /** Видеть мини-апп со списком task'ов */
  | "mini.tasks"
  /** Принимать поставку (приёмка) — для продавцов/кассиров */
  | "mini.acceptance"
  /** Списания — для кассиров */
  | "mini.writeoff"
  /** Касса (приём оплаты) — для кассиров */
  | "mini.cashier"
  /** Видеть compliance ring и stats */
  | "stats.view";

const PRESET_CAPABILITIES: Record<PermissionPreset, Capability[]> = {
  admin: [
    "journals.view",
    "journals.manage",
    "staff.manage",
    "staff.view",
    "tasks.verify",
    "reports.view",
    "admin.full",
    "mini.tasks",
    "mini.acceptance",
    "mini.writeoff",
    "mini.cashier",
    "stats.view",
  ],
  head_chef: [
    // Заведующая. НЕ видит журналы как журналы — только задачи на
    // проверку и сотрудников.
    "staff.view",
    "tasks.verify",
    "stats.view",
    "mini.tasks",
  ],
  cook: ["mini.tasks"],
  waiter: ["mini.tasks"],
  seller: ["mini.tasks", "mini.acceptance"],
  cashier: ["mini.tasks", "mini.acceptance", "mini.writeoff", "mini.cashier"],
  cleaner: ["mini.tasks"],
};

const PRESET_LABELS: Record<PermissionPreset, string> = {
  admin: "Администратор",
  head_chef: "Заведующий / Шеф",
  cook: "Повар",
  waiter: "Официант",
  seller: "Продавец",
  cashier: "Кассир",
  cleaner: "Уборщик",
};

const PRESET_DESCRIPTIONS: Record<PermissionPreset, string> = {
  admin: "Полный доступ, видит журналы и все настройки",
  head_chef: "Видит сотрудников + проверяет выполненные задачи. Журналы скрыты.",
  cook: "Мини-апп: только задачи смены",
  waiter: "Мини-апп: только задачи смены",
  seller: "Мини-апп: задачи + приём поставок",
  cashier: "Мини-апп: задачи + приём поставок + списания + касса",
  cleaner: "Мини-апп: только задачи уборки",
};

/**
 * Преобразует legacy `User.role` в default permission preset, если у
 * юзера ещё не выставлен `permissionPreset` напрямую.
 */
function defaultPresetFromRole(role: string | null | undefined): PermissionPreset {
  switch ((role ?? "").toLowerCase()) {
    case "owner":
    case "manager":
      return "admin";
    case "technologist":
    case "head_chef":
      return "head_chef";
    case "cook":
    case "operator":
      return "cook";
    case "waiter":
      return "waiter";
    default:
      return "cook";
  }
}

export function effectivePreset(user: {
  permissionPreset?: string | null;
  role?: string | null;
  isRoot?: boolean | null;
}): PermissionPreset {
  if (user.isRoot) return "admin";
  const explicit = user.permissionPreset;
  if (explicit && isValidPreset(explicit)) return explicit;
  return defaultPresetFromRole(user.role);
}

export function isValidPreset(value: string): value is PermissionPreset {
  return [
    "admin",
    "head_chef",
    "cook",
    "waiter",
    "seller",
    "cashier",
    "cleaner",
  ].includes(value);
}

export function hasCapability(
  user: {
    permissionPreset?: string | null;
    role?: string | null;
    isRoot?: boolean | null;
    /**
     * Org-level overrides матрицы preset → capabilities. Заполняется из
     * `Organization.presetCapabilitiesJson` в session-callback'е. Если
     * для preset есть override — он используется ПОЛНОСТЬЮ (не merge).
     * Для `admin` пресета override игнорируется — admin всегда имеет
     * полный набор (защита от случайной самоблокировки).
     */
    orgPresetOverrides?: Record<string, string[]> | null;
  },
  capability: Capability,
): boolean {
  const preset = effectivePreset(user);
  if (preset !== "admin" && user.orgPresetOverrides) {
    const override = user.orgPresetOverrides[preset];
    if (Array.isArray(override)) {
      return override.includes(capability);
    }
  }
  return PRESET_CAPABILITIES[preset].includes(capability);
}

/**
 * Default capabilities для пресета без org-override'а. Используется UI
 * /settings/role-presets чтобы показать «дефолтное состояние» рядом с
 * текущим override'ом и позволить откатить к нему.
 */
export function getDefaultCapabilities(preset: PermissionPreset): Capability[] {
  return [...PRESET_CAPABILITIES[preset]];
}

/**
 * `true` если пользователь видит интерфейс как «журналы» (admin),
 * `false` если как «задачи» (все остальные включая заведующую).
 */
export function seesJournalsAsJournals(user: {
  permissionPreset?: string | null;
  role?: string | null;
  isRoot?: boolean | null;
}): boolean {
  return hasCapability(user, "journals.view");
}

export function getPresetLabel(preset: PermissionPreset): string {
  return PRESET_LABELS[preset];
}

export function getPresetDescription(preset: PermissionPreset): string {
  return PRESET_DESCRIPTIONS[preset];
}

export function listAllPresets(): {
  value: PermissionPreset;
  label: string;
  description: string;
}[] {
  return (Object.keys(PRESET_LABELS) as PermissionPreset[]).map((p) => ({
    value: p,
    label: PRESET_LABELS[p],
    description: PRESET_DESCRIPTIONS[p],
  }));
}

/**
 * Terminology shifts: для не-admin'ов «Журнал X» → «Задача X»,
 * «Заполнить журнал» → «Выполнить задачу» и т.п.
 */
export function localizeJournalTerm(
  user: {
    permissionPreset?: string | null;
    role?: string | null;
    isRoot?: boolean | null;
  },
  word: "journal" | "fill" | "journals" | "fill_action"
): string {
  if (seesJournalsAsJournals(user)) {
    switch (word) {
      case "journal":
        return "журнал";
      case "journals":
        return "журналы";
      case "fill":
        return "заполнить";
      case "fill_action":
        return "Заполнить";
    }
  }
  switch (word) {
    case "journal":
      return "задача";
    case "journals":
      return "задачи";
    case "fill":
      return "выполнить";
    case "fill_action":
      return "Выполнить";
  }
}
