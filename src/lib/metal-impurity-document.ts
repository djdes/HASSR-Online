import {
  USER_ROLE_LABEL_VALUES,
  getUserDisplayTitle,
  getUsersForRoleLabel,
  pickPrimaryManager,
} from "@/lib/user-roles";

export const METAL_IMPURITY_TEMPLATE_CODE = "metal_impurity";
export const METAL_IMPURITY_SOURCE_SLUG = "metalimpurityjournal";
export const METAL_IMPURITY_PAGE_TITLE = "Журнал учета металлопримесей в сырье";
export const METAL_IMPURITY_DOCUMENT_TITLE = "Журнал учета металлопримесей";
export const METAL_IMPURITY_RESPONSIBLE_POSITIONS = USER_ROLE_LABEL_VALUES;

export type MetalImpurityUser = {
  id: string;
  name: string;
  role: string;
  // Должность из карточки (как в UserLike) — её пишем в строку.
  positionTitle?: string | null;
  jobPosition?: { name: string; categoryKey: string } | null;
};

export type MetalImpurityOption = {
  id: string;
  name: string;
};

export type MetalImpurityRow = {
  id: string;
  date: string;
  materialId: string;
  supplierId: string;
  consumedQuantityKg: string;
  impurityQuantityG: string;
  impurityCharacteristic: string;
  responsibleRole: string;
  responsibleEmployeeId: string | null;
  responsibleName: string;
};

export type MetalImpurityDocumentConfig = {
  startDate: string;
  endDate: string;
  responsiblePosition: string;
  responsibleEmployeeId: string | null;
  responsibleEmployee: string;
  materials: MetalImpurityOption[];
  suppliers: MetalImpurityOption[];
  rows: MetalImpurityRow[];
};

function createId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

function safeText(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function normalizeOptions(value: unknown, fallback: MetalImpurityOption[]) {
  if (!Array.isArray(value)) return fallback;

  const items = value
    .map((item, index) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return null;
      const source = item as Record<string, unknown>;
      const name = safeText(source.name);
      if (!name) return null;
      return {
        id: safeText(source.id, `option-${index + 1}`),
        name,
      };
    })
    .filter((item): item is MetalImpurityOption => item !== null);

  return items.length > 0 ? items : fallback;
}

function normalizeRows(value: unknown, fallback: MetalImpurityRow[]) {
  if (!Array.isArray(value)) return fallback;

  const items = value
    .map((item, index) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return null;
      const source = item as Record<string, unknown>;
      return {
        id: safeText(source.id, `row-${index + 1}`),
        date: safeText(source.date),
        materialId: safeText(source.materialId),
        supplierId: safeText(source.supplierId),
        consumedQuantityKg: safeText(source.consumedQuantityKg),
        impurityQuantityG: safeText(source.impurityQuantityG),
        impurityCharacteristic: safeText(source.impurityCharacteristic),
        responsibleRole: safeText(source.responsibleRole),
        responsibleEmployeeId: safeText(source.responsibleEmployeeId) || null,
        responsibleName: safeText(source.responsibleName),
      };
    })
    .filter((item): item is MetalImpurityRow => item !== null);

  return items.length > 0 ? items : fallback;
}

export function createMetalImpurityRow(params?: Partial<MetalImpurityRow>): MetalImpurityRow {
  const today = new Date().toISOString().slice(0, 10);
  return {
    id: createId("metal"),
    date: params?.date || today,
    materialId: params?.materialId || "",
    supplierId: params?.supplierId || "",
    consumedQuantityKg: params?.consumedQuantityKg || "",
    impurityQuantityG: params?.impurityQuantityG || "",
    impurityCharacteristic: params?.impurityCharacteristic || "",
    responsibleRole: params?.responsibleRole || METAL_IMPURITY_RESPONSIBLE_POSITIONS[0],
    responsibleEmployeeId: params?.responsibleEmployeeId || null,
    responsibleName: params?.responsibleName || "",
  };
}

