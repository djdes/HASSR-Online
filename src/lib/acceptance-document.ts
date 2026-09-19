import { getUserRoleLabel } from "@/lib/user-roles";

import { rankRosterForSlot } from "@/lib/journal-roster";
export const ACCEPTANCE_DOCUMENT_TEMPLATE_CODE = "incoming_control";
export const RAW_MATERIAL_ACCEPTANCE_TEMPLATE_CODE =
  "incoming_raw_materials_control";
export const ACCEPTANCE_PAGE_TITLE =
  "Журнал входного контроля сырья, ингредиентов, упаковочных материалов";
export const ACCEPTANCE_DOCUMENT_TITLE = "Журнал входного контроля сырья";

export const PRODUCT_ACCEPTANCE_PAGE_TITLE =
  "Журнал приемки и входного контроля продукции";
export const PRODUCT_ACCEPTANCE_DOCUMENT_TITLE =
  "Журнал приемки и входного контроля продукции";

export const ACCEPTANCE_DOCUMENT_TEMPLATE_CODES = [
  ACCEPTANCE_DOCUMENT_TEMPLATE_CODE,
  RAW_MATERIAL_ACCEPTANCE_TEMPLATE_CODE,
] as const;

export function isAcceptanceDocumentTemplate(templateCode: string) {
  return ACCEPTANCE_DOCUMENT_TEMPLATE_CODES.includes(
    templateCode as (typeof ACCEPTANCE_DOCUMENT_TEMPLATE_CODES)[number]
  );
}

export function getAcceptancePageTitle(templateCode: string) {
  if (templateCode === ACCEPTANCE_DOCUMENT_TEMPLATE_CODE) {
    return PRODUCT_ACCEPTANCE_PAGE_TITLE;
  }

  return ACCEPTANCE_PAGE_TITLE;
}

export function getAcceptanceDocumentTitle(templateCode: string) {
  if (templateCode === ACCEPTANCE_DOCUMENT_TEMPLATE_CODE) {
    return PRODUCT_ACCEPTANCE_DOCUMENT_TITLE;
  }

  return ACCEPTANCE_DOCUMENT_TITLE;
}

/**
 * Строка приёмки.
 *
 * ДВЕ СХЕМЫ В ОДНОМ ТИПЕ.
 *
 * • «legacy» поля (`manufacturer`, `supplier`, `transportCondition`,
 *   `packagingCompliance`, `organolepticResult`, `expiryDate`, `note`) —
 *   таблица журнала ВХОДНОГО КОНТРОЛЯ СЫРЬЯ (`incoming_raw_materials_control`).
 *   Там они остаются рабочими колонками.
 *
 * • «v2» поля (`shelfLifeDate`, `manufacturerSupplier`, `accompanyingDocs`,
 *   `batchInfo`, `productTemperature`, `documentCompliance`,
 *   `acceptanceDecision`, `correctiveActions`) — таблица журнала ПРИЁМКИ И
 *   ВХОДНОГО КОНТРОЛЯ ПРОДУКЦИИ (`incoming_control`), приведённая к эталону
 *   lk.haccp-online.ru (11 колонок).
 *
 * Оба набора живут в одном JSON — миграций Prisma не требуется. Старые записи
 * читаются в новую таблицу через маппинг в `createAcceptanceRow` (см. ниже),
 * новые записи пишутся сразу в v2-ключи и дублируют `expiryDate`/`note`,
 * чтобы сторонние потребители (cron сроков годности, карточки, mini) не
 * потеряли данные.
 */
