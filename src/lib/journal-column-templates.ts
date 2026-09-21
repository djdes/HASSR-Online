/**
 * Шаблоны колонок бракеражных журналов: встроенные (в коде) и разбор
 * «типовой формы» из Excel. Чистый модуль — без БД и без exceljs: книгу
 * читает API-маршрут и отдаёт сюда сетку строк `string[][]`.
 *
 * Шаблон — это `JournalColumnsConfig` (скрытые, подписи, свои колонки,
 * порядок). Применяется к документу так же, как ручная правка колонок, —
 * через `applyColumnsToConfig`, чтобы старые флаги `showX` не разошлись.
 */
import {
  JOURNAL_CUSTOM_COLUMNS_MAX,
  getColumnRegistry,
  newCustomColumnKey,
  resolveColumns,
  sanitizeColumnsConfig,
  type JournalColumnsConfig,
  type JournalCustomColumn,
} from "@/lib/journal-columns";

export const JOURNAL_TEMPLATE_NAME_MAX = 120;

export type JournalColumnTemplate = {
  /** `builtin:<id>` у встроенных, cuid у своих. */
  id: string;
  name: string;
  journalCode: string;
  builtIn: boolean;
  columns: JournalColumnsConfig;
};

/** Рекомендуемая форма Приложения 4 — восемь колонок бланка с фото владельца. */
export const APPENDIX4_TEMPLATE_ID = "builtin:appendix4";
export const APPENDIX4_TEMPLATE_NAME =
  "Рекомендуемая форма в соответствии с Приложением №4 СанПиН 2.3/2.4.4282-26";

const APPENDIX4_ORDER = ["production", "rejection", "name", "organoleptic", "release", "signatures", "portion", "note"];

function registryKeys(code: string): string[] {
  return getColumnRegistry(code).map((column) => column.key);
}

const BUILT_IN: Record<string, JournalColumnTemplate[]> = {
  finished_product: [
    {
      id: APPENDIX4_TEMPLATE_ID,
      name: APPENDIX4_TEMPLATE_NAME,
      journalCode: "finished_product",
      builtIn: true,
      columns: {
        hidden: registryKeys("finished_product").filter((key) => !APPENDIX4_ORDER.includes(key)),
        labels: {},
        order: [...APPENDIX4_ORDER, ...registryKeys("finished_product").filter((key) => !APPENDIX4_ORDER.includes(key))],
      },
    },
    {
      id: "builtin:extended",
      name: "Расширенная форма (все колонки)",
      journalCode: "finished_product",
      builtIn: true,
      columns: { hidden: ["oxygen", "courier"], labels: {}, order: registryKeys("finished_product") },
    },
  ],
  perishable_rejection: [
    {
      id: "builtin:standard",
      name: "Стандартная форма (Приложение №5 СанПиН)",
      journalCode: "perishable_rejection",
      builtIn: true,
      columns: { hidden: [], labels: {}, order: registryKeys("perishable_rejection") },
    },
  ],
};

export function builtInTemplates(code: string): JournalColumnTemplate[] {
  return BUILT_IN[code] ?? [];
}

export function sanitizeTemplateName(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, JOURNAL_TEMPLATE_NAME_MAX) : "";
}

/**
 * Что изменится при применении шаблона — для предупреждения: сколько колонок
 * скроется, покажется, переименуется, сколько своих колонок уйдёт.
 */
export function describeTemplateChange(
  code: string,
  config: Record<string, unknown>,
  next: JournalColumnsConfig
): { hide: string[]; show: string[]; renamed: number; customRemoved: string[] } {
  const before = resolveColumns(code, config);
  const after = resolveColumns(code, { ...config, columns: next });
  const afterByKey = new Map(after.map((column) => [column.key, column]));
  const hide: string[] = [];
  const show: string[] = [];
  let renamed = 0;
  const customRemoved: string[] = [];
  for (const column of before) {
    const other = afterByKey.get(column.key);
    if (!other) {
      if (column.custom) customRemoved.push(column.label);
      continue;
    }
    if (!column.hidden && other.hidden) hide.push(column.label);
    if (column.hidden && !other.hidden) show.push(other.label);
    if (column.label !== other.label) renamed += 1;
  }
  for (const column of after) {
    if (!before.some((item) => item.key === column.key) && !column.hidden) show.push(column.label);
  }
  return { hide, show, renamed, customRemoved };
}

// ── Импорт «по типовой форме» из Excel ─────────────────────────────────

function norm(value: string): string {
  return value
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9%°]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Словарь синонимов: подпись шапки бумажной формы → колонка реестра.
 * Проверяем по вхождению ключевых фрагментов — у разных организаций
 * формулировки чуть разные («Дата и час изготовления блюда», «Дата, время
 * изготовления»).
 */
