/**
 * Поиск по журналам — один матчер на все места, где он есть: список
 * «Журналы», набор в настройках и дашборд.
 *
 * Отдельный модуль, потому что иначе у каждого экрана заводится своя
 * нормализация, и один и тот же запрос находит разное. Сравнение идёт по
 * названию, описанию и коду: код нужен, когда журнал ищут по ссылке или
 * по упоминанию в переписке с поддержкой.
 *
 * Только чистые функции — модуль импортируют клиентские компоненты.
 */

/**
 * Нижний регистр, «ё» как «е», пробелы схлопнуты. «Учёт» в названии и
 * «учет», набранный без «ё», — одно и то же слово; лишний пробел из
 * копипаста тоже не должен ломать поиск.
 */
export function normalizeJournalSearch(value: string): string {
  return value
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ")
    .trim();
}

/** Клавиши английской раскладки и русские буквы на тех же местах (ЙЦУКЕН). */
const LAYOUT_EN = "qwertyuiop[]asdfghjkl;'zxcvbnm,.`";
const LAYOUT_RU = "йцукенгшщзхъфывапролджэячсмитьбюё";
const LAYOUT_SWAP = new Map<string, string>();
for (let index = 0; index < LAYOUT_EN.length; index += 1) {
  LAYOUT_SWAP.set(LAYOUT_EN[index], LAYOUT_RU[index]);
  LAYOUT_SWAP.set(LAYOUT_RU[index], LAYOUT_EN[index]);
}

/**
 * Тот же текст, набранный в другой раскладке: «ububtyf» → «гигиена»,
 * «рнпшутт» → «hygiene». Человек начал печатать, не переключив язык, — это
 * не повод показывать «ничего не нашлось». Остальные символы (цифры,
 * пробелы) не меняются.
 */
export function switchKeyboardLayout(value: string): string {
  let out = "";
  for (const char of value.toLocaleLowerCase("ru-RU")) out += LAYOUT_SWAP.get(char) ?? char;
  return out;
}

function matchesWords(haystack: string, query: string): boolean {
  const words = normalizeJournalSearch(query).split(" ").filter(Boolean);
  return words.every((word) => haystack.includes(word));
}

/**
 * Совпадает ли журнал с запросом. Нужны ВСЕ слова запроса, в любом
 * порядке: «журнал гигиен» находит «Гигиенический журнал». Пустой
 * запрос совпадает со всем — вызывающему не нужно про это помнить.
 *
 * Запрос нормализуется ещё раз (нормализация идемпотентна): так сырой
 * ввод с «ё» или двойным пробелом не даёт молчаливого «ничего не нашлось».
 * Не нашлось как набрано — пробуем тот же запрос в другой раскладке.
 */
export function journalMatchesQuery(
  fields: Array<string | null | undefined>,
  normalizedQuery: string,
): boolean {
  const query = normalizeJournalSearch(normalizedQuery);
  if (query === "") return true;
  const haystack = normalizeJournalSearch(fields.filter(Boolean).join(" "));
  if (matchesWords(haystack, query)) return true;
  return matchesWords(haystack, switchKeyboardLayout(query));
}
