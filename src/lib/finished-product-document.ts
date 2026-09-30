import {
  isCustomColumnKey,
  legacyFlagsFromColumns,
  sanitizeColumnsConfig,
  type JournalColumnsConfig,
} from "@/lib/journal-columns";
import { BRAKERAGE_TIME_OFFSETS_DEFAULT } from "@/lib/brakerage-times";
import { modernizeGradeWording } from "@/lib/brakerage-grade-wording";
import {
  formatRowSignatures,
  normalizeCommissionMembers as normalizeBrakerageCommission,
  normalizeRowSignatures,
  type BrakerageCommissionMember,
  type BrakerageRowSignature,
} from "@/lib/brakerage-commission";

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
  /** «Результат взвешивания порционных блюд» (вес выход): «150», «200/10». */
  portionWeight: string;
  /** «Примечание» строки (колонка формы Приложения 4). */
  note: string;
  /**
   * Подписи членов комиссии. Копия `SignatureEvent`, которой владеет
   * сервер: клиент её не меняет (см. brakerage-row-merge.ts).
   */
  signatures?: BrakerageRowSignature[];
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

/** Член бракеражной комиссии: кто подписывает журнал. */
export type FinishedProductCommissionMember = BrakerageCommissionMember;

/**
 * Константы времени бракеража: на сколько минут назад ставить время в
 * новой строке. Изготовление снимают раньше самой проверки, поэтому у
 * него сдвиг больше. Раньше обе величины были зашиты в клиент.
 */
export type FinishedProductTimeDefaults = {
  /** «Дата, время изготовления» — минут назад от текущего момента. */
  productionMinutesAgo: number;
  /** Устарело: «время бракеража — минут назад». Читается у старых документов, не используется. */
  rejectionMinutesAgo: number;
  /** «Время снятия бракеража» = изготовление + N минут (по умолчанию 5). */
  rejectionAfterProductionMinutes: number;
  /** «Время разрешения к реализации» = бракераж + N минут (по умолчанию 5). */
  releaseAfterRejectionMinutes: number;
};

export const FINISHED_PRODUCT_TIME_DEFAULTS: FinishedProductTimeDefaults = {
  productionMinutesAgo: 30,
  rejectionMinutesAgo: 0,
  rejectionAfterProductionMinutes: BRAKERAGE_TIME_OFFSETS_DEFAULT.rejectionAfterProductionMinutes,
  releaseAfterRejectionMinutes: BRAKERAGE_TIME_OFFSETS_DEFAULT.releaseAfterRejectionMinutes,
};
export const FINISHED_PRODUCT_TIME_MINUTES_MAX = 24 * 60;

/** Стандартные оценки: у блюд — четыре балла, у полуфабрикатов — соответствие. */
export const FINISHED_PRODUCT_ORGANOLEPTIC_DISH = [
  "Отлично",
  "Хорошо",
  "Удовлетворительно",
  "Неудовлетворительно",
  "Доброкачественно",
  "Недоброкачественно",
];
export const FINISHED_PRODUCT_ORGANOLEPTIC_SEMI = [
  "Соответствует",
  "Требует доработки",
  "Не соответствует",
  "Доброкачественно",
  "Недоброкачественно",
];
export const FINISHED_PRODUCT_ORGANOLEPTIC_MAX = 20;

/**
 * Оценки документа: свои, если заданы, иначе стандартные по режиму
 * наименования (блюдо или полуфабрикат).
 */
