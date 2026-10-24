/**
 * Поиск и пагинация редактора переводов. Модуль чистый: его читают API
 * (ранжирование) и клиент (подсветка совпадений, окно номеров страниц).
 */

export const TRANSLATION_PAGE_SIZE = 100;

/** Длина запроса поиска: столько принимает API, клиент обрезает до неё. */
export const MAX_SEARCH_LENGTH = 200;

/** Варианты апострофа узбекской латиницы (oʻ, gʻ) и типографские кавычки. */
const APOSTROPHES = /[ʻʼ‘’`´]/g;

/**
 * Регистр, «ё/е» и вид апострофа не важны. Длина строки не меняется
 * (замены один к одному), поэтому позиции совпадений годятся и для
 * исходного текста — на них держится подсветка.
 */
export function normalizeSearchText(text: string): string {
  return text.toLocaleLowerCase("ru").replace(/ё/g, "е").replace(APOSTROPHES, "'");
}

export function searchTokens(needle: string): string[] {
  return normalizeSearchText(needle).trim().split(/\s+/).filter(Boolean);
}

const WORD_CHAR = /[\p{L}\p{N}]/u;

function startsWord(haystack: string, needle: string): boolean {
  for (let index = haystack.indexOf(needle); index >= 0; index = haystack.indexOf(needle, index + 1)) {
    if (index === 0 || !WORD_CHAR.test(haystack[index - 1])) return true;
  }
  return false;
}

/**
 * Место строки в выдаче поиска, меньше — выше; `null` — не подходит.
 *   0 — текст или ключ совпал целиком;
 *   1 — текст начинается с запроса;
 *   2 — с запроса начинается слово текста;
 *   3 — запрос — часть ключа;
 *   4 — запрос — часть текста;
 *   5 — все слова запроса есть в одном тексте или ключе, но не подряд.
 * `texts` и `key` — уже нормализованные (`normalizeSearchText`).
 */
export function searchRank(needle: string, key: string, texts: readonly string[]): number | null {
  const phrase = needle.trim();
  if (!phrase) return null;
  if (key === phrase || texts.some((text) => text.trim() === phrase)) return 0;
  if (texts.some((text) => text.trimStart().startsWith(phrase))) return 1;
  if (texts.some((text) => startsWord(text, phrase))) return 2;
  if (key.includes(phrase)) return 3;
  if (texts.some((text) => text.includes(phrase))) return 4;
  const tokens = phrase.split(/\s+/);
  if (tokens.length > 1 && [key, ...texts].some((text) => tokens.every((token) => text.includes(token)))) return 5;
  return null;
}

export type HighlightSegment = { text: string; match: boolean };

/** Текст, разбитый на куски с подсвеченными словами запроса. */
export function highlightSegments(text: string, tokens: readonly string[]): HighlightSegment[] {
  const normalized = normalizeSearchText(text);
  // Редкие символы меняют длину при смене регистра — тогда без подсветки.
  if (!tokens.length || normalized.length !== text.length) return [{ text, match: false }];
  const ranges: [number, number][] = [];
  for (const token of tokens) {
    for (let index = normalized.indexOf(token); index >= 0; index = normalized.indexOf(token, index + token.length)) {
      ranges.push([index, index + token.length]);
    }
  }
  if (!ranges.length) return [{ text, match: false }];
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push([...range]);
  }
  const segments: HighlightSegment[] = [];
  let cursor = 0;
  for (const [start, end] of merged) {
    if (start > cursor) segments.push({ text: text.slice(cursor, start), match: false });
    segments.push({ text: text.slice(start, end), match: true });
    cursor = end;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), match: false });
  return segments;
}

/**
 * Номера страниц для переключателя (страницы с 1): первая, последняя и
 * соседи текущей, пропуски — `"gap"`. Длина ряда постоянна (7 мест),
 * чтобы кнопки не прыгали при листании.
 */
export function pageWindow(current: number, totalPages: number): (number | "gap")[] {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, index) => index + 1);
  if (current <= 4) return [1, 2, 3, 4, 5, "gap", totalPages];
  if (current >= totalPages - 3) return [1, "gap", totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
  return [1, "gap", current - 1, current, current + 1, "gap", totalPages];
}
