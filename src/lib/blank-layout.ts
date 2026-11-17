/**
 * Конструктор бланка на странице журнала (спека
 * journal-page-engagement-2026-11): человек сам выбирает название, колонки
 * и число строк, скачивает PDF через обычное окно с почтой. Макет едет в
 * «Дополнительно» (`BlankExtras.layout`) и печатается генератором бумажных
 * бланков. Чистый модуль — его берут и окно, и сервер.
 */

export type BlankLayout = { title: string; columns: string[]; rows: number };

export const BLANK_LAYOUT_LIMITS = {
  columnsMin: 2,
  columnsMax: 12,
  rowsMin: 5,
  rowsMax: 60,
  titleMax: 120,
  columnMax: 40,
} as const;

/** Колонки по умолчанию — как в журнале на сайте; иначе — общий набор. */
const DEFAULT_COLUMNS: Record<string, string[]> = {
  cleaning: ["Дата", "Помещение / зона", "Вид уборки", "Время", "Средство, концентрация", "Исполнитель", "Контроль", "Подпись"],
  general_cleaning: ["Дата по графику", "Дата фактически", "Помещение", "Средство, концентрация", "Исполнитель", "Принял", "Подпись"],
  hygiene: ["Дата", "ФИО сотрудника", "Должность", "Осмотр (здоров / отстранён)", "Температура выше 37 °C", "Подпись сотрудника", "Подпись ответственного"],
  health_check: ["Дата", "ФИО сотрудника", "Должность", "Жалобы", "Допущен / отстранён", "Подпись"],
  cold_equipment_control: ["Дата", "Время", "Оборудование", "Норма, °C", "Факт, °C", "Принятые меры", "Подпись"],
  climate_control: ["Дата", "Время", "Помещение", "Температура, °C", "Влажность, %", "Подпись"],
  finished_product: ["Дата и время", "Блюдо", "Оценка (вкус, запах, вид)", "Разрешение к реализации", "Подписи комиссии"],
  incoming_control: ["Дата", "Продукт", "Поставщик", "Количество", "Документы", "Срок годности", "Результат", "Подпись"],
  fryer_oil: ["Дата", "Вид жира", "Оценка", "Тип фритюрницы", "Продолжение / замена", "Подпись"],
  disinfectant_usage: ["Дата", "Средство", "Концентрация", "Объём раствора", "Где применено", "Подпись"],
  uv_lamp_runtime: ["Дата", "Помещение", "Включено", "Выключено", "Наработка, ч", "Подпись"],
};

const GENERIC_COLUMNS = ["Дата", "Содержание записи", "Ответственный", "Подпись"];

export function defaultBlankLayout(code: string | null | undefined, title: string): BlankLayout {
  return { title: title.slice(0, BLANK_LAYOUT_LIMITS.titleMax), columns: [...(DEFAULT_COLUMNS[code ?? ""] ?? GENERIC_COLUMNS)], rows: 20 };
}

function cleanText(raw: unknown, max: number): string {
  if (typeof raw !== "string") return "";
  return raw.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

/** Макет из окна → чистый; негодный — `null` (тогда печатается обычный бланк). */
export function normalizeBlankLayout(raw: unknown): BlankLayout | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  const title = cleanText(value.title, BLANK_LAYOUT_LIMITS.titleMax);
  const columns = Array.isArray(value.columns)
    ? value.columns
        .slice(0, BLANK_LAYOUT_LIMITS.columnsMax * 2)
        .map((column) => cleanText(column, BLANK_LAYOUT_LIMITS.columnMax))
        .filter(Boolean)
        .slice(0, BLANK_LAYOUT_LIMITS.columnsMax)
    : [];
  const rows = typeof value.rows === "number" && Number.isFinite(value.rows) ? Math.round(value.rows) : NaN;
  if (!title || columns.length < BLANK_LAYOUT_LIMITS.columnsMin || !Number.isFinite(rows)) return null;
  return {
    title,
    columns,
    rows: Math.min(BLANK_LAYOUT_LIMITS.rowsMax, Math.max(BLANK_LAYOUT_LIMITS.rowsMin, rows)),
  };
}

/** Строка для продаж: «🧩 Свой бланк: «…», 6 колонок, 20 строк». */
export function blankLayoutAdminLine(layout: BlankLayout | null | undefined): string | null {
  if (!layout) return null;
  return `🧩 Свой бланк: «${layout.title}», колонок — ${layout.columns.length}, строк — ${layout.rows}`;
}