export type AcceptanceRow = {
  id: string;
  deliveryDate: string;
  deliveryHour: string;
  deliveryMinute: string;
  productName: string;
  manufacturer: string;
  supplier: string;
  transportCondition: "satisfactory" | "unsatisfactory";
  packagingCompliance: "compliant" | "non_compliant";
  organolepticResult: "satisfactory" | "unsatisfactory";
  expiryDate: string;
  expiryHour: string;
  expiryMinute: string;
  note: string;
  responsibleTitle: string;
  responsibleUserId: string;
  /**
   * ФИО ответственного, как оно было на момент записи. Нужно потому, что
   * после удаления сотрудника `responsibleUserId` больше ни с кем не
   * сопоставляется и в старых строках ответственный становился пустым.
   * Необязательное поле в JSON — миграция не нужна.
   */
  responsibleName?: string;
  /** v2 · «Годен до». Fallback — legacy `expiryDate`. */
  shelfLifeDate: string;
  /** v2 · «Производитель/поставщик» одной колонкой. Fallback — `manufacturer / supplier`. */
  manufacturerSupplier: string;
  /** v2 · «ТТН, документы соответствия». */
  accompanyingDocs: string;
  /** v2 · «Объем, номер партии, дата пр-ва». */
  batchInfo: string;
  /** v2 · «Внутр-яя темп-ра продукта (для скоропортящихся и замороженных)». */
  productTemperature: string;
  /** v2 · «Соответствие товара сопроводительной документации». Fallback — свод legacy-оценок. */
  documentCompliance: string;
  /** v2 · «Принять/Отклонить, П/О». Fallback — вывод из legacy-оценок. */
  acceptanceDecision: "" | "accept" | "reject";
  /** v2 · «Корректирующие действия для забракованного товара». Fallback — legacy `note`. */
  correctiveActions: string;
  /**
   * Меркурий (2026-09-08): UUID и номер погашенного ВСД, из которого
   * выросла эта строка. Опциональные — миграция не нужна, ровно так же
   * сюда завозили v2-поля. Нужны, чтобы из журнала было видно источник,
   * а из ВСД — куда он попал.
   */
  mercuryVsdUuid?: string;
  mercuryVsdNumber?: string;
  /**
   * Партия (`Batch`), заведённая из этой строки приёмки. Опциональные —
   * миграция не нужна, как у меркурийных ключей. Есть `batchId` → партия
   * по строке уже создана, повторно создавать нельзя.
   */
  batchId?: string;
  batchCode?: string;
};

export type AcceptanceDocumentConfig = {
  rows: AcceptanceRow[];
  products: string[];
  manufacturers: string[];
  suppliers: string[];
  expiryFieldLabel: "expiry_deadline" | "shelf_life";
  showPackagingComplianceField: boolean;
  /**
   * Опциональная 12-я колонка таблицы ПРИЁМКИ ПРОДУКЦИИ (incoming_control):
   * «Соответствие внешнего вида упаковки, маркировки требованиям НД»
   * (I1 аудита). На эталоне это тумблер «Добавить поля» в диалоге
   * создания, выключенный по умолчанию.
   *
   * Не путать с `showPackagingComplianceField` — тот управляет legacy-полем
   * формы журнала входного контроля СЫРЬЯ.
   */
  showPackagingCompliance: boolean;
  defaultResponsibleTitle: string | null;
  defaultResponsibleUserId: string | null;
};

