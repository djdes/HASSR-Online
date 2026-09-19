export const TRACEABILITY_DOCUMENT_TEMPLATE_CODE = "traceability_test";
export const TRACEABILITY_DOCUMENT_TITLE = "Журнал прослеживаемости продукции";
export const TRACEABILITY_DOCUMENT_SOURCE_SLUG = "traceabilityjournal";

export const TRACEABILITY_IMPORT_COLUMNS = [
  "Дата",
  "Наименование сырья",
  "Номер партии ПФ",
  "Дата фасовки",
  "Кол-во, шт./кг.",
  "Наименование ПФ",
  "Кол-во фасовок, шт./кг.",
  "T °C продукта после шоковой заморозки",
] as const;

export type TraceabilityIncomingBlock = {
  rawMaterialName: string;
  batchNumber: string;
  packagingDate: string;
  quantityPieces: number | null;
  quantityKg: number | null;
  /**
   * Партия (`Batch`), из которой взято сырьё. Опциональное поле — старые
   * строки его не имеют и работают как раньше. Название и номер партии
   * при этом остаются в `rawMaterialName` / `batchNumber` снимком текста:
   * партию могут переименовать или удалить, а журнал должен читаться.
   */
  batchId?: string;
};

export type TraceabilityOutgoingBlock = {
  productName: string;
  quantityPacksPieces: number | null;
  quantityPacksKg: number | null;
  shockTemp: number | null;
};

export type TraceabilityRow = {
  id: string;
  date: string;
  incoming: TraceabilityIncomingBlock;
  outgoing: TraceabilityOutgoingBlock;
  responsibleRole: string | null;
  responsibleEmployeeId: string | null;
  responsibleEmployee: string | null;
};

export type TraceabilityDocumentConfig = {
  documentTitle: string;
  dateFrom: string;
  showShockTempField: boolean;
  showShipmentBlock: boolean;
  rawMaterialList: string[];
  productList: string[];
  rows: TraceabilityRow[];
  defaultResponsibleRole: string | null;
  defaultResponsibleEmployeeId: string | null;
  defaultResponsibleEmployee: string | null;
};

export type TraceabilityRowValidationIssue = {
  field: string;
  message: string;
};

/**
 * Значения по умолчанию для документа организации. Списки сырья и
 * продукции пустые — это справочники самой организации. Раньше здесь были
 * «Мука», «Пельмени» и дата 01.01.2025, и нормализатор возвращал их даже
 * после того, как человек очистил списки.
 */
const TRACEABILITY_DEFAULTS: TraceabilityDocumentConfig = {
  documentTitle: TRACEABILITY_DOCUMENT_TITLE,
  dateFrom: "",
  showShockTempField: true,
  showShipmentBlock: false,
  rawMaterialList: [],
  productList: [],
  rows: [],
  defaultResponsibleRole: null,
  defaultResponsibleEmployeeId: null,
  defaultResponsibleEmployee: "",
};

