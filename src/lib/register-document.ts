export const REGISTER_DOCUMENT_TEMPLATE_CODES = [
  "complaint_register",
  // Реестры без собственного экрана — поля и описание в register-journals.ts.
  "daily_samples",
  "vitaminization",
  "ration_control",
  "transport_temperature",
  "tableware_breakage",
  "pool_water_control",
] as const;

export type RegisterDocumentTemplateCode =
  (typeof REGISTER_DOCUMENT_TEMPLATE_CODES)[number];

export type RegisterFieldOption = {
  value: string;
  label: string;
};

export type RegisterFieldCondition = {
  field: string;
  equals: string;
};

export type RegisterField = {
  key: string;
  label: string;
  type: string;
  required: boolean;
  options: RegisterFieldOption[];
  showIf: RegisterFieldCondition | null;
};

export type RegisterDocumentRow = {
  id: string;
  values: Record<string, string>;
};

export type RegisterDocumentConfig = {
  rows: RegisterDocumentRow[];
  defaultResponsibleUserId: string | null;
  defaultResponsibleTitle: string | null;
  /** Дата окончания в шапке бланка — ставится при закрытии журнала. */
  finishedAt?: string | null;
};

const TITLES: Record<RegisterDocumentTemplateCode, string> = {
  complaint_register: "Журнал регистрации жалоб",
  daily_samples: "Журнал отбора и хранения суточных проб",
  vitaminization: "Журнал проведения витаминизации третьих и сладких блюд",
  ration_control: "Ведомость контроля за рационом питания",
  transport_temperature: "Журнал контроля температуры при транспортировке",
  tableware_breakage: "Журнал учёта боя посуды",
  pool_water_control: "Журнал контроля качества воды в бассейне",
};

function createId(prefix: string) {
  const randomPart =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  return `${prefix}-${randomPart}`;
}

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function isRegisterDocumentTemplate(templateCode: string) {
  return REGISTER_DOCUMENT_TEMPLATE_CODES.includes(
    templateCode as RegisterDocumentTemplateCode
  );
}

export function getRegisterDocumentTitle(templateCode: string) {
  return TITLES[templateCode as RegisterDocumentTemplateCode] || "Журнал";
}

export function getRegisterDocumentFilePrefix(templateCode: string) {
  return `register-${templateCode.replace(/[^a-z0-9-]/gi, "-").toLowerCase()}`;
}

export function getRegisterDocumentCreatePeriodBounds(referenceDate = new Date()) {
  const year = referenceDate.getUTCFullYear();
  const month = referenceDate.getUTCMonth();
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

  return {
    dateFrom: `${year}-${String(month + 1).padStart(2, "0")}-01`,
    dateTo: `${year}-${String(month + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`,
  };
}

export function getRegisterDocumentPeriodLabel(
  dateFrom: Date | string,
  dateTo: Date | string
) {
  const from = new Date(dateFrom);
  const to = new Date(dateTo);
  return `${from.toLocaleDateString("ru-RU")} - ${to.toLocaleDateString("ru-RU")}`;
}

export function parseRegisterFields(fields: unknown): RegisterField[] {
  if (!Array.isArray(fields)) return [];

  return fields
    .map((field) => {
      const item = field as Record<string, unknown>;
      const key = typeof item.key === "string" ? item.key : "";
      if (!key) return null;

      const rawShowIf =
        item.showIf && typeof item.showIf === "object" && !Array.isArray(item.showIf)
          ? (item.showIf as Record<string, unknown>)
          : null;

      return {
        key,
        label: typeof item.label === "string" ? item.label : key,
        type: typeof item.type === "string" ? item.type : "text",
        required: item.required === true,
        options: Array.isArray(item.options)
          ? (item.options as Array<Record<string, unknown>>)
              .map((option) => ({
                value: typeof option.value === "string" ? option.value : "",
                label: typeof option.label === "string" ? option.label : "",
              }))
              .filter((option) => option.value !== "")
          : [],
        showIf:
          rawShowIf &&
          typeof rawShowIf.field === "string" &&
          typeof rawShowIf.equals === "string"
            ? {
                field: rawShowIf.field,
                equals: rawShowIf.equals,
              }
            : null,
      } satisfies RegisterField;
    })
    .filter((field): field is RegisterField => field !== null);
}

export function createRegisterDocumentRow(
  fields: RegisterField[],
  overrides?: Partial<RegisterDocumentRow>
) {
  const values: Record<string, string> = {};

  fields.forEach((field) => {
    values[field.key] = normalizeText(overrides?.values?.[field.key]);
  });

  return {
    id: overrides?.id || createId("register-row"),
    values,
  };
}

/**
 * Конфиг журнала-реестра. Ответственного по умолчанию не угадываем: раньше
 * это был первый сотрудник по алфавиту. Его проставляют «Ответственные за
 * журналы» (слот основного ответственного) при создании документа.
 *
 * `users` оставлен в сигнатуре ради совместимости вызовов.
 */
export function buildRegisterDocumentConfigFromUsers(
  _users: Array<{ id: string; role?: string | null }>
): RegisterDocumentConfig {
  return {
    rows: [],
    defaultResponsibleUserId: null,
    defaultResponsibleTitle: null,
  };
}

export function getDefaultRegisterDocumentConfig() {
  return {
    rows: [],
    defaultResponsibleUserId: null,
    defaultResponsibleTitle: null,
  };
}

export function normalizeRegisterDocumentConfig(
  value: unknown,
  fields: RegisterField[]
): RegisterDocumentConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return getDefaultRegisterDocumentConfig();
  }

  const record = value as Record<string, unknown>;
  const rows = Array.isArray(record.rows)
    ? record.rows
        .map((item) => {
          if (!item || typeof item !== "object" || Array.isArray(item)) return null;
          const rowRecord = item as Record<string, unknown>;
          const rawValues =
            rowRecord.values &&
            typeof rowRecord.values === "object" &&
            !Array.isArray(rowRecord.values)
              ? (rowRecord.values as Record<string, unknown>)
              : {};

          return createRegisterDocumentRow(fields, {
            id:
              typeof rowRecord.id === "string" && rowRecord.id.trim() !== ""
                ? rowRecord.id
                : undefined,
            values: Object.fromEntries(
              fields.map((field) => [field.key, normalizeText(rawValues[field.key])])
            ),
          });
        })
        .filter((item): item is RegisterDocumentRow => item !== null)
    : [];

  return {
    rows,
    defaultResponsibleUserId:
      typeof record.defaultResponsibleUserId === "string" &&
      record.defaultResponsibleUserId.trim() !== ""
        ? record.defaultResponsibleUserId
        : null,
    defaultResponsibleTitle:
      typeof record.defaultResponsibleTitle === "string" &&
      record.defaultResponsibleTitle.trim() !== ""
        ? record.defaultResponsibleTitle
        : null,
    ...(typeof record.finishedAt === "string" && record.finishedAt.trim() !== ""
      ? { finishedAt: record.finishedAt }
      : {}),
  };
}