type AcceptanceUser = { id: string; name?: string | null; role?: string | null };
type BuildAcceptanceDocumentConfigParams = {
  users?: AcceptanceUser[];
  products?: string[];
  manufacturers?: string[];
  suppliers?: string[];
  date?: string;
  responsibleTitle?: string | null;
  responsibleUserId?: string | null;
  includeSampleRows?: boolean;
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

function normalizeTransport(value: unknown): "satisfactory" | "unsatisfactory" {
  if (value === "unsatisfactory") return "unsatisfactory";
  return "satisfactory";
}

function normalizeCompliance(value: unknown): "compliant" | "non_compliant" {
  if (value === "non_compliant") return "non_compliant";
  // backward compat: old "no" → non_compliant
  if (value === "no") return "non_compliant";
  return "compliant";
}

function normalizeOrganoleptic(value: unknown): "satisfactory" | "unsatisfactory" {
  if (value === "unsatisfactory") return "unsatisfactory";
  // backward compat: old "reject" → unsatisfactory
  if (value === "reject") return "unsatisfactory";
  return "satisfactory";
}

/**
 * Ключи, по наличию которых строка опознаётся как «старая» (записанная по
 * таблице контроля сырья). Только для таких строк v2-колонки достраиваются
 * из legacy-оценок — у новых пустых строк они остаются пустыми.
 */
const LEGACY_INDICATOR_KEYS = [
  "transportCondition",
  "packagingCompliance",
  "organolepticResult",
  "decision",
] as const;

/** Свод legacy-оценок в текст колонки «Соответствие товара сопр. документации». */
export function composeLegacyComplianceSummary(row: {
  packagingCompliance: AcceptanceRow["packagingCompliance"];
  transportCondition: AcceptanceRow["transportCondition"];
  organolepticResult: AcceptanceRow["organolepticResult"];
}) {
  return [
    `Упаковка, маркировка, документы: ${COMPLIANCE_LABELS[row.packagingCompliance]}`,
    `Транспортировка: ${TRANSPORT_LABELS[row.transportCondition]}`,
    `Органолептика: ${ORGANOLEPTIC_LABELS[row.organolepticResult]}`,
  ].join("; ");
}

export function createAcceptanceRow(
  overrides?: Partial<AcceptanceRow>
): AcceptanceRow {
  const today = new Date().toISOString().slice(0, 10);
  const raw = (overrides || {}) as Record<string, unknown>;
  const has = (key: string) => Object.prototype.hasOwnProperty.call(raw, key);

  const manufacturer = normalizeText(overrides?.manufacturer);
  const supplier = normalizeText(overrides?.supplier);
  const transportCondition = normalizeTransport(overrides?.transportCondition);
  const packagingCompliance = normalizeCompliance(overrides?.packagingCompliance);
  const organolepticResult = normalizeOrganoleptic(
    overrides?.organolepticResult || raw.decision
  );
  const note = normalizeText(overrides?.note) || normalizeText(raw.correctiveAction);
  const hasLegacyIndicators = LEGACY_INDICATOR_KEYS.some((key) => has(key));

  // «Годен до» ↔ «Предельный срок реализации» — зеркалим в обе стороны,
  // чтобы cron сроков годности и карточки продолжали видеть expiryDate.
  const shelfLifeDate = has("shelfLifeDate")
    ? normalizeText(raw.shelfLifeDate)
    : normalizeText(overrides?.expiryDate);
  const expiryDate = normalizeText(overrides?.expiryDate) || shelfLifeDate;

  const manufacturerSupplier = has("manufacturerSupplier")
    ? normalizeText(raw.manufacturerSupplier)
    : [manufacturer, supplier].filter(Boolean).join(" / ");

  const documentCompliance = has("documentCompliance")
    ? normalizeText(raw.documentCompliance)
    : hasLegacyIndicators
      ? composeLegacyComplianceSummary({
          packagingCompliance,
          transportCondition,
          organolepticResult,
        })
      : "";

  const correctiveActions = has("correctiveActions")
    ? normalizeText(raw.correctiveActions)
    : note;

  const acceptanceDecision = normalizeAcceptanceDecision({
    explicit: has("acceptanceDecision") ? raw.acceptanceDecision : undefined,
    hasExplicitKey: has("acceptanceDecision"),
    legacyDecision: raw.decision,
    hasLegacyIndicators,
    transportCondition,
    packagingCompliance,
    organolepticResult,
  });

  return {
    id: overrides?.id || createId("acceptance-row"),
    deliveryDate:
      normalizeText(overrides?.deliveryDate) || normalizeText(raw.dateSupply) || today,
    deliveryHour: normalizeText(overrides?.deliveryHour),
    deliveryMinute: normalizeText(overrides?.deliveryMinute),
    productName: normalizeText(overrides?.productName),
    manufacturer,
    supplier,
    transportCondition,
    packagingCompliance,
    organolepticResult,
    expiryDate,
    expiryHour: normalizeText(overrides?.expiryHour),
    expiryMinute: normalizeText(overrides?.expiryMinute),
    note: note || correctiveActions,
    responsibleTitle: normalizeText(overrides?.responsibleTitle),
    responsibleUserId: normalizeText(overrides?.responsibleUserId),
    ...(has("responsibleName") && normalizeText(raw.responsibleName)
      ? { responsibleName: normalizeText(raw.responsibleName) }
      : {}),
    shelfLifeDate,
    manufacturerSupplier,
    accompanyingDocs: normalizeText(raw.accompanyingDocs),
    batchInfo: normalizeText(raw.batchInfo),
    productTemperature: normalizeText(raw.productTemperature),
    documentCompliance,
    acceptanceDecision,
    correctiveActions,
    // Меркурий: ключи пробрасываем ТОЛЬКО когда они есть, иначе у всех
    // строк появились бы `mercuryVsdUuid: ""`, и по нему нельзя было бы
    // отличить строку из ВСД от заведённой руками.
    ...(has("mercuryVsdUuid")
      ? { mercuryVsdUuid: normalizeText(raw.mercuryVsdUuid) }
      : {}),
    ...(has("mercuryVsdNumber")
      ? { mercuryVsdNumber: normalizeText(raw.mercuryVsdNumber) }
      : {}),
    // Ссылка на партию — по той же причине только при наличии: пустая
    // строка означала бы «партию пробовали создать».
    ...(has("batchId") && normalizeText(raw.batchId)
      ? { batchId: normalizeText(raw.batchId) }
      : {}),
    ...(has("batchCode") && normalizeText(raw.batchCode)
      ? { batchCode: normalizeText(raw.batchCode) }
      : {}),
  };
}

function normalizeAcceptanceDecision(params: {
  explicit: unknown;
  hasExplicitKey: boolean;
  legacyDecision: unknown;
  hasLegacyIndicators: boolean;
  transportCondition: AcceptanceRow["transportCondition"];
  packagingCompliance: AcceptanceRow["packagingCompliance"];
  organolepticResult: AcceptanceRow["organolepticResult"];
}): AcceptanceRow["acceptanceDecision"] {
  if (params.explicit === "accept" || params.explicit === "reject") return params.explicit;
  if (params.hasExplicitKey) return "";
  if (params.legacyDecision === "reject") return "reject";
  if (params.legacyDecision === "accept") return "accept";
  if (!params.hasLegacyIndicators) return "";
  return params.packagingCompliance === "non_compliant" ||
    params.organolepticResult === "unsatisfactory" ||
    params.transportCondition === "unsatisfactory"
    ? "reject"
    : "accept";
}

function normalizeStringList(value: unknown) {
  if (!Array.isArray(value)) return [] as string[];
  return value
    .map((item) => normalizeText(item))
    .filter((item, index, array) => item !== "" && array.indexOf(item) === index);
}

export function getAcceptanceDocumentDefaultConfig(
  users: AcceptanceUser[]
): AcceptanceDocumentConfig {
  // Первого по списку не подставляем: это случайный человек. Правила
  // ростера: без ROOT и аккаунтов-заглушек («имя = почта»), линейный
  // персонал раньше руководства. Никого нет — ответственный не назначен.
  const defaultResponsibleUserId = pickAcceptanceResponsibleUser(users)?.id || null;

  return {
    rows: [],
    products: [],
    manufacturers: [],
    suppliers: [],
    expiryFieldLabel: "expiry_deadline",
    showPackagingComplianceField: true,
    showPackagingCompliance: false,
    defaultResponsibleTitle: null,
    defaultResponsibleUserId,
  };
}

/**
 * Ответственный за приёмку по умолчанию. Раньше — первый управляющий, и им
 * оказывался аккаунт мгновенной регистрации, названный почтой.
 */
function pickAcceptanceResponsibleUser(users: AcceptanceUser[]): AcceptanceUser | null {
  const ranked = rankRosterForSlot(
    users.map((user) => ({ ...user, name: user.name ?? "" })),
    { kind: "filler" }
  );
  return ranked ? users.find((user) => user.id === ranked.id) ?? null : null;
}

function addDays(date: string, delta: number) {
  const value = new Date(`${date}T00:00:00`);
  if (Number.isNaN(value.getTime())) return date;
  value.setDate(value.getDate() + delta);
  return value.toISOString().slice(0, 10);
}

function sanitizeList(values: string[]) {
  return values
    .map((item) => normalizeText(item))
    .filter((item, index, array) => item !== "" && array.indexOf(item) === index);
}

function buildAcceptanceSampleRows(params: {
  date: string;
  products: string[];
  manufacturers: string[];
  suppliers: string[];
  responsibleTitle: string;
  responsibleUserId: string;
}) {
  const productA = params.products[0] || "Гастрономия";
  const productB = params.products[1] || params.products[0] || "Молочная продукция";
  const manufacturerA = params.manufacturers[0] || "ООО \"Агро-Юг\"";
  const manufacturerB = params.manufacturers[1] || manufacturerA || "ООО \"Запад-Восток\"";
  const supplierA = params.suppliers[0] || "ООО \"Метро\"";
  const supplierB = params.suppliers[1] || supplierA || "ООО \"Агро-Юг\"";

  return [
    createAcceptanceRow({
      deliveryDate: params.date,
      deliveryHour: "11",
      deliveryMinute: "00",
      productName: productA,
      manufacturer: manufacturerA,
      supplier: supplierA,
      transportCondition: "satisfactory",
      packagingCompliance: "compliant",
      organolepticResult: "satisfactory",
      expiryDate: params.date,
      note: "",
      responsibleTitle: params.responsibleTitle,
      responsibleUserId: params.responsibleUserId,
    }),
    createAcceptanceRow({
      deliveryDate: addDays(params.date, 1),
      deliveryHour: "12",
      deliveryMinute: "15",
      productName: productB,
      manufacturer: manufacturerB,
      supplier: supplierB,
      transportCondition: "satisfactory",
      packagingCompliance: "compliant",
      organolepticResult: "satisfactory",
      expiryDate: addDays(params.date, 1),
      note: "",
      responsibleTitle: params.responsibleTitle,
      responsibleUserId: params.responsibleUserId,
    }),
  ];
}

export function buildAcceptanceDocumentConfigFromData(
  params: BuildAcceptanceDocumentConfigParams = {}
): AcceptanceDocumentConfig {
  const users = params.users || [];
  const fallback = getAcceptanceDocumentDefaultConfig(users);
  const responsibleUser =
    users.find((user) => user.id === params.responsibleUserId) ||
    pickAcceptanceResponsibleUser(users);
  const responsibleTitle =
    normalizeText(params.responsibleTitle) ||
    (responsibleUser?.role ? getUserRoleLabel(responsibleUser.role) : "") ||
    fallback.defaultResponsibleTitle ||
    "Управляющий";
  const responsibleUserId =
    normalizeText(params.responsibleUserId) || responsibleUser?.id || fallback.defaultResponsibleUserId || "";
  const date = normalizeText(params.date) || new Date().toISOString().slice(0, 10);
  const products = sanitizeList(params.products || []);
  const manufacturers = sanitizeList(params.manufacturers || []);
  const suppliers = sanitizeList(params.suppliers || []);

  return {
    rows: params.includeSampleRows
      ? buildAcceptanceSampleRows({
          date,
          products,
          manufacturers,
          suppliers,
          responsibleTitle,
          responsibleUserId,
        })
      : [],
    products,
    manufacturers,
    suppliers,
    expiryFieldLabel: "expiry_deadline",
    showPackagingComplianceField: true,
    showPackagingCompliance: false,
    defaultResponsibleTitle: responsibleTitle || null,
    defaultResponsibleUserId: responsibleUserId || null,
  };
}

export function normalizeAcceptanceDocumentConfig(
  value: unknown,
  users: Array<{ id: string; role?: string | null }> = []
): AcceptanceDocumentConfig {
  const fallback = getAcceptanceDocumentDefaultConfig(users);

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return fallback;
  }

  const record = value as Record<string, unknown>;
  const rows = Array.isArray(record.rows)
    ? record.rows
        .map((item) => {
          if (!item || typeof item !== "object" || Array.isArray(item)) return null;
          return createAcceptanceRow(item as Partial<AcceptanceRow>);
        })
        .filter((item): item is AcceptanceRow => item !== null)
    : [];

  const defaultResponsibleUserId = normalizeText(record.defaultResponsibleUserId);
  const defaultResponsibleTitle = normalizeText(record.defaultResponsibleTitle);

  return {
    rows,
    products: normalizeStringList(record.products),
    manufacturers: normalizeStringList(record.manufacturers),
    suppliers: normalizeStringList(record.suppliers),
    expiryFieldLabel: record.expiryFieldLabel === "shelf_life" ? "shelf_life" : "expiry_deadline",
    showPackagingComplianceField:
      typeof record.showPackagingComplianceField === "boolean"
        ? record.showPackagingComplianceField
        : true,
    showPackagingCompliance: record.showPackagingCompliance === true,
    defaultResponsibleUserId:
      defaultResponsibleUserId || fallback.defaultResponsibleUserId,
    defaultResponsibleTitle: defaultResponsibleTitle || null,
  };
}