/** Образец для демо-организации и витрины. */
const TRACEABILITY_SAMPLE: TraceabilityDocumentConfig = {
  ...TRACEABILITY_DEFAULTS,
  dateFrom: "2025-01-01",
  rawMaterialList: ["Мука"],
  productList: ["Пельмени"],
  defaultResponsibleRole: "Управляющий",
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

function normalizeNullableText(value: unknown) {
  const text = normalizeText(value);
  return text || null;
}

function normalizeBoolean(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().replace(/\s+/g, "").replace(",", ".");
    if (normalized === "") return null;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function normalizeDateString(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  const text = normalizeText(value);
  if (!text) return "";

  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return text;
  }

  const dotMatch = text.match(/^(\d{2})[./-](\d{2})[./-](\d{4})$/);
  if (dotMatch) {
    const [, day, month, year] = dotMatch;
    return `${year}-${month}-${day}`;
  }

  return "";
}

function isValidIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const [year, month, day] = value.split("-").map((part) => Number(part));
  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function normalizeStringList(value: unknown) {
  if (!Array.isArray(value)) return [] as string[];

  const seen = new Set<string>();
  const items: string[] = [];

  for (const item of value) {
    const text = normalizeText(item);
    if (!text) continue;

    const key = text.toLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    items.push(text);
  }

  return items;
}

function normalizeQuantityField(value: unknown): number | null {
  return normalizeNumber(value);
}

function normalizeIncoming(value: unknown): TraceabilityIncomingBlock {
  const record =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};

  return {
    rawMaterialName:
      normalizeText(record.rawMaterialName ?? record.materialName ?? record.name),
    batchNumber: normalizeText(record.batchNumber ?? record.pfBatchNumber),
    packagingDate: normalizeDateString(record.packagingDate ?? record.packagingAt),
    quantityPieces: normalizeQuantityField(
      record.quantityPieces ?? record.quantityPcs ?? record.pieces
    ),
    quantityKg: normalizeQuantityField(record.quantityKg ?? record.quantity),
    ...(normalizeText(record.batchId) ? { batchId: normalizeText(record.batchId) } : {}),
  };
}

function normalizeOutgoing(value: unknown): TraceabilityOutgoingBlock {
  const record =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};

  return {
    productName: normalizeText(record.productName ?? record.name),
    quantityPacksPieces: normalizeQuantityField(
      record.quantityPacksPieces ?? record.packagesPieces ?? record.packsPieces
    ),
    quantityPacksKg: normalizeQuantityField(
      record.quantityPacksKg ?? record.packagesKg ?? record.packsKg
    ),
    shockTemp: normalizeQuantityField(record.shockTemp ?? record.temperature),
  };
}

export function createTraceabilityRow(
  overrides: Partial<TraceabilityRow> & {
    incoming?: Partial<TraceabilityIncomingBlock>;
    outgoing?: Partial<TraceabilityOutgoingBlock>;
  } = {}
): TraceabilityRow {
  const hasIncomingRawMaterialName =
    overrides.incoming && Object.prototype.hasOwnProperty.call(overrides.incoming, "rawMaterialName");
  const hasIncomingBatchNumber =
    overrides.incoming && Object.prototype.hasOwnProperty.call(overrides.incoming, "batchNumber");
  const hasIncomingPackagingDate =
    overrides.incoming && Object.prototype.hasOwnProperty.call(overrides.incoming, "packagingDate");
  const hasIncomingQuantityPieces =
    overrides.incoming && Object.prototype.hasOwnProperty.call(overrides.incoming, "quantityPieces");
  const hasIncomingQuantityKg =
    overrides.incoming && Object.prototype.hasOwnProperty.call(overrides.incoming, "quantityKg");
  const hasOutgoingProductName =
    overrides.outgoing && Object.prototype.hasOwnProperty.call(overrides.outgoing, "productName");
  const hasOutgoingQuantityPacksPieces =
    overrides.outgoing &&
    Object.prototype.hasOwnProperty.call(overrides.outgoing, "quantityPacksPieces");
  const hasOutgoingQuantityPacksKg =
    overrides.outgoing && Object.prototype.hasOwnProperty.call(overrides.outgoing, "quantityPacksKg");
  const hasOutgoingShockTemp =
    overrides.outgoing && Object.prototype.hasOwnProperty.call(overrides.outgoing, "shockTemp");
  const hasResponsibleRole = Object.prototype.hasOwnProperty.call(overrides, "responsibleRole");
  const hasResponsibleEmployeeId = Object.prototype.hasOwnProperty.call(
    overrides,
    "responsibleEmployeeId"
  );
  const hasResponsibleEmployee = Object.prototype.hasOwnProperty.call(
    overrides,
    "responsibleEmployee"
  );

  return {
    id: overrides.id || createId("traceability-row"),
    date:
      overrides.date !== undefined
        ? normalizeDateString(overrides.date)
        : TRACEABILITY_DEFAULTS.dateFrom,
    incoming: {
      rawMaterialName:
        hasIncomingRawMaterialName
          ? normalizeText(overrides.incoming?.rawMaterialName)
          : TRACEABILITY_DEFAULTS.rawMaterialList[0] || "",
      batchNumber: hasIncomingBatchNumber
        ? normalizeText(overrides.incoming?.batchNumber)
        : "",
      packagingDate:
        hasIncomingPackagingDate
          ? normalizeDateString(overrides.incoming?.packagingDate)
          : TRACEABILITY_DEFAULTS.dateFrom,
      quantityPieces: hasIncomingQuantityPieces
        ? normalizeQuantityField(overrides.incoming?.quantityPieces)
        : null,
      quantityKg: hasIncomingQuantityKg ? normalizeQuantityField(overrides.incoming?.quantityKg) : null,
      ...(normalizeText(overrides.incoming?.batchId)
        ? { batchId: normalizeText(overrides.incoming?.batchId) }
        : {}),
    },
    outgoing: {
      productName:
        hasOutgoingProductName
          ? normalizeText(overrides.outgoing?.productName)
          : TRACEABILITY_DEFAULTS.productList[0] || "",
      quantityPacksPieces: hasOutgoingQuantityPacksPieces
        ? normalizeQuantityField(overrides.outgoing?.quantityPacksPieces)
        : null,
      quantityPacksKg: hasOutgoingQuantityPacksKg
        ? normalizeQuantityField(overrides.outgoing?.quantityPacksKg)
        : null,
      shockTemp: hasOutgoingShockTemp ? normalizeQuantityField(overrides.outgoing?.shockTemp) : null,
    },
    responsibleRole: hasResponsibleRole
      ? normalizeNullableText(overrides.responsibleRole)
      : TRACEABILITY_DEFAULTS.defaultResponsibleRole,
    responsibleEmployeeId: hasResponsibleEmployeeId
      ? normalizeNullableText(overrides.responsibleEmployeeId)
      : TRACEABILITY_DEFAULTS.defaultResponsibleEmployeeId,
    responsibleEmployee: hasResponsibleEmployee
      ? normalizeNullableText(overrides.responsibleEmployee)
      : TRACEABILITY_DEFAULTS.defaultResponsibleEmployee,
  };
}

