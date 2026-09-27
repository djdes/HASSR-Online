/**
 * Журналы везде по алфавиту — один компаратор на все списки (сайт,
 * мини-приложение, QR-коды, настройки, отчёты, бот).
 *
 * Сортируем по названию, которое видит компания: если журнал переименован
 * в «Настройки → Названия», он встаёт по новому имени. Поэтому порядок
 * считается при выводе, а не хранится в `JournalTemplate.sortOrder`
 * (там остаётся исторический порядок каталога, его читают внутренние
 * расчёты).
 *
 * Правила: русский алфавит без учёта регистра, «ё» как «е», номера по
 * смыслу (№2 раньше №10), открывающие кавычки и скобки в начале не
 * мешают. Только чистые функции — модуль импортируют и клиентские
 * компоненты.
 */

const collator = new Intl.Collator("ru-RU", { sensitivity: "base", numeric: true });

function sortKey(name: string): string {
  return name
    .trim()
    .replace(/^[«"'„“(\[]+/u, "")
    .replace(/ё/g, "е")
    .replace(/Ё/g, "Е");
}

/** Сравнение двух названий журналов для сортировки по алфавиту. */
export function compareJournalNames(a: string, b: string): number {
  return collator.compare(sortKey(a), sortKey(b));
}

/**
 * Новый список, отсортированный по названию. Исходный не меняется;
 * журналы с одинаковым названием остаются в прежнем порядке.
 */
export function sortJournalsByName<T>(items: readonly T[], nameOf: (item: T) => string): T[] {
  return [...items].sort((a, b) => compareJournalNames(nameOf(a), nameOf(b)));
}