export function formatAcceptanceDateDash(date: string): string {
  if (!date) return "";
  const [year, month, day] = date.split("-");
  return year && month && day ? `${day}-${month}-${year}` : date;
}

export function formatDeliveryDateTime(row: AcceptanceRow): string {
  let s = formatAcceptanceDateDash(row.deliveryDate);
  if (row.deliveryHour) {
    s += `\n${row.deliveryHour}:${row.deliveryMinute || "00"}`;
  }
  return s;
}

export function formatExpiryDateTime(row: AcceptanceRow): string {
  let s = formatAcceptanceDateDash(row.expiryDate);
  if (row.expiryHour) {
    s += `\n${row.expiryHour}:${row.expiryMinute || "00"}`;
  }
  return s;
}

export const TRANSPORT_LABELS = {
  satisfactory: "Удовл.",
  unsatisfactory: "Не удовл.",
} as const;

export const COMPLIANCE_LABELS = {
  compliant: "Соответствует",
  non_compliant: "Не соотв.",
} as const;

export const ORGANOLEPTIC_LABELS = {
  satisfactory: "Удовл.",
  unsatisfactory: "Не удовл.",
} as const;

export function getExpiryFieldDisplayLabel(mode: AcceptanceDocumentConfig["expiryFieldLabel"]): string {
  return mode === "shelf_life" ? "Срок годности" : "Предельный срок реализации (дата, час)";
}

