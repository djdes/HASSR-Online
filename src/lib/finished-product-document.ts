import {
  isCustomColumnKey,
  legacyFlagsFromColumns,
  sanitizeColumnsConfig,
  type JournalColumnsConfig,
} from "@/lib/journal-columns";

export const FINISHED_PRODUCT_DOCUMENT_TEMPLATE_CODE = "finished_product";
export const FINISHED_PRODUCT_DEFAULT_DOCUMENT_TITLE = "Бракеражный журнал";
export const FINISHED_PRODUCT_ARCHIVE_DOCUMENT_TITLES = [
  "Бракеражный журнал с температурой",
  "Бракераж",
  "Бракеражный журнал",
] as const;
export const FINISHED_PRODUCT_DOCUMENT_TITLE =
  "Журнал бракеража готовой пищевой продукции";

/**
 * Заголовок справочного блока «Рекомендации…». На эталоне это статичная
 * подчёркнутая ссылка под таблицей, а НЕ примечание документа.
 *
 * Исторически этот текст лежал в `config.footerNote` как значение по
 * умолчанию, поэтому поле «Примечание» из диалога создания/настроек
 * никогда не доезжало до документа: пустая строка заменялась на этот
 * заголовок, а заполненная — печаталась подчёркнутой ссылкой. Теперь
 * `footerNote` — это ровно примечание пользователя, а legacy-значение
 * при нормализации отбрасывается.
 */
export const FINISHED_PRODUCT_QUALITY_GUIDE_TITLE =
  "Рекомендации по организации контроля за доброкачественностью готовой пищи";

export type FinishedProductFieldNameMode = "dish" | "semi";
export type FinishedProductInspectorMode = "inspector_name" | "commission_signatures";

export type FinishedProductDocumentRow = {
  id: string;
  productionDateTime: string;
  rejectionTime: string;
  productName: string;
  organoleptic: string;
  productTemp: string;
  correctiveAction: string;
  releasePermissionTime: string;
  courierTransferTime: string;
  oxygenLevel: string;
  responsiblePerson: string;
  inspectorName: string;
  organolepticValue: string;
  organolepticResult: string;
  releaseAllowed: "yes" | "no";
  /**
   * Значения своих колонок организации (`config.columns.custom`), ключ —
   * `custom:<id>`. Храним строками: одинаково для текста, числа, даты,
   * времени, «да/нет», списка и балла — таблица, карточка и печать
   * показывают одно и то же.
   */
  custom?: Record<string, string>;
  /**
   * TaskLink.rowKey of the TasksFlow task that produced this row, if
   * any. The adapter looks it up to update-in-place on re-completion
   * instead of appending a duplicate. Undefined for manual entries.
   */
  sourceRowKey?: string;
};

export type FinishedProductDocumentConfig = {
  rows: FinishedProductDocumentRow[];
  /**
   * Набор колонок документа (скрытые и переименованные), см.
   * `src/lib/journal-columns.ts`. Нет — документ выглядит по флагам `showX`.
   */
  columns?: JournalColumnsConfig;
  fieldNameMode: FinishedProductFieldNameMode;
  inspectorMode: FinishedProductInspectorMode;
  showProductTemp: boolean;
  showCorrectiveAction: boolean;
  showOxygenLevel: boolean;
  showCourierTime: boolean;
  /** Колонка «Разрешение к реализации: Да/Нет» (поле `releaseAllowed`). */
  showReleaseAllowed: boolean;
  footerNote: string;
  productLists: Array<{ id: string; name: string; items: string[] }>;
  itemsCatalog: string[];
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

/**
 * Ячейки своих колонок: только ключи `custom:*`, значения — строки до
 * 500 символов. Пустые не храним, чтобы строка не пухла от выключенных
 * колонок.
 */
export function normalizeCustomCells(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!isCustomColumnKey(key)) continue;
    const text = typeof raw === "string" ? raw.trim().slice(0, 500) : "";
    if (text) result[key] = text;
  }
  return result;
}

/**
 * «Примечание» документа. Пустое — значит примечания нет (блок под
 * таблицей не печатается). Legacy-значение (заголовок справочного блока)
 * приравнивается к пустому — см. FINISHED_PRODUCT_QUALITY_GUIDE_TITLE.
 */
function normalizeFooterNote(value: unknown) {
  const text = normalizeText(value);
  return text === FINISHED_PRODUCT_QUALITY_GUIDE_TITLE ? "" : text;
}

