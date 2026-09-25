import {
  legacyFlagsFromColumns,
  resolveColumns,
  sanitizeColumnsConfig,
  type JournalColumnsConfig,
} from "@/lib/journal-columns";
import { normalizeCustomCells } from "@/lib/finished-product-document";
import {
  normalizeRowSignatures,
  type BrakerageCommissionMember,
  type BrakerageRowSignature,
} from "@/lib/brakerage-commission";
import { getUserDisplayTitle } from "@/lib/user-roles";

export const PERISHABLE_REJECTION_TEMPLATE_CODE = "perishable_rejection";
export const PERISHABLE_REJECTION_DOCUMENT_TITLE =
  "Журнал бракеража скоропортящейся пищевой продукции";

/**
 * «ФИО, должность» для графы «Подпись ответственного лица» (электронная
 * запись того, кто принял продукцию). Строка хранится склеенной (без id
 * человека), поэтому должность берём из его карточки в момент записи — а
 * не метку из фильтра или «Управляющий» по умолчанию.
 */
export function formatPerishableResponsible(
  user: { name: string } & NonNullable<Parameters<typeof getUserDisplayTitle>[0]>
): string {
  const title = getUserDisplayTitle(user).trim();
  return title && title !== user.name ? `${user.name}, ${title}` : user.name;
}

/**
 * Результат органолептической оценки. «Доброкачественно» /
 * «Недоброкачественно» добавлены владельцем 2026-09-21 к прежним двум.
 */
export const PERISHABLE_ORGANOLEPTIC_VALUES = ["compliant", "non_compliant", "good_quality", "poor_quality"] as const;
export type PerishableOrganolepticResult = (typeof PERISHABLE_ORGANOLEPTIC_VALUES)[number];

export function normalizePerishableOrganoleptic(value: unknown): PerishableOrganolepticResult {
  return PERISHABLE_ORGANOLEPTIC_VALUES.includes(value as PerishableOrganolepticResult)
    ? (value as PerishableOrganolepticResult)
    : "compliant";
}

/** Продукция забракована: «Не соответствует» или «Недоброкачественно». */
export function isPerishableRejected(value: unknown): boolean {
  return value === "non_compliant" || value === "poor_quality";
}

export type PerishableRejectionRow = {
  id: string;
  arrivalDate: string;
  arrivalTime: string;
  productName: string;
  productionDate: string;
  manufacturer: string;
  supplier: string;
  packaging: string;
  quantity: string;
  documentNumber: string;
  organolepticResult: PerishableOrganolepticResult;
  storageCondition: "2_6" | "minus18" | "minus2_2";
  expiryDate: string;
  /**
   * Час конечного срока реализации «HH:MM». Для скоропорта срок считают
   * в часах (12/24/36/72), одной даты мало. Старые строки поля не имеют —
   * читаются как срок без часа.
   */
  expiryTime: string;
  actualSaleDate: string;
  actualSaleTime: string;
  responsiblePerson: string;
  note: string;
  /** Подписи членов комиссии — копия `SignatureEvent`, ею владеет сервер. */
  signatures?: BrakerageRowSignature[];
  /** TaskLink.rowKey of the TasksFlow task that produced this row, if
   *  any. The adapter uses it to update-in-place on re-completion. */
  /** Значения своих колонок организации, ключ — `custom:<id>`. */
  custom?: Record<string, string>;
  sourceRowKey?: string;
};

