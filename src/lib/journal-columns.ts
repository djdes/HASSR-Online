/**
 * Колонки таблиц журналов: какие показывать и как подписывать.
 *
 * Хранение — `JournalDocument.config.columns`:
 *
 *   { hidden: ["temp", "courier"], labels: { name: "Блюдо" } }
 *
 * Правила:
 *   • любую колонку можно скрыть и переименовать (владелец, 2026-09-21:
 *     «обязательных колонок бланка» больше нет), свою — удалить;
 *   • порядок — `order` (ключи в порядке показа), иначе порядок реестра;
 *   • неизвестные ключи отбрасываются, подпись — не длиннее 60 символов;
 *   • пустая подпись или совпадающая со стандартной не хранится;
 *   • скрытая колонка данных не теряет: значения строк остаются в конфиге.
 *
 * Порядок источников (`resolveColumns`): `config.columns` документа →
 * общий вариант организации (`Organization.journalColumnsJson[code]`) →
 * старые флаги `showX` → реестр. Общий вариант организации записывается
 * в документы при создании и по «Применить ко всем документам», поэтому
 * у открытого документа он уже лежит в `config.columns`.
 *
 * Старые флаги (`showProductTemp`, `showNote`…) продолжают жить в
 * конфиге: нормализаторы синхронизируют их из `columns`
 * (`legacyFlagsFromColumns`), и печать/адаптеры TasksFlow работают без
 * правок.
 */

export const JOURNAL_COLUMN_LABEL_MAX = 60;

/**
 * Типы своих колонок. Набор закрытый: каждый тип умеет и таблица, и
 * карточка на телефоне, и печать. «Оценка» — это выбор балла 1…max,
 * «список» — редактируемый выпадающий список значений организации.
 */
export const JOURNAL_FIELD_TYPES = [
  "text",
  "number",
  "date",
  "time",
  "boolean",
  "select",
  "rating",
  "employee",
] as const;
export type JournalFieldType = (typeof JOURNAL_FIELD_TYPES)[number];

export const JOURNAL_FIELD_TYPE_LABEL: Record<JournalFieldType, string> = {
  text: "Текст",
  number: "Число",
  date: "Дата",
  time: "Время",
  boolean: "Да / Нет",
  select: "Список (свои значения)",
  rating: "Оценка (баллы)",
  employee: "Сотрудник",
};

export const JOURNAL_CUSTOM_COLUMNS_MAX = 12;
export const JOURNAL_SELECT_OPTIONS_MAX = 40;
export const JOURNAL_RATING_MAX_MIN = 2;
export const JOURNAL_RATING_MAX_MAX = 10;
export const JOURNAL_RATING_MAX_DEFAULT = 5;
const CUSTOM_KEY_PREFIX = "custom:";

/** Своя колонка организации: подпись, тип и настройки типа. */
export type JournalCustomColumn = {
  /** `custom:<id>` — отличает от колонок бланка и не сталкивается с ними. */
  key: string;
  label: string;
  type: JournalFieldType;
  /** Значения выпадающего списка (type = "select"). */
  options?: string[];
  /** Верхний балл (type = "rating"), 2…10. */
  ratingMax?: number;
  /** Подпись единицы измерения (type = "number"): «°C», «кг». */
  unit?: string;
};

export type JournalColumnsConfig = {
  hidden: string[];
  labels: Record<string, string>;
  /** Свои колонки — дописываются в конец таблицы в этом порядке. */
  custom?: JournalCustomColumn[];
  /** Колонки, которые организация считает обязательными к ЗАПОЛНЕНИЮ. */
  mustFill?: string[];
  /** Порядок показа: ключи колонок. Нет — порядок реестра, свои в конце. */
  order?: string[];
};

export function isCustomColumnKey(key: string): boolean {
  return key.startsWith(CUSTOM_KEY_PREFIX);
}

/** Новый ключ своей колонки. Случайный — чтобы не совпал при слиянии. */
export function newCustomColumnKey(): string {
  return `${CUSTOM_KEY_PREFIX}${Math.random().toString(36).slice(2, 10)}`;
}

type ConfigRecord = Record<string, unknown>;