export function createFinishedProductRow(
  overrides: Partial<FinishedProductDocumentRow> = {}
): FinishedProductDocumentRow {
  return {
    id: overrides.id || createId("finished-product-row"),
    productionDateTime: normalizeText(overrides.productionDateTime),
    rejectionTime: normalizeText(overrides.rejectionTime),
    productName: normalizeText(overrides.productName),
    organoleptic: normalizeText(overrides.organoleptic),
    productTemp: normalizeText(overrides.productTemp),
    correctiveAction: normalizeText(overrides.correctiveAction),
    releasePermissionTime: normalizeText(overrides.releasePermissionTime),
    courierTransferTime: normalizeText(overrides.courierTransferTime),
    oxygenLevel: normalizeText(overrides.oxygenLevel),
    responsiblePerson: normalizeText(overrides.responsiblePerson),
    inspectorName: normalizeText(overrides.inspectorName),
    organolepticValue: normalizeText(overrides.organolepticValue),
    organolepticResult: normalizeText(overrides.organolepticResult),
    releaseAllowed: overrides.releaseAllowed === "no" ? "no" : "yes",
    ...(overrides.custom && Object.keys(overrides.custom).length > 0
      ? { custom: normalizeCustomCells(overrides.custom) }
      : {}),
    ...(overrides.sourceRowKey
      ? { sourceRowKey: normalizeText(overrides.sourceRowKey) }
      : {}),
  };
}

export function getDefaultFinishedProductDocumentConfig(): FinishedProductDocumentConfig {
  return {
    rows: [createFinishedProductRow()],
    fieldNameMode: "dish",
    inspectorMode: "inspector_name",
    showProductTemp: true,
    showCorrectiveAction: true,
    showOxygenLevel: false,
    showCourierTime: true,
    showReleaseAllowed: true,
    footerNote: "",
    productLists: [
      { id: createId("finished-product-list"), name: "Основной список", items: [] },
      { id: createId("finished-product-list"), name: "Сезонные позиции", items: [] },
    ],
    itemsCatalog: [],
  };
}

/**
 * Конфиг нового документа по справочнику продуктов организации.
 *
 * Людей в строку НЕ вписываем: раньше «Исполнитель» и «Провёл бракераж»
 * брались строкой из первых двух сотрудников по алфавиту — без сверки, кто
 * это, — и в журнале заказчика стояли случайные люди. Кто заполняет и кто
 * проверяет, решают ответственные документа.
 *
 * `users` оставлен в сигнатуре ради совместимости вызовов.
 */
export function buildFinishedProductConfigFromUsers(
  _users: Array<{ name: string; role?: string | null }>,
  productNames: string[] = []
): FinishedProductDocumentConfig {
  const cfg = getDefaultFinishedProductDocumentConfig();
  cfg.rows = [createFinishedProductRow()];
  cfg.itemsCatalog = productNames;
  if (cfg.productLists.length > 0) {
    cfg.productLists[0] = {
      ...cfg.productLists[0],
      items: productNames.slice(0, Math.min(productNames.length, 24)),
    };
  }
  return cfg;
}

/** Образец для демо-организации и витрины: строка с людьми из ростера. */
export function buildFinishedProductSampleConfig(
  users: Array<{ name: string; role?: string | null }>,
  productNames: string[] = []
): FinishedProductDocumentConfig {
  const cfg = buildFinishedProductConfigFromUsers(users, productNames);
  cfg.rows = [
    createFinishedProductRow({
      responsiblePerson: users[0]?.name || "",
      inspectorName: users[1]?.name || users[0]?.name || "",
    }),
  ];
  return cfg;
}