export type PerishableRejectionConfig = {
  rows: PerishableRejectionRow[];
  productLists: Array<{ id: string; name: string; items: string[] }>;
  manufacturers: string[];
  suppliers: string[];
  /**
   * Колонка «Примечание» в составе таблицы (P2 аудита — настройки состава
   * как у бракеража готовой продукции). По умолчанию включена: старые
   * документы, у которых поля в config нет, ничего не теряют.
   */
  showNote: boolean;
  /**
   * Оставлено для совместимости типов: у скоропорта сторонней комиссии нет
   * (решение владельца 2026-09-22), нормализатор всегда отдаёт [].
   */
  commissionMembers: BrakerageCommissionMember[];
  /** Набор колонок документа, см. `src/lib/journal-columns.ts`. */
  columns?: JournalColumnsConfig;
  /**
   * Реальный день закрытия журнала (YYYY-MM-DD) для бумажной шапки:
   * раньше в «Окончен» печаталась дата НАЧАЛА документа.
   */
  finishedAt?: string | null;
  /**
   * Что мастер-кабинет справочников прислал в прошлый раз
   * (`src/lib/master-directory-push.ts`): изделия, поставщики, изготовители.
   * Следующая раздача убирает только позиции мастера — свои остаются.
   */
  sharedProducts?: string[];
  sharedSuppliers?: string[];
  sharedManufacturers?: string[];
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

function padTwo(value: number) {
  return String(value).padStart(2, "0");
}

/** «HH:MM» либо пустая строка: мусор из старых строк в бланк не пускаем. */
export function normalizePerishableTime(value: unknown): string {
  const match = /^(\d{1,2}):(\d{2})$/.exec(normalizeText(value));
  if (!match) return "";
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return "";
  return `${padTwo(hours)}:${padTwo(minutes)}`;
}

/** Быстрые сроки скоропорта из СанПиН: 12/24/36/72 часа. */
export const PERISHABLE_EXPIRY_PRESET_HOURS = [12, 24, 36, 72] as const;

/**
 * Дата-время + N часов. Считаем через локальный `Date` (а не через
 * `Date.UTC` и не строками): конструктор `new Date(y, m, d, h, min)`
 * работает в часовом поясе пользователя, поэтому нет сдвига на сутки, а
 * перенос через полночь, конец месяца и 29 февраля Date делает сам.
 */
export function addHoursToLocalDateTime(
  date: string,
  time: string,
  hours: number
): { date: string; time: string } | null {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalizeText(date));
  if (!dateMatch) return null;
  const timeMatch = /^(\d{1,2}):(\d{2})$/.exec(normalizeText(time) || "00:00");
  if (!timeMatch) return null;
  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  if (hour > 23 || minute > 59) return null;
  const base = new Date(year, month - 1, day, hour, minute, 0, 0);
  // Date молча переваривает 31 февраля — сверяем, что дата существует.
  if (base.getFullYear() !== year || base.getMonth() !== month - 1 || base.getDate() !== day) {
    return null;
  }
  base.setHours(base.getHours() + hours);
  return {
    date: `${base.getFullYear()}-${padTwo(base.getMonth() + 1)}-${padTwo(base.getDate())}`,
    time: `${padTwo(base.getHours())}:${padTwo(base.getMinutes())}`,
  };
}

/**
 * Пара «дата + время» для ячейки таблицы: «дд.мм.гггг чч:мм».
 * Почему отдельно от `formatPerishableExpiry`: поступление и реализация
 * хранят время в сыром виде (без нормализации), а показать их надо
 * так же, как срок.
 */
export function formatPerishableDateTime(date: unknown, time: unknown): string {
  const raw = normalizeText(date);
  const rawTime = normalizeText(time);
  if (!raw) return rawTime;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  const shown = match ? `${match[3]}.${match[2]}.${match[1]}` : raw;
  return rawTime ? `${shown} ${rawTime}` : shown;
}

/** Срок реализации для бланка: «дд.мм.гггг чч:мм» либо просто дата. */
export function formatPerishableExpiry(row: {
  expiryDate?: string;
  expiryTime?: string;
}): string {
  const raw = normalizeText(row.expiryDate);
  if (!raw) return "";
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  const date = match ? `${match[3]}.${match[2]}.${match[1]}` : raw;
  const time = normalizePerishableTime(row.expiryTime);
  return time ? `${date} ${time}` : date;
}