export function getFinishedProductOrganolepticOptions(
  config: Pick<FinishedProductDocumentConfig, "organolepticOptions" | "fieldNameMode">
): string[] {
  if (config.organolepticOptions.length > 0) return config.organolepticOptions;
  return config.fieldNameMode === "semi"
    ? FINISHED_PRODUCT_ORGANOLEPTIC_SEMI
    : FINISHED_PRODUCT_ORGANOLEPTIC_DISH;
}

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
  /** «Ответственный исполнитель» — нет флага у старых документов: видна. */
  showResponsible: boolean;
  /** «ФИО лица, проводившего бракераж» — нет флага у старых документов: видна. */
  showInspector: boolean;
  footerNote: string;
  productLists: Array<{ id: string; name: string; items: string[] }>;
  itemsCatalog: string[];
  /**
   * Меню, которое мастер-кабинет справочников прислал в прошлый раз
   * (`src/lib/master-directory-push.ts`): по нему следующая раздача убирает
   * из `itemsCatalog` только позиции мастера, а свои позиции кухни остаются.
   */
  sharedCatalog?: string[];
  /** Состав бракеражной комиссии — подписи под журналом и выбор в QR-форме. */
  commissionMembers: FinishedProductCommissionMember[];
  /** Константы времени для новой строки. */
  timeDefaults: FinishedProductTimeDefaults;
  /** Свои варианты оценки; пусто — стандартные по режиму наименования. */
  organolepticOptions: string[];
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

/** Состав комиссии: имя обязательно, иначе строку отбрасываем. */
export function normalizeCommissionMembers(value: unknown): FinishedProductCommissionMember[] {
  return normalizeBrakerageCommission(value);
}

/** Константы времени: целые минуты в пределах суток. */
export function normalizeTimeDefaults(value: unknown): FinishedProductTimeDefaults {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const clamp = (raw: unknown, fallback: number) => {
    const minutes = typeof raw === "number" ? Math.round(raw) : Number.NaN;
    if (!Number.isFinite(minutes)) return fallback;
    return Math.min(FINISHED_PRODUCT_TIME_MINUTES_MAX, Math.max(0, minutes));
  };
  return {
    productionMinutesAgo: clamp(record.productionMinutesAgo, FINISHED_PRODUCT_TIME_DEFAULTS.productionMinutesAgo),
    rejectionMinutesAgo: clamp(record.rejectionMinutesAgo, FINISHED_PRODUCT_TIME_DEFAULTS.rejectionMinutesAgo),
    rejectionAfterProductionMinutes: clamp(record.rejectionAfterProductionMinutes, FINISHED_PRODUCT_TIME_DEFAULTS.rejectionAfterProductionMinutes),
    releaseAfterRejectionMinutes: clamp(record.releaseAfterRejectionMinutes, FINISHED_PRODUCT_TIME_DEFAULTS.releaseAfterRejectionMinutes),
  };
}

/** Свои оценки: непустые, без повторов, не длиннее списка выбора. */
export function normalizeOrganolepticOptions(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        // Старые «Доброкачественная» / «Не доброкачественная» — новыми словами.
        .map((item) => (typeof item === "string" ? modernizeGradeWording(item.replace(/\s+/g, " ").trim().slice(0, 80)) : ""))
        .filter(Boolean)
    ),
  ].slice(0, FINISHED_PRODUCT_ORGANOLEPTIC_MAX);
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
    organoleptic: modernizeGradeWording(normalizeText(overrides.organoleptic)),
    productTemp: normalizeText(overrides.productTemp),
    correctiveAction: normalizeText(overrides.correctiveAction),
    releasePermissionTime: normalizeText(overrides.releasePermissionTime),
    courierTransferTime: normalizeText(overrides.courierTransferTime),
    oxygenLevel: normalizeText(overrides.oxygenLevel),
    responsiblePerson: normalizeText(overrides.responsiblePerson),
    inspectorName: normalizeText(overrides.inspectorName),
    organolepticValue: modernizeGradeWording(normalizeText(overrides.organolepticValue)),
    organolepticResult: modernizeGradeWording(normalizeText(overrides.organolepticResult)),
    releaseAllowed: overrides.releaseAllowed === "no" ? "no" : "yes",
    portionWeight: normalizeText(overrides.portionWeight).slice(0, 20),
    note: normalizeText(overrides.note).slice(0, 500),
    ...(Array.isArray(overrides.signatures) && overrides.signatures.length > 0
      ? { signatures: normalizeRowSignatures(overrides.signatures) }
      : {}),
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
    // Новый документ — «Рекомендуемая форма» Приложения 4: только восемь
    // колонок бланка. Остальные включаются в настройках, данные не теряются.
    showProductTemp: false,
    showCorrectiveAction: false,
    showOxygenLevel: false,
    showCourierTime: false,
    showReleaseAllowed: false,
    showResponsible: false,
    showInspector: false,
    footerNote: "",
    commissionMembers: [],
    timeDefaults: { ...FINISHED_PRODUCT_TIME_DEFAULTS },
    organolepticOptions: [],
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
    commissionMembers: normalizeCommissionMembers(record.commissionMembers),
    timeDefaults: normalizeTimeDefaults(record.timeDefaults),
    organolepticOptions: normalizeOrganolepticOptions(record.organolepticOptions),
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
    // У старых документов флагов нет — колонки были видны всегда.
    showResponsible: columnFlags && "showResponsible" in columnFlags
      ? columnFlags.showResponsible === true
      : record.showResponsible !== false,
    showInspector: columnFlags && "showInspector" in columnFlags
      ? columnFlags.showInspector === true
      : record.showInspector !== false,
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
    ...(Array.isArray(record.sharedCatalog)
      ? { sharedCatalog: normalizeStringList(record.sharedCatalog) }
      : {}),
  };
}