export type JournalColumnDef = {
  key: string;
  /** Стандартная подпись; может зависеть от режима документа. */
  label: string | ((config: ConfigRecord) => string);
  /** Относительная ширина в таблице. */
  weight: number;
  /**
   * Колонка имеет смысл только при условии (подписи — когда у документа есть
   * комиссия). Условие ложно — колонка скрыта и в настройках неактивна.
   */
  visibleIf?: (config: ConfigRecord) => boolean;
  /** Подсказка, почему колонка сейчас недоступна. */
  unavailableHint?: string;
  /**
   * Старый булев флаг конфига, которым колонка включалась раньше.
   * `defaultVisible` — как вёл себя документ без флага.
   */
  legacyFlag?: { key: string; defaultVisible: boolean };
  /**
   * Колонка заведена позже остальных. У документа, созданного до неё, ни
   * флага в конфиге, ни ключа в сохранённом наборе колонок нет — и она не
   * должна появиться сама собой: без явного булева флага считаем её
   * скрытой, даже когда у документа есть свой набор колонок. Новый
   * документ получает флаг из дефолтного конфига и видит колонку.
   */
  introducedWithFlag?: boolean;
  align?: "center";
};

export type ResolvedJournalColumn = {
  key: string;
  label: string;
  defaultLabel: string;
  weight: number;
  hidden: boolean;
  /** Скрыта человеком (в наборе); `hidden` ещё учитывает `unavailable`. */
  hiddenByChoice: boolean;
  /** `visibleIf` ложно: колонку сейчас не показать (текст — почему). */
  unavailable?: string;
  align?: "center";
  /** Обязательна к заполнению — пустая ячейка подсвечивается. */
  mustFill: boolean;
  /** Своя колонка организации (null у колонок бланка). */
  custom: JournalCustomColumn | null;
};

/**
 * Реестр бракеража готовой продукции. Первые восемь колонок — бумажная форма
 * Приложения 4 (фото владельца, 2026-09-21) в её порядке и с её подписями;
 * дальше — колонки расширенной формы, у новых документов скрытые.
 */
const FINISHED_PRODUCT_COLUMNS: JournalColumnDef[] = [
  { key: "production", label: "Дата и час изготовления блюда", weight: 9, align: "center" },
  { key: "rejection", label: "Время снятия бракеража", weight: 7, align: "center" },
  {
    key: "name",
    label: (config) =>
      config.fieldNameMode === "semi" ? "Наименование полуфабриката" : "Наименование готового блюда",
    weight: 13,
  },
  {
    key: "organoleptic",
    label: "Результаты органолептической оценки качества готовых блюд",
    weight: 20,
  },
  { key: "release", label: "Разрешение к реализации блюда, кулинарного изделия", weight: 11, align: "center" },
  { key: "signatures", label: "Подпись бракеражной комиссии", weight: 13 },
  { key: "portion", label: "Результат взвешивания порционных блюд", weight: 8, align: "center" },
  { key: "note", label: "Примечание", weight: 10 },
  {
    key: "temp",
    label: "T°C внутри продукта",
    weight: 8,
    legacyFlag: { key: "showProductTemp", defaultVisible: false },
    align: "center",
  },
  {
    key: "corrective",
    label: "Корректирующие действия",
    weight: 12,
    legacyFlag: { key: "showCorrectiveAction", defaultVisible: false },
  },
  {
    key: "oxygen",
    label: "Остаточный уровень кислорода, % об.",
    weight: 9,
    legacyFlag: { key: "showOxygenLevel", defaultVisible: false },
    align: "center",
  },
  {
    key: "release_allowed",
    label: "Разрешение к реализации: Да/Нет",
    weight: 8,
    legacyFlag: { key: "showReleaseAllowed", defaultVisible: false },
    introducedWithFlag: true,
    align: "center",
  },
  {
    key: "courier",
    label: "Время передачи блюд курьеру",
    weight: 9,
    legacyFlag: { key: "showCourierTime", defaultVisible: false },
    align: "center",
  },
  {
    key: "responsible",
    label: "Ответственный исполнитель (ФИО, должность)",
    weight: 14,
    legacyFlag: { key: "showResponsible", defaultVisible: true },
  },
  {
    key: "inspector",
    label: (config) =>
      config.inspectorMode === "commission_signatures"
        ? "Подписи членов комиссии"
        : "ФИО лица, проводившего бракераж",
    weight: 13,
    legacyFlag: { key: "showInspector", defaultVisible: true },
  },
];