export function normalizeFinishedProductDocumentConfig(
  value: unknown
): FinishedProductDocumentConfig {
  const defaults = getDefaultFinishedProductDocumentConfig();
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return defaults;
  }

  const record = value as Record<string, unknown>;
  const rows = Array.isArray(record.rows)
    ? record.rows
        .map((item) => {
          if (!item || typeof item !== "object" || Array.isArray(item)) return null;
          return createFinishedProductRow(item as Partial<FinishedProductDocumentRow>);
        })
        .filter((item): item is FinishedProductDocumentRow => item !== null)
    : [];

  // Набор колонок главнее старых флагов: флаги синхронизируются из него,
  // чтобы печать и адаптеры TasksFlow, читающие `showX`, не расходились с
  // таблицей.
  const columns = sanitizeColumnsConfig("finished_product", record.columns, record);
  const columnFlags = columns ? legacyFlagsFromColumns("finished_product", columns) : null;
  const flag = (key: string) =>
    columnFlags && key in columnFlags ? columnFlags[key] === true : record[key] === true;

  return {
    rows: rows.length > 0 ? rows : defaults.rows,
    ...(columns ? { columns } : {}),
    fieldNameMode: record.fieldNameMode === "semi" ? "semi" : defaults.fieldNameMode,
    inspectorMode:
      record.inspectorMode === "commission_signatures"
        ? "commission_signatures"
        : defaults.inspectorMode,
    showProductTemp: flag("showProductTemp"),
    showCorrectiveAction: flag("showCorrectiveAction"),
    showOxygenLevel: flag("showOxygenLevel"),
    showCourierTime: flag("showCourierTime"),
    // Колонка заведена позже: у старого документа ключа в конфиге нет, и
    // выводить её из сохранённого набора колонок нельзя — там её тоже
    // нет, а это не то же самое, что «показывать».
    showReleaseAllowed: record.showReleaseAllowed === true,
    footerNote: normalizeFooterNote(record.footerNote),
    productLists: Array.isArray(record.productLists)
      ? (record.productLists as Array<Record<string, unknown>>)
          .map((list) => ({
            id:
              typeof list.id === "string" && list.id.trim() !== ""
                ? list.id
                : createId("finished-product-list"),
            name:
              typeof list.name === "string" && list.name.trim() !== ""
                ? list.name
                : "Новый список",
            items: Array.isArray(list.items)
              ? (list.items as unknown[])
                  .filter((item) => typeof item === "string")
                  .map((item) => item.trim())
                  .filter((item) => item.length > 0)
              : [],
          }))
          .filter((list) => list.name.length > 0)
      : defaults.productLists,
    itemsCatalog: Array.isArray(record.itemsCatalog)
      ? (record.itemsCatalog as unknown[])
          .filter((item) => typeof item === "string")
          .map((item) => item.trim())
          .filter((item) => item.length > 0)
      : defaults.itemsCatalog,
  };
}

export function getFinishedProductDocumentTitle() {
  return FINISHED_PRODUCT_DOCUMENT_TITLE;
}

export function getFinishedProductDefaultDocumentTitle() {
  return FINISHED_PRODUCT_DEFAULT_DOCUMENT_TITLE;
}

export function buildFinishedProductArchiveSeed(referenceDate = new Date()) {
  const currentYear = referenceDate.getUTCFullYear();
  const currentMonth = referenceDate.getUTCMonth();
  const archiveStart = new Date(Date.UTC(2023, 3, 1));
  const activeFrom = new Date(Date.UTC(currentYear, currentMonth, 1));
  const activeTo = new Date(Date.UTC(currentYear, currentMonth + 1, 0));
  const closed: Array<{ title: string; dateFrom: Date; dateTo: Date }> = [];

  let cursor = new Date(Date.UTC(currentYear, currentMonth - 1, 1));
  let titleIndex = 0;

  while (cursor >= archiveStart) {
    const year = cursor.getUTCFullYear();
    const month = cursor.getUTCMonth();
    closed.push({
      title:
        FINISHED_PRODUCT_ARCHIVE_DOCUMENT_TITLES[
          titleIndex % FINISHED_PRODUCT_ARCHIVE_DOCUMENT_TITLES.length
        ],
      dateFrom: new Date(Date.UTC(year, month, 1)),
      dateTo: new Date(Date.UTC(year, month + 1, 0)),
    });
    cursor = new Date(Date.UTC(year, month - 1, 1));
    titleIndex += 1;
  }

  return {
    active: {
      title: FINISHED_PRODUCT_DEFAULT_DOCUMENT_TITLE,
      dateFrom: activeFrom,
      dateTo: activeTo,
    },
    closed,
  };
}

export function getFinishedProductCreatePeriodBounds(referenceDate = new Date()) {
  const year = referenceDate.getUTCFullYear();
  const month = referenceDate.getUTCMonth();
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

  return {
    dateFrom: `${year}-${String(month + 1).padStart(2, "0")}-01`,
    dateTo: `${year}-${String(month + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`,
  };
}

export function getFinishedProductPeriodLabel(
  dateFrom: Date | string,
  dateTo: Date | string
) {
  const from = new Date(dateFrom);
  const to = new Date(dateTo);
  return `${from.toLocaleDateString("ru-RU")} - ${to.toLocaleDateString("ru-RU")}`;
}

export function getFinishedProductFilePrefix() {
  return "finished-product-journal";
}