export function normalizeTraceabilityRow(value: unknown): TraceabilityRow {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return createTraceabilityRow();
  }

  const record = value as Record<string, unknown>;
  const incoming =
    record.incoming && typeof record.incoming === "object" && !Array.isArray(record.incoming)
      ? record.incoming
      : record;
  const outgoing =
    record.outgoing && typeof record.outgoing === "object" && !Array.isArray(record.outgoing)
      ? record.outgoing
      : record;

  return createTraceabilityRow({
    id: normalizeText(record.id) || undefined,
    date: normalizeDateString(record.date),
    incoming: normalizeIncoming(incoming),
    outgoing: normalizeOutgoing(outgoing),
    responsibleRole: normalizeNullableText(record.responsibleRole),
    responsibleEmployeeId: normalizeNullableText(record.responsibleEmployeeId),
    responsibleEmployee: normalizeNullableText(record.responsibleEmployee),
  });
}

export function getDefaultTraceabilityDocumentConfig(): TraceabilityDocumentConfig {
  return {
    ...TRACEABILITY_DEFAULTS,
    rows: [],
    rawMaterialList: [],
    productList: [],
  };
}

export function getTraceabilitySampleConfig(): TraceabilityDocumentConfig {
  return {
    ...TRACEABILITY_SAMPLE,
    rows: [],
    rawMaterialList: [...TRACEABILITY_SAMPLE.rawMaterialList],
    productList: [...TRACEABILITY_SAMPLE.productList],
  };
}