export function getDefaultMetalImpurityConfig(params?: {
  users?: MetalImpurityUser[];
  materials?: string[];
  suppliers?: string[];
  responsibleEmployeeId?: string | null;
  responsibleName?: string;
  responsiblePosition?: string;
  date?: string;
}): MetalImpurityDocumentConfig {
  const startDate = params?.date || new Date().toISOString().slice(0, 10);
  // ПОЧЕМУ пусто: журнал предъявляют инспектору. Любая «примерная»
  // строка или выдуманный поставщик в свежем документе — это подлог.
  // Справочники материалов/поставщиков наполняются организацией через
  // «Редактировать списки» (или приходят в params при импорте).
  const materialNames = params?.materials?.filter(Boolean) || [];
  const supplierNames = params?.suppliers?.filter(Boolean) || [];
  const materials = materialNames.map((name, index) => ({
    id: `mat-${index + 1}`,
    name,
  }));
  const suppliers = supplierNames.map((name, index) => ({
    id: `sup-${index + 1}`,
    name,
  }));
  const manager = params?.users?.length ? pickPrimaryManager(params.users) : null;
  // Должность ответственного из справочника, а не лейбл роли.
  const defaultRole = manager ? getUserDisplayTitle(manager) : METAL_IMPURITY_RESPONSIBLE_POSITIONS[0];
  const responsiblePosition = params?.responsiblePosition || defaultRole;
  const responsibleUser =
    (params?.responsibleEmployeeId
      ? params.users?.find((user) => user.id === params.responsibleEmployeeId) || null
      : null) ||
    getUsersForRoleLabel(params?.users || [], responsiblePosition)[0] ||
    manager ||
    params?.users?.[0] ||
    null;
  // Без реального сотрудника оставляем пусто — «Иванов И.И.» в бланке
  // выглядит как настоящая подпись несуществующего человека.
  const responsibleEmployee = params?.responsibleName || responsibleUser?.name || "";
  const responsibleEmployeeId = responsibleUser?.id || params?.responsibleEmployeeId || null;

  return {
    startDate,
    endDate: "",
    responsiblePosition,
    responsibleEmployeeId,
    responsibleEmployee,
    materials,
    suppliers,
    // Новый документ — пустой: строки появляются по факту контроля
    // (event-based журнал), а не «для примера».
    rows: [],
  };
}

export function normalizeMetalImpurityConfig(
  value: unknown,
  params?: {
    users?: MetalImpurityUser[];
    materials?: string[];
    suppliers?: string[];
    responsibleEmployeeId?: string | null;
    responsibleName?: string;
    responsiblePosition?: string;
    date?: string;
  }
): MetalImpurityDocumentConfig {
  const fallback = getDefaultMetalImpurityConfig(params);
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;

  const source = value as Record<string, unknown>;
  const materials = normalizeOptions(source.materials, fallback.materials);
  const suppliers = normalizeOptions(source.suppliers, fallback.suppliers);

  return {
    startDate: safeText(source.startDate, fallback.startDate),
    endDate: safeText(source.endDate, fallback.endDate),
    responsiblePosition: safeText(
      source.responsiblePosition,
      fallback.responsiblePosition
    ),
    responsibleEmployeeId:
      safeText(source.responsibleEmployeeId) || fallback.responsibleEmployeeId || null,
    responsibleEmployee: safeText(
      source.responsibleEmployee,
      fallback.responsibleEmployee
    ),
    materials,
    suppliers,
    rows: normalizeRows(source.rows, fallback.rows).map((row) => ({
      ...row,
      materialId: row.materialId || materials[0]?.id || "",
      supplierId: row.supplierId || suppliers[0]?.id || "",
      responsibleRole: row.responsibleRole || fallback.responsiblePosition,
      responsibleEmployeeId: row.responsibleEmployeeId || fallback.responsibleEmployeeId || null,
      responsibleName: row.responsibleName || fallback.responsibleEmployee,
    })),
  };
}

export function getMetalImpurityValuePerKg(
  impurityQuantityG: string,
  consumedQuantityKg: string
) {
  const impurity = Number(impurityQuantityG.replace(",", "."));
  const consumed = Number(consumedQuantityKg.replace(",", "."));
  if (!Number.isFinite(impurity) || !Number.isFinite(consumed) || consumed <= 0) return "";
  return Number(((impurity * 1000) / consumed).toFixed(2)).toString();
}

export function getMetalImpurityOptionName(options: MetalImpurityOption[], id: string) {
  return options.find((item) => item.id === id)?.name || "—";
}

export function getMetalImpurityEmployeeOptions(
  users: MetalImpurityUser[],
  roleLabel: string,
  currentEmployeeId?: string | null,
  fallbackEmployeeIds: Array<string | null | undefined> = []
): MetalImpurityUser[] {
  const values = new Set<string>();
  for (const fallbackEmployeeId of fallbackEmployeeIds) {
    if (typeof fallbackEmployeeId === "string" && fallbackEmployeeId.trim()) {
      values.add(fallbackEmployeeId);
    }
  }
  if (currentEmployeeId) values.add(currentEmployeeId);
  for (const user of getUsersForRoleLabel(users, roleLabel)) {
    if (typeof user.id === "string" && user.id.trim()) {
      values.add(user.id);
    }
  }
  return Array.from(values)
    .map((employeeId) => users.find((user) => user.id === employeeId) || null)
    .filter((user): user is MetalImpurityUser => user !== null);
}