/* ------------------------------------------------------------------ *
 * v2 · «Журнал приемки и входного контроля продукции» (incoming_control)
 * ------------------------------------------------------------------ */

/** Подписи колонки «Принять/Отклонить, П/О». */
export const ACCEPTANCE_DECISION_LABELS = {
  accept: "П",
  reject: "О",
  "": "",
} as const;

/** Развёрнутые подписи для формы и карточек. */
export const ACCEPTANCE_DECISION_FULL_LABELS = {
  accept: "П — Принять",
  reject: "О — Отклонить",
} as const;

/**
 * Заголовки 11 колонок эталона incoming_control-grid.png.
 * Один источник для экрана, печати и PDF.
 */
export const INCOMING_CONTROL_COLUMNS = [
  "Дата поставки",
  "Наименование продукции",
  "Годен до",
  "Производитель/поставщик",
  "ТТН, документы соответствия",
  "Объем, номер партии, дата пр-ва",
  "Внутр-яя темп-ра продукта (для скоропортящихся и замороженных продуктов)",
  "Соответствие товара сопроводительной документации",
  "Принять/Отклонить, П/О",
  "Корректирующие действия для забракованного товара",
  "Ответственный",
] as const;

/** Подпись опциональной 12-й колонки (config.showPackagingCompliance). */
export const INCOMING_CONTROL_PACKAGING_COLUMN =
  "Соответствие внешнего вида упаковки, маркировки требованиям НД";