export function createPerishableRejectionRow(
  overrides: Partial<PerishableRejectionRow> = {}
): PerishableRejectionRow {
  return {
    id: overrides.id || createId("perishable-row"),
    arrivalDate: normalizeText(overrides.arrivalDate),
    arrivalTime: normalizeText(overrides.arrivalTime),
    productName: normalizeText(overrides.productName),
    productionDate: normalizeText(overrides.productionDate),
    manufacturer: normalizeText(overrides.manufacturer),
    supplier: normalizeText(overrides.supplier),
    packaging: normalizeText(overrides.packaging),
    quantity: normalizeText(overrides.quantity),
    documentNumber: normalizeText(overrides.documentNumber),
    organolepticResult: normalizePerishableOrganoleptic(overrides.organolepticResult),
    storageCondition:
      overrides.storageCondition === "minus18"
        ? "minus18"
        : overrides.storageCondition === "minus2_2"
          ? "minus2_2"
          : "2_6",
    expiryDate: normalizeText(overrides.expiryDate),
    expiryTime: normalizePerishableTime(overrides.expiryTime),
    actualSaleDate: normalizeText(overrides.actualSaleDate),
    actualSaleTime: normalizeText(overrides.actualSaleTime),
    responsiblePerson: normalizeText(overrides.responsiblePerson),
    note: normalizeText(overrides.note),
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

/**
 * Пустой конфиг нового документа. Списки изделий, производителей и
 * поставщиков — справочники организации: заполняются из её продуктов и
 * поставщиков (`buildPerishableRejectionConfigFromOrgData`) или руками.
 * Раньше сюда были зашиты «Пельмени», ООО «Ромашка» и «ИП Бубнов Б.Б.», и
 * они попадали в журналы реальных организаций.
 */
export function getDefaultPerishableRejectionConfig(): PerishableRejectionConfig {
  return {
    rows: [],
    productLists: [
      { id: createId("perishable-list"), name: "Изделия", items: [] },
    ],
    manufacturers: [],
    suppliers: [],
    showNote: true,
    commissionMembers: [],
  };
}

/** Образец для демо-организации и витрины: заполненные списки. */
export function getPerishableRejectionSampleConfig(): PerishableRejectionConfig {
  return {
    rows: [],
    productLists: [
      { id: createId("perishable-list"), name: "Изделия", items: ["Пельмени"] },
    ],
    manufacturers: ['ООО "Ромашка"'],
    suppliers: ["ИП Бубнов Б.Б."],
    showNote: true,
    commissionMembers: [],
  };
}

function uniqueTexts(values: readonly unknown[] | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values ?? []) {
    const text = normalizeText(value);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }
  return out;
}

/**
 * Конфиг нового документа по справочникам организации: изделия — её
 * продукты, поставщики — из принятых партий. Производителей в справочниках
 * нет, список пуст и пополняется из формы строки.
 */
export function buildPerishableRejectionConfigFromOrgData(params: {
  products?: readonly string[];
  suppliers?: readonly string[];
}): PerishableRejectionConfig {
  const config = getDefaultPerishableRejectionConfig();
  return {
    ...config,
    productLists: [
      { ...config.productLists[0], items: uniqueTexts(params.products) },
    ],
    suppliers: uniqueTexts(params.suppliers),
  };
}

export function normalizePerishableRejectionConfig(
  value: unknown
): PerishableRejectionConfig {
  const defaults = getDefaultPerishableRejectionConfig();
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return defaults;
  }

  const record = value as Record<string, unknown>;
  const rows = Array.isArray(record.rows)
    ? record.rows
        .map((item) => {
          if (!item || typeof item !== "object" || Array.isArray(item)) return null;
          return createPerishableRejectionRow(item as Partial<PerishableRejectionRow>);
        })
        .filter((item): item is PerishableRejectionRow => item !== null)
    : [];
  const columns = sanitizeColumnsConfig(PERISHABLE_REJECTION_TEMPLATE_CODE, record.columns, record);

  return {
    rows,
    productLists: Array.isArray(record.productLists)
      ? (record.productLists as Array<Record<string, unknown>>)
          .map((list) => ({
            id:
              typeof list.id === "string" && list.id.trim() !== ""
                ? list.id
                : createId("perishable-list"),
            name:
              typeof list.name === "string" && list.name.trim() !== ""
                ? list.name
                : "Новый список",
            items: Array.isArray(list.items)
              ? (list.items as unknown[])
                  .filter((item) => typeof item === "string")
                  .map((item) => (item as string).trim())
                  .filter((item) => item.length > 0)
              : [],
          }))
          .filter((list) => list.name.length > 0)
      : defaults.productLists,
    manufacturers: Array.isArray(record.manufacturers)
      ? (record.manufacturers as unknown[])
          .filter((item) => typeof item === "string")
          .map((item) => (item as string).trim())
          .filter((item) => item.length > 0)
      : defaults.manufacturers,
    suppliers: Array.isArray(record.suppliers)
      ? (record.suppliers as unknown[])
          .filter((item) => typeof item === "string")
          .map((item) => (item as string).trim())
          .filter((item) => item.length > 0)
      : defaults.suppliers,
    // Набор колонок главнее старого флага «Примечание» — флаг из него.
    showNote: columns
      ? legacyFlagsFromColumns(PERISHABLE_REJECTION_TEMPLATE_CODE, columns).showNote !== false
      : typeof record.showNote === "boolean"
        ? record.showNote
        : defaults.showNote,
    // Скоропорт — внутренний бракераж без комиссии: ранее скопированный
    // состав игнорируем, чтобы он не требовал подписей и не мешал закрытию.
    commissionMembers: [],
    ...(columns ? { columns } : {}),
    ...(typeof record.finishedAt === "string" && record.finishedAt.trim() !== ""
      ? { finishedAt: record.finishedAt }
      : {}),
    ...(["sharedProducts", "sharedSuppliers", "sharedManufacturers"] as const).reduce<
      Partial<Pick<PerishableRejectionConfig, "sharedProducts" | "sharedSuppliers" | "sharedManufacturers">>
    >((acc, key) => {
      const list = record[key];
      if (Array.isArray(list)) {
        acc[key] = list
          .filter((item): item is string => typeof item === "string")
          .map((item) => item.trim())
          .filter((item) => item.length > 0);
      }
      return acc;
    }, {}),
  };
}