/**
 * Реестр бракеража скоропортящейся продукции — графы рекомендуемого образца
 * «Журнал бракеража скоропортящейся пищевой продукции» (приложение № 5 к
 * СанПиН 2.3/2.4.3590-20; та же форма — приложение № 5 к СанПиН
 * 2.3/2.4.4282-26, действует с 01.09.2026). 13 граф, порядок и подписи —
 * дословно, включая запятые образца («Дата и час, поступления…»,
 * «…оценки, поступившего…»); первая буква подписи — заглавная. Сверка с
 * текстом правил: `.agent/tasks/perishable-official-form-2026-09/evidence.md`.
 *
 * До 2026-09-26 изготовитель с поставщиком и фасовка с количеством были
 * склеены в одну графу; «Поставщик» и «Количество…» выделены из них, старые
 * сохранённые наборы колонок читаются через `REGISTRY_REVISIONS`.
 * Колонки подписей комиссии нет: сторонняя комиссия — только у бракеража
 * готовой продукции (решение владельца 2026-09-22); подписи из прежних
 * записей печатаются отдельным блоком под таблицей.
 */
const PERISHABLE_REJECTION_COLUMNS: JournalColumnDef[] = [
  { key: "arrival", label: "Дата и час, поступления пищевой продукции", weight: 84 },
  { key: "product", label: "Наименование", weight: 95 },
  { key: "packaging", label: "Фасовка", weight: 68 },
  { key: "productionDate", label: "Дата выработки", weight: 84 },
  { key: "manufacturer", label: "Изготовитель", weight: 94 },
  { key: "supplier", label: "Поставщик", weight: 92 },
  { key: "quantity", label: "Количество поступившего продукта (в кг, литрах, шт)", weight: 90 },
  {
    key: "document",
    label:
      "Номер документа, подтверждающего безопасность принятого пищевого продукта (декларация о соответствии, свидетельство о государственной регистрации, документы по результатам ветеринарно-санитарной экспертизы)",
    weight: 120,
  },
  {
    key: "organoleptic",
    label: "Результаты органолептической оценки, поступившего продовольственного сырья и пищевых продуктов",
    weight: 122,
  },
  { key: "storage", label: "Условия хранения, конечный срок реализации", weight: 96 },
  { key: "sale", label: "Дата и час фактической реализации", weight: 86 },
  { key: "responsible", label: "Подпись ответственного лица", weight: 99 },
  {
    key: "note",
    label: "Примечание",
    weight: 90,
    legacyFlag: { key: "showNote", defaultVisible: true },
  },
];

const REGISTRY: Record<string, JournalColumnDef[]> = {
  finished_product: FINISHED_PRODUCT_COLUMNS,
  perishable_rejection: PERISHABLE_REJECTION_COLUMNS,
};

/**
 * Смена состава реестра без миграции данных. Колонка из `splitFrom`
 * выделена из прежней склеенной колонки-«родителя» (её данные раньше
 * выводились в нём). `previousOrder` — порядок реестра до смены.
 */
type RegistryRevision = {
  splitFrom: Readonly<Record<string, string>>;
  previousOrder: readonly string[];
};

const REGISTRY_REVISIONS: Record<string, RegistryRevision> = {
  // 2026-09-26: скоропорт по форме приложения № 5 СанПиН.
  perishable_rejection: {
    splitFrom: { supplier: "manufacturer", quantity: "packaging" },
    previousOrder: [
      "arrival",
      "product",
      "productionDate",
      "manufacturer",
      "packaging",
      "document",
      "organoleptic",
      "storage",
      "sale",
      "responsible",
      "note",
    ],
  },
};

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function sameKeys(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((key, index) => key === b[index]);
}

/**
 * Сохранённый набор колонок (документа, общий организации, свой шаблон),
 * сделанный до смены реестра, — к новому реестру. Набор «не знает» новую
 * колонку, если её ключа нет ни в скрытых, ни в порядке, ни в подписях, ни
 * в обязательных. Тогда:
 *   • скрыт или обязателен «родитель» — новая колонка тоже (раньше её
 *     данные были в нём);
 *   • порядок не переставляли (колонки бланка стоят прежним стандартом) —
 *     новый стандартный порядок, свои колонки остаются за той колонкой
 *     бланка, за которой стояли;
 *   • порядок переставлен человеком — новая колонка сразу за «родителем».
 * Набор, уже знающий новые ключи, не трогаем; повторный вызов ничего не
 * меняет. Данные строк не меняются никогда.
 */