/**
 * Колонки таблицы приёмки продукции с учётом опциональной 12-й:
 * она встаёт СРАЗУ ПОСЛЕ «Соответствие товара сопроводительной
 * документации», как на эталоне.
 */
export function getIncomingControlColumns(
  showPackagingCompliance: boolean
): string[] {
  const columns: string[] = [...INCOMING_CONTROL_COLUMNS];
  if (!showPackagingCompliance) return columns;
  const anchor = columns.indexOf(
    "Соответствие товара сопроводительной документации"
  );
  columns.splice(anchor + 1, 0, INCOMING_CONTROL_PACKAGING_COLUMN);
  return columns;
}

/* ─── Приёмка → партия (`Batch`) ─────────────────────────────────── */

export type AcceptanceBatchDraft = {
  productName: string;
  supplier: string | null;
  quantity: number;
  unit: string;
  receivedAt: string | null;
  expiryDate: string | null;
  notes: string | null;
};

/** Единицы, которые реально пишут в «Объём, номер партии, дата пр-ва». */
const BATCH_UNIT_PATTERNS: Array<[RegExp, string]> = [
  [/(^|[^а-яё])(кг|kg)([^а-яё]|$)/i, "kg"],
  [/(^|[^а-яё])(г|гр|g)([^а-яё]|$)/i, "g"],
  [/(^|[^а-яё])(т|тонн\w*)([^а-яё]|$)/i, "t"],
  [/(^|[^а-яё])(л|l)([^а-яё]|$)/i, "l"],
  [/(^|[^а-яё])(мл|ml)([^а-яё]|$)/i, "ml"],
  [/(^|[^а-яё])(шт\.?|уп\.?)([^а-яё]|$)/i, "pcs"],
];