function normalizeStringList(value: unknown[]): string[] {
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

/** «ЧЧ:ММ» из «YYYY-MM-DD ЧЧ:ММ» или «ЧЧ:ММ»; иначе пусто. */
function timeOf(value: string): string {
  const match = /(\d{1,2}:\d{2})\s*$/.exec(value.trim());
  return match ? match[1] : "";
}

/**
 * «Разрешение к реализации блюда, кулинарного изделия» как на бумажной
 * форме: «Разрешено, 11:52» / «Не разрешено».
 */
export function finishedProductReleaseText(row: Pick<FinishedProductDocumentRow, "releaseAllowed" | "releasePermissionTime">): string {
  if (row.releaseAllowed === "no") return "Не разрешено";
  const time = timeOf(row.releasePermissionTime);
  return time ? `Разрешено, ${time}` : "Разрешено";
}

/**
 * Текст ячейки колонки для карточки на телефоне и печати — одно место на
 * все представления. Свои колонки — `row.custom[key]`.
 * В колонке подписей — только настоящие подписи утверждённой комиссии:
 * раньше у неподписанной строки сюда подставлялось ФИО проверяющего, и в
 * печати выходила «подпись» того, кто не подписывал. Время подписи — время
 * бракеража строки + 1 минута (`signatureJournalTime`).
 */
export function finishedProductCellText(
  row: FinishedProductDocumentRow,
  key: string,
  options: { timeZone?: string } = {}
): string {
  switch (key) {
    case "production":
      return row.productionDateTime;
    case "rejection":
      return row.rejectionTime;
    case "name":
      return row.productName;
    case "organoleptic":
      return row.organoleptic;
    case "release":
      return finishedProductReleaseText(row);
    case "signatures": {
      const signatures = normalizeRowSignatures(row.signatures);
      return signatures.length > 0 ? formatRowSignatures(signatures, options.timeZone, row) : "";
    }
    case "portion":
      return row.portionWeight;
    case "note":
      return row.note;
    case "temp":
      return row.productTemp;
    case "corrective":
      return row.correctiveAction;
    case "oxygen":
      return row.oxygenLevel;
    case "release_allowed":
      return row.releaseAllowed === "no" ? "Нет" : "Да";
    case "courier":
      return row.courierTransferTime;
    case "responsible":
      return row.responsiblePerson;
    case "inspector":
      return row.inspectorName;
    default:
      return row.custom?.[key] ?? "";
  }
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