export function upgradeSavedColumns(code: string, record: ConfigRecord): ConfigRecord {
  const revision = REGISTRY_REVISIONS[code];
  if (!revision) return record;
  const hidden = stringList(record.hidden);
  const order = stringList(record.order);
  const mustFill = stringList(record.mustFill);
  const labels = asRecord(record.labels);
  const known = (key: string) =>
    hidden.includes(key) ||
    order.includes(key) ||
    mustFill.includes(key) ||
    Object.prototype.hasOwnProperty.call(labels, key);
  const added = Object.keys(revision.splitFrom).filter((key) => !known(key));
  if (added.length === 0) return record;

  const next: ConfigRecord = { ...record };
  let changed = false;
  const inherit = (field: "hidden" | "mustFill", list: string[]) => {
    const extra = added.filter((key) => list.includes(revision.splitFrom[key]));
    if (extra.length === 0) return;
    next[field] = [...list, ...extra];
    changed = true;
  };
  inherit("hidden", hidden);
  inherit("mustFill", mustFill);
  if (order.length === 0) return changed ? next : record;

  const registryKeys = getColumnRegistry(code).map((column) => column.key);
  const registrySet = new Set(registryKeys);
  if (sameKeys(order.filter((key) => registrySet.has(key)), revision.previousOrder)) {
    const after = new Map<string | null, string[]>();
    let anchor: string | null = null;
    for (const key of order) {
      if (registrySet.has(key)) anchor = key;
      else after.set(anchor, [...(after.get(anchor) ?? []), key]);
    }
    next.order = [...(after.get(null) ?? []), ...registryKeys.flatMap((key) => [key, ...(after.get(key) ?? [])])];
    return next;
  }
  const nextOrder = [...order];
  for (const key of added) {
    const at = nextOrder.indexOf(revision.splitFrom[key]);
    if (at < 0) nextOrder.push(key);
    else nextOrder.splice(at + 1, 0, key);
  }
  next.order = nextOrder;
  return next;
}

export const JOURNAL_COLUMN_CODES = Object.keys(REGISTRY);

export function hasColumnRegistry(code: string): boolean {
  return code in REGISTRY;
}

export function getColumnRegistry(code: string): readonly JournalColumnDef[] {
  return REGISTRY[code] ?? [];
}

function asRecord(value: unknown): ConfigRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as ConfigRecord) : {};
}

function defaultLabelOf(column: JournalColumnDef, config: ConfigRecord): string {
  return typeof column.label === "function" ? column.label(config) : column.label;
}

function cleanLabel(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, JOURNAL_COLUMN_LABEL_MAX) : "";
}

/**
 * Приводит свои колонки к допустимому виду: известный тип, непустая
 * подпись, уникальный ключ, разумные пределы у списка и оценки. Лишнее
 * молча отбрасываем — конфиг приходит из браузера.
 */
function sanitizeCustomColumns(raw: unknown): JournalCustomColumn[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const result: JournalCustomColumn[] = [];
  for (const item of raw) {
    if (result.length >= JOURNAL_CUSTOM_COLUMNS_MAX) break;
    if (!item || typeof item !== "object") continue;
    const record = item as ConfigRecord;
    const key = typeof record.key === "string" ? record.key : "";
    if (!isCustomColumnKey(key) || key.length > 64 || seen.has(key)) continue;
    const label = cleanLabel(record.label);
    if (!label) continue;
    const type = JOURNAL_FIELD_TYPES.includes(record.type as JournalFieldType)
      ? (record.type as JournalFieldType)
      : "text";
    const column: JournalCustomColumn = { key, label, type };
    if (type === "select") {
      const options = Array.isArray(record.options) ? record.options : [];
      const cleaned = [
        ...new Set(options.map((option) => cleanLabel(option)).filter(Boolean)),
      ].slice(0, JOURNAL_SELECT_OPTIONS_MAX);
      column.options = cleaned;
    }
    if (type === "rating") {
      const max = typeof record.ratingMax === "number" ? Math.round(record.ratingMax) : JOURNAL_RATING_MAX_DEFAULT;
      column.ratingMax = Math.min(JOURNAL_RATING_MAX_MAX, Math.max(JOURNAL_RATING_MAX_MIN, max));
    }
    if (type === "number") {
      const unit = cleanLabel(record.unit).slice(0, 12);
      if (unit) column.unit = unit;
    }
    seen.add(key);
    result.push(column);
  }
  return result;
}