export function getPerishableRejectionDocumentTitle() {
  return PERISHABLE_REJECTION_DOCUMENT_TITLE;
}

export function getPerishableRejectionFilePrefix() {
  return "perishable-rejection-journal";
}

export function getPerishableRejectionCreatePeriodBounds(referenceDate = new Date()) {
  const year = referenceDate.getUTCFullYear();
  const month = referenceDate.getUTCMonth();
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

  return {
    dateFrom: `${year}-${String(month + 1).padStart(2, "0")}-01`,
    dateTo: `${year}-${String(month + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`,
  };
}

export const STORAGE_CONDITION_LABELS: Record<string, string> = {
  "2_6": "+2°С до +6°С",
  "minus18": "-18°С и ниже",
  "minus2_2": "-2°С до +2°С",
};

export const ORGANOLEPTIC_LABELS: Record<string, string> = {
  compliant: "Соответствует",
  non_compliant: "Не соответствует",
  good_quality: "Доброкачественно",
  poor_quality: "Недоброкачественно",
};

/**
 * Прежняя правка ячейки «Изготовитель / поставщик» на месте записывала всю
 * склейку в поле изготовителя («Ополье / ИП Смирнов» при поставщике «ИП
 * Смирнов»), и с каждым заходом хвост повторялся. У поставщика теперь своя
 * графа: хвост «␠/␠<поставщик>» в графе изготовителя не повторяем (так же
 * фасовка / количество). Данные в базе не меняются; что записано одной
 * строкой без такого хвоста, показывается в своей графе как есть.
 */
export function withoutGluedTail(value: string, tail: string): string {
  let text = normalizeText(value);
  const suffix = normalizeText(tail);
  if (!suffix) return text;
  for (let guard = 0; guard < 10 && text.endsWith(suffix); guard += 1) {
    const head = text.slice(0, text.length - suffix.length);
    if (!head.endsWith(" / ")) break;
    const rest = head.slice(0, -3).trim();
    if (!rest) break;
    text = rest;
  }
  return text;
}

/**
 * Текст графы формы — одно место для таблицы на сайте, карточки на
 * телефоне и печати (как `finishedProductCellText`). `joiner` — чем
 * соединять условия хранения и конечный срок: на экране «, », в печати —
 * перенос строки. Свои колонки организации — `row.custom[key]`.
 */
export function perishableCellText(
  row: PerishableRejectionRow,
  key: string,
  options: { joiner?: string } = {}
): string {
  switch (key) {
    case "arrival":
      return formatPerishableDateTime(row.arrivalDate, row.arrivalTime);
    case "product":
      return row.productName;
    case "packaging":
      return withoutGluedTail(row.packaging, row.quantity);
    case "productionDate":
      return formatPerishableDateTime(row.productionDate, "");
    case "manufacturer":
      return withoutGluedTail(row.manufacturer, row.supplier);
    case "supplier":
      return row.supplier;
    case "quantity":
      return row.quantity;
    case "document":
      return row.documentNumber;
    case "organoleptic":
      return ORGANOLEPTIC_LABELS[row.organolepticResult] || row.organolepticResult || "";
    case "storage":
      return [STORAGE_CONDITION_LABELS[row.storageCondition] || row.storageCondition || "", formatPerishableExpiry(row)]
        .filter(Boolean)
        .join(options.joiner ?? ", ");
    case "sale":
      return formatPerishableDateTime(row.actualSaleDate, row.actualSaleTime);
    case "responsible":
      return row.responsiblePerson;
    case "note":
      return row.note;
    default:
      return row.custom?.[key] ?? "";
  }
}