export function normalizeTraceabilityDocumentConfig(
  value: unknown
): TraceabilityDocumentConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return getDefaultTraceabilityDocumentConfig();
  }

  const record = value as Record<string, unknown>;
  const rows = Array.isArray(record.rows)
    ? record.rows
        .map((item) => {
          try {
            return normalizeTraceabilityRow(item);
          } catch {
            return null;
          }
        })
        .filter((item): item is TraceabilityRow => item !== null)
    : [];

  const documentTitle = normalizeText(record.documentTitle);
  const dateFrom = normalizeDateString(record.dateFrom);
  const defaultResponsibleRole = normalizeNullableText(record.defaultResponsibleRole);
  const defaultResponsibleEmployeeId = normalizeNullableText(
    record.defaultResponsibleEmployeeId
  );
  const defaultResponsibleEmployee = normalizeNullableText(
    record.defaultResponsibleEmployee
  );

  return {
    documentTitle: documentTitle || TRACEABILITY_DEFAULTS.documentTitle,
    dateFrom: dateFrom || TRACEABILITY_DEFAULTS.dateFrom,
    showShockTempField: normalizeBoolean(
      record.showShockTempField,
      TRACEABILITY_DEFAULTS.showShockTempField
    ),
    showShipmentBlock: normalizeBoolean(
      record.showShipmentBlock,
      TRACEABILITY_DEFAULTS.showShipmentBlock
    ),
    rawMaterialList: normalizeStringList(record.rawMaterialList),
    productList: normalizeStringList(record.productList),
    rows,
    defaultResponsibleRole:
      defaultResponsibleRole ?? TRACEABILITY_DEFAULTS.defaultResponsibleRole,
    defaultResponsibleEmployeeId:
      defaultResponsibleEmployeeId ?? TRACEABILITY_DEFAULTS.defaultResponsibleEmployeeId,
    defaultResponsibleEmployee:
      defaultResponsibleEmployee ?? TRACEABILITY_DEFAULTS.defaultResponsibleEmployee,
  };
}

export function formatTraceabilityQuantity(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "";

  return value
    .toFixed(3)
    .replace(/\.?0+$/, "")
    .replace(".", ",");
}

export function validateTraceabilityRow(row: TraceabilityRow) {
  const issues: TraceabilityRowValidationIssue[] = [];

  if (!isValidIsoDate(row.date)) {
    issues.push({ field: "date", message: "Дата должна быть в формате ГГГГ-ММ-ДД" });
  }

  if (!normalizeText(row.incoming.rawMaterialName)) {
    issues.push({
      field: "incoming.rawMaterialName",
      message: "Наименование сырья обязательно",
    });
  }

  if (!normalizeText(row.incoming.batchNumber)) {
    issues.push({
      field: "incoming.batchNumber",
      message: "Номер партии ПФ обязателен",
    });
  }

  if (!isValidIsoDate(row.incoming.packagingDate)) {
    issues.push({
      field: "incoming.packagingDate",
      message: "Дата фасовки должна быть в формате ГГГГ-ММ-ДД",
    });
  }

  if (row.incoming.quantityPieces == null && row.incoming.quantityKg == null) {
    issues.push({
      field: "incoming.quantity",
      message: "Количество поступившего сырья обязательно",
    });
  }

  if (!normalizeText(row.outgoing.productName)) {
    issues.push({
      field: "outgoing.productName",
      message: "Наименование ПФ обязательно",
    });
  }

  if (row.outgoing.quantityPacksPieces == null && row.outgoing.quantityPacksKg == null) {
    issues.push({
      field: "outgoing.quantity",
      message: "Количество выпущенной продукции обязательно",
    });
  }

  if (row.outgoing.shockTemp != null && !Number.isFinite(row.outgoing.shockTemp)) {
    issues.push({
      field: "outgoing.shockTemp",
      message: "Температура должна быть числом",
    });
  }

  return issues;
}

export function getTraceabilityDocumentTitle() {
  return TRACEABILITY_DOCUMENT_TITLE;
}

export function isTraceabilityDocumentTemplate(code: string) {
  return code === TRACEABILITY_DOCUMENT_TEMPLATE_CODE;
}