/**
 * Приводит сырое значение `columns` к допустимому виду для журнала. `null`
 * — значения нет (или это не объект): документ пользуется стандартом.
 */
export function sanitizeColumnsConfig(
  code: string,
  raw: unknown,
  config: unknown = {}
): JournalColumnsConfig | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const registry = getColumnRegistry(code);
  if (registry.length === 0) return null;
  // Набор, сохранённый до смены реестра, — к текущему составу колонок.
  const record = upgradeSavedColumns(code, raw as ConfigRecord);
  const configRecord = asRecord(config);
  const byKey = new Map(registry.map((column) => [column.key, column]));

  const customColumns = sanitizeCustomColumns(record.custom);
  const customKeys = new Set(customColumns.map((column) => column.key));
  const hiddenRaw = Array.isArray(record.hidden) ? record.hidden : [];
  const hidden = [
    ...new Set(
      hiddenRaw.filter(
        (key): key is string =>
          typeof key === "string" && (customKeys.has(key) || byKey.has(key))
      )
    ),
  ];

  const labels: Record<string, string> = {};
  const labelsRaw = asRecord(record.labels);
  for (const [key, value] of Object.entries(labelsRaw)) {
    const column = byKey.get(key);
    if (!column || typeof value !== "string") continue;
    const label = value.replace(/\s+/g, " ").trim().slice(0, JOURNAL_COLUMN_LABEL_MAX);
    if (!label || label === defaultLabelOf(column, configRecord)) continue;
    labels[key] = label;
  }

  const custom = customColumns;
  const knownKeys = new Set([...byKey.keys(), ...customKeys]);
  const mustFillRaw = Array.isArray(record.mustFill) ? record.mustFill : [];
  const mustFill = [
    ...new Set(mustFillRaw.filter((key): key is string => typeof key === "string" && knownKeys.has(key))),
  ];

  const orderRaw = Array.isArray(record.order) ? record.order : [];
  const order = [
    ...new Set(orderRaw.filter((key): key is string => typeof key === "string" && knownKeys.has(key))),
  ];

  return {
    hidden,
    labels,
    ...(custom.length > 0 ? { custom } : {}),
    ...(mustFill.length > 0 ? { mustFill } : {}),
    ...(order.length > 0 ? { order } : {}),
  };
}

/** Колонки журнала с итоговой видимостью и подписью. */
export function resolveColumns(
  code: string,
  config: unknown,
  orgDefaults?: unknown
): ResolvedJournalColumn[] {
  const registry = getColumnRegistry(code);
  const configRecord = asRecord(config);
  const own = sanitizeColumnsConfig(code, configRecord.columns, configRecord);
  const fromOrg = own ? null : sanitizeColumnsConfig(code, orgDefaults, configRecord);
  const source = own ?? fromOrg;

  const mustFillSet = new Set(source?.mustFill ?? []);
  const base = registry.map((column) => {
    const defaultLabel = defaultLabelOf(column, configRecord);
    let hidden: boolean;
    if (column.introducedWithFlag && column.legacyFlag) {
      // Флаг здесь главнее сохранённого набора колонок: у старого
      // документа в наборе ключа нет, и «нет в hidden» там значит «не
      // знали о колонке», а не «показывать».
      const flag = configRecord[column.legacyFlag.key];
      hidden = typeof flag === "boolean" ? !flag : !column.legacyFlag.defaultVisible;
    } else if (source) {
      hidden = source.hidden.includes(column.key);
    } else if (column.legacyFlag) {
      const flag = configRecord[column.legacyFlag.key];
      hidden = typeof flag === "boolean" ? !flag : !column.legacyFlag.defaultVisible;
    } else {
      hidden = false;
    }
    const available = column.visibleIf ? column.visibleIf(configRecord) : true;
    return {
      key: column.key,
      label: source?.labels[column.key] ?? defaultLabel,
      defaultLabel,
      weight: column.weight,
      hidden: hidden || !available,
      hiddenByChoice: hidden,
      ...(available ? {} : { unavailable: column.unavailableHint ?? "Колонка сейчас недоступна" }),
      align: column.align,
      mustFill: mustFillSet.has(column.key),
      custom: null,
    } satisfies ResolvedJournalColumn;
  });

  // Свои колонки идут после колонок бланка, в порядке добавления.
  const custom = (source?.custom ?? []).map(
    (column): ResolvedJournalColumn => ({
      key: column.key,
      label: column.label,
      defaultLabel: column.label,
      weight: column.type === "text" ? 10 : 7,
      hidden: source?.hidden.includes(column.key) === true,
      hiddenByChoice: source?.hidden.includes(column.key) === true,
      align: column.type === "text" ? undefined : "center",
      mustFill: mustFillSet.has(column.key),
      custom: column,
    })
  );

  return orderColumns([...base, ...custom], source?.order);
}