/**
 * Относительные ширины граф в печати (мм до подгонки под лист, сумма —
 * ширина листа А4 альбомом без полей, 277 мм). Подобраны так, чтобы шапка
 * шла кеглем не меньше 6 pt без разрыва слов («поступившего»,
 * «фактической», «продовольственного»), а значения 7 pt — тоже целыми
 * («Недоброкачественно», «22.09.2026», «Управляющий»); «Примечание» —
 * свободный текст, ему тоже место.
 */
const PERISHABLE_PRINT_WIDTHS: Record<string, number> = {
  arrival: 18,
  product: 21,
  packaging: 19.5,
  productionDate: 16.5,
  manufacturer: 23,
  supplier: 22,
  quantity: 20,
  document: 26.5,
  organoleptic: 30,
  storage: 20.5,
  sale: 19,
  responsible: 21.5,
  note: 19.5,
};
const PERISHABLE_PRINT_CUSTOM_WIDTH = 20;
const PERISHABLE_PRINT_CENTERED = new Set(["arrival", "packaging", "productionDate", "quantity", "sale"]);

export type PerishablePrintColumn = {
  key: string;
  head: string;
  /** Относительная ширина, мм до подгонки под лист. */
  width: number;
  halign: "left" | "center";
  custom: boolean;
};

/**
 * Графы печати — ровно как в таблице документа: видимые колонки набора в
 * его порядке (свои колонки — на своих местах), подписи — стандартные
 * формы или свои. Одна функция для PDF и проверки печати.
 */
export function perishablePrintColumns(config: unknown): PerishablePrintColumn[] {
  return resolveColumns(PERISHABLE_REJECTION_TEMPLATE_CODE, config)
    .filter((column) => !column.hidden)
    .map((column) => ({
      key: column.key,
      head: column.label,
      width: column.custom ? PERISHABLE_PRINT_CUSTOM_WIDTH : PERISHABLE_PRINT_WIDTHS[column.key] ?? PERISHABLE_PRINT_CUSTOM_WIDTH,
      halign: column.custom ? (column.custom.type === "text" ? "left" : "center") : PERISHABLE_PRINT_CENTERED.has(column.key) ? "center" : "left",
      custom: column.custom !== null,
    }));
}

/** Заголовок блока подписей прежней комиссии — под таблицей на сайте и в печати. */
export const PERISHABLE_LEGACY_SIGNATURES_TITLE =
  "Подписи бракеражной комиссии к записям (сохранены из прежней формы журнала)";

/** «21.09.2026 11:40» в поясе организации. */
function signedAtText(iso: string, timeZone = "Europe/Moscow"): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  try {
    return new Intl.DateTimeFormat("ru-RU", {
      timeZone,
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
      .format(date)
      .replace(",", "");
  } catch {
    return iso.slice(0, 16).replace("T", " ");
  }
}

/**
 * Подписи прежней бракеражной комиссии под строками (у скоропорта комиссии
 * больше нет, графы для них в форме приложения № 5 нет). Не теряем: одна
 * строка на запись — «Салат листовой, поступление 21.09.2026 11:05 —
 * Мария Смирнова (Председатель комиссии), 21.09.2026 11:40». Пустой
 * список — блока нет.
 */
export function perishableLegacySignatureLines(
  rows: readonly PerishableRejectionRow[],
  timeZone?: string
): string[] {
  return rows.flatMap((row) => {
    const signatures = normalizeRowSignatures(row.signatures);
    if (signatures.length === 0) return [];
    const arrival = formatPerishableDateTime(row.arrivalDate, row.arrivalTime);
    const what = [row.productName.trim() || "Без наименования", arrival ? `поступление ${arrival}` : ""]
      .filter(Boolean)
      .join(", ");
    const who = signatures
      .map((signature) =>
        [
          `${signature.name || "Без имени"}${signature.role ? ` (${signature.role})` : ""}`,
          signedAtText(signature.signedAt, timeZone),
        ]
          .filter(Boolean)
          .join(", ")
      )
      .join("; ");
    return [`${what} — ${who}`];
  });
}