/**
 * Количество из свободного текста «Объём, номер партии, дата пр-ва».
 * Берём первое число и ближайшую единицу; не нашли — 0 и «kg», партию
 * всё равно заводим, количество поправят на карточке партии.
 */
export function parseAcceptanceQuantity(text: unknown): { quantity: number; unit: string } {
  const raw = normalizeText(text);
  const match = /(\d+(?:[.,]\d+)?)/.exec(raw);
  const quantity = match ? Number(match[1].replace(",", ".")) : 0;
  let unit = "kg";
  for (const [pattern, code] of BATCH_UNIT_PATTERNS) {
    if (pattern.test(raw)) {
      unit = code;
      break;
    }
  }
  return {
    quantity: Number.isFinite(quantity) && quantity >= 0 ? quantity : 0,
    unit,
  };
}

/**
 * Партию заводим только по строке, которую действительно приняли, и
 * только один раз: `batchId` в строке — признак, что партия уже есть.
 */
export function canCreateBatchFromAcceptanceRow(row: AcceptanceRow): boolean {
  if (normalizeText(row.batchId)) return false;
  if (!normalizeText(row.productName)) return false;
  return row.acceptanceDecision !== "reject";
}

/**
 * Чистое отображение «строка приёмки → черновик партии». Ничего не
 * сохраняет: результат уходит в POST /api/batches.
 */
export function acceptanceRowToBatchDraft(row: AcceptanceRow): AcceptanceBatchDraft {
  const { quantity, unit } = parseAcceptanceQuantity(row.batchInfo);
  const supplier =
    normalizeText(row.supplier) ||
    normalizeText(row.manufacturerSupplier) ||
    normalizeText(row.manufacturer);
  const expiryDate = normalizeText(row.shelfLifeDate) || normalizeText(row.expiryDate);
  const notes = [
    normalizeText(row.batchInfo) ? `Партия/объём: ${normalizeText(row.batchInfo)}` : "",
    normalizeText(row.accompanyingDocs) ? `Документы: ${normalizeText(row.accompanyingDocs)}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    productName: normalizeText(row.productName),
    supplier: supplier || null,
    quantity,
    unit,
    receivedAt: isIsoDate(row.deliveryDate) ? normalizeText(row.deliveryDate) : null,
    expiryDate: isIsoDate(expiryDate) ? expiryDate : null,
    notes: notes || null,
  };
}

function isIsoDate(value: unknown): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(normalizeText(value));
}

/** Значения 10 колонок строки (без «Ответственный» — он резолвится по users). */
export function getIncomingControlRowValues(row: AcceptanceRow) {
  return {
    deliveryDate: formatAcceptanceDateDash(row.deliveryDate),
    productName: row.productName,
    shelfLifeDate: formatAcceptanceDateDash(row.shelfLifeDate || row.expiryDate),
    manufacturerSupplier:
      row.manufacturerSupplier ||
      [row.manufacturer, row.supplier].filter(Boolean).join(" / "),
    accompanyingDocs: row.accompanyingDocs,
    batchInfo: row.batchInfo,
    productTemperature: row.productTemperature,
    documentCompliance: row.documentCompliance,
    acceptanceDecision: ACCEPTANCE_DECISION_LABELS[row.acceptanceDecision] || "",
    correctiveActions: row.correctiveActions || row.note,
  };
}