/** Порядок колонок: сначала по `order`, остальные — в исходном порядке. */
function orderColumns<T extends { key: string }>(columns: T[], order: readonly string[] | undefined): T[] {
  if (!order || order.length === 0) return columns;
  const rank = new Map(order.map((key, index) => [key, index]));
  return columns
    .map((column, index) => ({ column, index }))
    .sort((a, b) => {
      const ra = rank.get(a.column.key);
      const rb = rank.get(b.column.key);
      if (ra !== undefined && rb !== undefined) return ra - rb;
      if (ra !== undefined) return -1;
      if (rb !== undefined) return 1;
      return a.index - b.index;
    })
    .map((item) => item.column);
}

/** Сдвинуть колонку на шаг влево (-1) или вправо (+1) в порядке показа. */
export function moveColumn(
  columns: JournalColumnsConfig,
  resolved: readonly ResolvedJournalColumn[],
  key: string,
  direction: -1 | 1
): JournalColumnsConfig {
  const keys = resolved.map((column) => column.key);
  const index = keys.indexOf(key);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= keys.length) return columns;
  [keys[index], keys[target]] = [keys[target], keys[index]];
  return { ...columns, order: keys };
}

/** Только видимые колонки — для таблицы, карточек и печати. */
export function visibleColumns(
  code: string,
  config: unknown,
  orgDefaults?: unknown
): ResolvedJournalColumn[] {
  return resolveColumns(code, config, orgDefaults).filter((column) => !column.hidden);
}

/** Старые флаги `showX` по набору колонок — чтобы печать и адаптеры не отставали. */
export function legacyFlagsFromColumns(
  code: string,
  columns: JournalColumnsConfig
): Record<string, boolean> {
  const flags: Record<string, boolean> = {};
  for (const column of getColumnRegistry(code)) {
    if (!column.legacyFlag) continue;
    flags[column.legacyFlag.key] = !columns.hidden.includes(column.key);
  }
  return flags;
}

/** Набор колонок из текущего вида документа — для «сохранить как общий». */
export function columnsConfigFromResolved(columns: ResolvedJournalColumn[]): JournalColumnsConfig {
  const custom = columns
    .map((column) => column.custom)
    .filter((column): column is JournalCustomColumn => column !== null);
  const mustFill = columns.filter((column) => column.mustFill).map((column) => column.key);
  return {
    // Недоступная колонка (подписи без комиссии) скрыта условием, а не
    // человеком: в набор её не пишем, иначе она не появилась бы с комиссией.
    hidden: columns.filter((column) => column.hiddenByChoice).map((column) => column.key),
    labels: Object.fromEntries(
      columns
        .filter((column) => column.custom === null && column.label !== column.defaultLabel)
        .map((column) => [column.key, column.label])
    ),
    ...(custom.length > 0 ? { custom } : {}),
    ...(mustFill.length > 0 ? { mustFill } : {}),
    order: columns.map((column) => column.key),
  };
}

/** Добавить свою колонку. */
export function addCustomColumn(columns: JournalColumnsConfig, column: JournalCustomColumn): JournalColumnsConfig {
  const custom = [...(columns.custom ?? [])];
  if (custom.length >= JOURNAL_CUSTOM_COLUMNS_MAX) return columns;
  return { ...columns, custom: [...custom, column] };
}

