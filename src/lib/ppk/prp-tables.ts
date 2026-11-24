/**
 * Таблицы раздела 3 структуры ППК (программы обязательных предварительных
 * мероприятий): какие колонки у строки каждой таблицы и их пределы. Одна
 * настройка на схему записи (`records.ts`), окно правки и тесты.
 * Чистый модуль без React и БД.
 */

export const PRP_TABLE_BLOCKS = ["prp-infections", "prp-disinfection", "prp-emergencies", "prp-medical"] as const;
export type PrpTableBlock = (typeof PRP_TABLE_BLOCKS)[number];

export type PrpColumn = {
  /** Ключ поля в `data` записи и в каталоге подписей колонок. */
  key: string;
  /** Предел длины после обрезки пробелов. */
  max: number;
  /** Пустым быть не может (первая колонка таблицы). */
  required?: boolean;
  /** Многострочное поле в окне правки. */
  multiline?: boolean;
};

export const PRP_TABLES: Record<PrpTableBlock, readonly PrpColumn[]> = {
  // 3.1 Мероприятия по предупреждению острых кишечных инфекций и пищевых отравлений.
  "prp-infections": [
    { key: "measure", max: 1000, required: true, multiline: true },
    { key: "frequency", max: 200 },
    { key: "responsible", max: 200 },
    { key: "record", max: 300 },
  ],
  // 3.2 Санитарно-гигиеническая программа дезинфекции.
  "prp-disinfection": [
    { key: "object", max: 300, required: true },
    { key: "agent", max: 300 },
    { key: "method", max: 1000, multiline: true },
    { key: "frequency", max: 200 },
    { key: "responsible", max: 200 },
  ],
  // 3.3 Аварийные ситуации и меры по их устранению.
  "prp-emergencies": [
    { key: "situation", max: 300, required: true },
    { key: "actions", max: 2000, multiline: true },
  ],
  // 3.4 Медицинские осмотры, обследования и вакцинации (Приказ Минздрава № 29н).
  "prp-medical": [
    { key: "kind", max: 500, required: true, multiline: true },
    { key: "frequency", max: 300 },
    { key: "who", max: 300 },
    { key: "basis", max: 300 },
  ],
};

/** Предел строк каждой таблицы. */
export const PRP_TABLE_LIMIT = 100;

export type PrpRow = Record<string, string>;

export function isPrpTableBlock(value: unknown): value is PrpTableBlock {
  return typeof value === "string" && (PRP_TABLE_BLOCKS as readonly string[]).includes(value);
}

/** Пустая строка таблицы: все колонки — пустые строки. */
export function emptyPrpRow(block: PrpTableBlock): PrpRow {
  return Object.fromEntries(PRP_TABLES[block].map((column) => [column.key, ""]));
}