const SYNONYMS: Record<string, Array<{ key: string; any: string[][] }>> = {
  finished_product: [
    { key: "production", any: [["изготовлен"], ["дата", "час"]] },
    { key: "rejection", any: [["снят", "бракераж"], ["время", "бракераж"]] },
    { key: "portion", any: [["взвешиван"], ["выход"], ["вес"], ["масса"]] },
    { key: "signatures", any: [["подпис", "комисси"], ["подпис"]] },
    { key: "organoleptic", any: [["органолепт"], ["оценк"]] },
    { key: "release_allowed", any: [["разрешен", "да", "нет"]] },
    { key: "release", any: [["разрешен"], ["реализац"]] },
    { key: "temp", any: [["температур"], ["t", "продукт"], ["°c"]] },
    { key: "corrective", any: [["корректир"]] },
    { key: "oxygen", any: [["кислород"]] },
    { key: "courier", any: [["курьер"]] },
    { key: "responsible", any: [["ответствен"], ["исполнител"]] },
    { key: "inspector", any: [["проводивш"], ["фио", "бракераж"]] },
    { key: "name", any: [["наименован"], ["блюд"], ["издели"], ["полуфабрикат"]] },
    { key: "note", any: [["примечан"], ["комментар"]] },
  ],
  perishable_rejection: [
    { key: "arrival", any: [["поступлен"], ["дата", "час", "поступ"]] },
    { key: "productionDate", any: [["выработк"], ["дата", "изготовлен"]] },
    { key: "manufacturer", any: [["изготовител"], ["поставщик"], ["производител"]] },
    { key: "packaging", any: [["фасовк"], ["количеств"], ["кол во"]] },
    { key: "document", any: [["документ"], ["сертификат"], ["декларац"]] },
    { key: "organoleptic", any: [["органолепт"]] },
    { key: "storage", any: [["хранен"], ["срок", "реализац"]] },
    { key: "sale", any: [["фактическ"], ["реализац"]] },
    { key: "signatures", any: [["подпис", "комисси"]] },
    { key: "responsible", any: [["ответствен"], ["подпис"]] },
    { key: "product", any: [["наименован"], ["продукт"], ["продукци"]] },
    { key: "note", any: [["примечан"], ["комментар"]] },
  ],
};

/** Колонка реестра по подписи шапки или null. `taken` — уже занятые ключи. */
export function matchColumnLabel(code: string, label: string, taken: ReadonlySet<string> = new Set()): string | null {
  const text = norm(label);
  if (!text) return null;
  for (const entry of SYNONYMS[code] ?? []) {
    if (taken.has(entry.key)) continue;
    if (entry.any.some((fragments) => fragments.every((fragment) => text.includes(fragment)))) return entry.key;
  }
  return null;
}

/** Строка из одних номеров «1 2 3 …» — нумерация граф под шапкой. */
function isNumberingRow(cells: readonly string[]): boolean {
  const filled = cells.map((cell) => cell.trim()).filter(Boolean);
  return filled.length >= 2 && filled.every((cell) => /^\d{1,2}$/.test(cell));
}

/**
 * Подписи шапки из сетки первого листа: берём строку с наибольшим числом
 * текстовых ячеек среди первых 15 (нумерацию граф пропускаем); повторы
 * подряд — это развёрнутая объединённая ячейка, склеиваем в одну.
 */
export function findHeaderLabels(grid: readonly (readonly string[])[]): string[] {
  let best: string[] = [];
  let bestScore = 0;
  for (const row of grid.slice(0, 15)) {
    const cells = row.map((cell) => (cell ?? "").replace(/\s+/g, " ").trim());
    if (isNumberingRow(cells)) continue;
    const texts = cells.filter((cell) => /[A-Za-zА-Яа-яЁё]/.test(cell));
    if (texts.length > bestScore) {
      bestScore = texts.length;
      best = cells;
    }
  }
  const labels: string[] = [];
  for (const cell of best) {
    if (!cell || !/[A-Za-zА-Яа-яЁё]/.test(cell)) continue;
    if (labels[labels.length - 1] === cell) continue;
    labels.push(cell);
  }
  return labels.slice(0, 40);
}

export type ImportedColumnsPreview = {
  /** Узнали: подпись из файла → колонка журнала. */
  matched: Array<{ label: string; key: string; standardLabel: string }>;
  /** Не узнали — добавим своими текстовыми колонками. */
  custom: string[];
  /** Не поместились (свои колонки — не больше 12). */
  skipped: string[];
  columns: JournalColumnsConfig;
};

/**
 * Набор колонок по подписям шапки: узнанные колонки показываются под
 * подписью из файла и в его порядке, остальные колонки журнала скрываются,
 * неузнанные подписи становятся своими текстовыми колонками.
 */
export function columnsFromHeaderLabels(code: string, labels: readonly string[]): ImportedColumnsPreview {
  const registry = getColumnRegistry(code);
  const byKey = new Map(registry.map((column) => [column.key, column]));
  const taken = new Set<string>();
  const matched: ImportedColumnsPreview["matched"] = [];
  const customLabels: string[] = [];
  const skipped: string[] = [];
  const order: string[] = [];
  const custom: JournalCustomColumn[] = [];
  const labelsOut: Record<string, string> = {};

  for (const raw of labels) {
    const label = raw.replace(/\s+/g, " ").trim().slice(0, 60);
    if (!label || /^№?\s*п\s*\/?\s*п$|^№$/i.test(label)) continue;
    const key = matchColumnLabel(code, label, taken);
    if (key) {
      taken.add(key);
      const column = byKey.get(key);
      const standardLabel = column ? (typeof column.label === "function" ? column.label({}) : column.label) : key;
      matched.push({ label, key, standardLabel });
      order.push(key);
      if (label !== standardLabel) labelsOut[key] = label;
      continue;
    }
    if (custom.length >= JOURNAL_CUSTOM_COLUMNS_MAX) {
      skipped.push(label);
      continue;
    }
    const customColumn: JournalCustomColumn = { key: newCustomColumnKey(), label, type: "text" };
    custom.push(customColumn);
    customLabels.push(label);
    order.push(customColumn.key);
  }

  const hidden = registry.map((column) => column.key).filter((key) => !taken.has(key));
  const columns =
    sanitizeColumnsConfig(code, {
      hidden,
      labels: labelsOut,
      custom,
      order: [...order, ...hidden],
    }) ?? { hidden, labels: labelsOut };
  return { matched, custom: customLabels, skipped, columns };
}