/** Изменить свою колонку (подпись, тип, настройки типа). */
export function updateCustomColumn(
  columns: JournalColumnsConfig,
  key: string,
  patch: Partial<Omit<JournalCustomColumn, "key">>
): JournalColumnsConfig {
  const custom = (columns.custom ?? []).map((column) =>
    column.key === key ? { ...column, ...patch } : column
  );
  return { ...columns, custom };
}

/** Удалить свою колонку вместе с её отметками. */
export function removeCustomColumn(columns: JournalColumnsConfig, key: string): JournalColumnsConfig {
  return {
    ...columns,
    custom: (columns.custom ?? []).filter((column) => column.key !== key),
    hidden: columns.hidden.filter((item) => item !== key),
    mustFill: (columns.mustFill ?? []).filter((item) => item !== key),
  };
}

/** Отметить колонку обязательной к заполнению (или снять отметку). */
export function setColumnMustFill(
  columns: JournalColumnsConfig,
  key: string,
  mustFill: boolean
): JournalColumnsConfig {
  const set = new Set(columns.mustFill ?? []);
  if (mustFill) set.add(key);
  else set.delete(key);
  return { ...columns, mustFill: [...set] };
}

/** Пустая ли ячейка своей колонки — для подсветки обязательных. */
export function isCellEmpty(value: unknown): boolean {
  return value === null || value === undefined || String(value).trim() === "";
}

/** Конфиг документа с набором колонок и синхронными старыми флагами (`showX`). */
export function applyColumnsToConfig(
  code: string,
  config: unknown,
  columns: JournalColumnsConfig
): Record<string, unknown> {
  const base = asRecord(config);
  const sanitized = sanitizeColumnsConfig(code, columns, base) ?? { hidden: [], labels: {} };
  return { ...base, columns: sanitized, ...legacyFlagsFromColumns(code, sanitized) };
}

/**
 * Старые переключатели (`showX`) поверх набора колонок — для форм, которые
 * до сих пор правят флаги (диалог создания, настройки из списка документов):
 * без этого флаг, изменённый в форме, проигрывал бы набору колонок.
 */
export function syncColumnsWithLegacyFlags(
  code: string,
  config: Record<string, unknown>
): Record<string, unknown> {
  const columns = sanitizeColumnsConfig(code, config.columns, config);
  if (!columns) return config;
  const hidden = new Set(columns.hidden);
  for (const column of getColumnRegistry(code)) {
    if (!column.legacyFlag) continue;
    const flag = config[column.legacyFlag.key];
    if (typeof flag !== "boolean") continue;
    if (flag) hidden.delete(column.key);
    else hidden.add(column.key);
  }
  return { ...config, columns: { ...columns, hidden: [...hidden] } };
}

/**
 * Общие наборы организации (`Organization.journalColumnsJson`): журналы без
 * реестра колонок и испорченные значения отбрасываются.
 */
export function parseOrgColumnDefaults(raw: unknown): Record<string, JournalColumnsConfig> {
  const out: Record<string, JournalColumnsConfig> = {};
  for (const [code, value] of Object.entries(asRecord(raw))) {
    if (!hasColumnRegistry(code)) continue;
    const sanitized = sanitizeColumnsConfig(code, value);
    if (sanitized) out[code] = sanitized;
  }
  return out;
}

/**
 * Новый документ получает общий набор организации, если своего набора у
 * конфига нет. `respectFlags` — флаги в конфиге выбраны человеком (диалог
 * создания показывает их по общему набору) и важнее набора для своих колонок.
 */
export function withOrgColumnDefault(
  code: string,
  config: Record<string, unknown> | undefined,
  defaults: Record<string, JournalColumnsConfig>,
  options: { respectFlags?: boolean } = {}
): Record<string, unknown> | undefined {
  const columns = defaults[code];
  if (!columns) return config;
  const base = config ?? {};
  if (base.columns && typeof base.columns === "object") return config;
  if (!options.respectFlags) return applyColumnsToConfig(code, base, columns);
  const seeded = syncColumnsWithLegacyFlags(code, { ...base, columns });
  return applyColumnsToConfig(code, base, (seeded.columns as JournalColumnsConfig) ?? columns);
}
