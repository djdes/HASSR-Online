/**
 * Поиск по журналам — один матчер на все места, где он есть: каталог
 * `/journals-info`, список «Журналы» в кабинете, набор в настройках и дашборд.
 *
 * Отдельный модуль, потому что иначе у каждого экрана заводится своя
 * нормализация, и один и тот же запрос находит разное. Сравнение идёт по
 * названию, описанию и коду: код нужен, когда журнал ищут по ссылке или
 * по упоминанию в переписке с поддержкой.
 *
 * Поддерживает:
 * - точное вхождение подстроки и префикса («темп», «гигиен»);
 * - поиск по основе слова без падежных и суффиксных окончаний («гигиена» → «Гигиенический»,
 *   «холодильник» → «холодильного», «фритюрница» → «фритюрных»);
 * - нечёткий поиск с опечатками (расстояние Дамерау — Левенштейна 1–2 символа:
 *   «темпиратура», «гигена», «бракираж», «холодилник», «фритюрнца»);
 * - пропуск слога в середине длинного слова («темпоура» → «температура»,
 *   «стерилзация» → «стерилизация», «дезнфекция» → «дезинфекция»);
 * - автоматическое переключение раскладки клавиатуры («ububtyf» → «гигиена»,
 *   «ntvgjehf» → «темпоура» → «температура»).
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
 * «рнпшуту» → «hygiene». Человек начал печатать, не переключив язык, — это
 * не повод показывать «ничего не нашлось». Остальные символы (цифры,
 * пробелы) не меняются.
 */
export function switchKeyboardLayout(value: string): string {
  let out = "";
  for (const char of value.toLocaleLowerCase("ru-RU")) out += LAYOUT_SWAP.get(char) ?? char;
  return out;
}

/** Разбивает нормализованную строку на отдельные слова (от 2 символов). */
function tokenizeWords(normalizedText: string): string[] {
  return normalizedText
    .split(/[^a-zа-я0-9]+/i)
    .filter((w) => w.length >= 2);
}

/**
 * Отсекает частые русские падежные и словообразовательные окончания, если корень
 * остаётся не короче 4 символов («гигиена» → «гигиен», «холодильник» → «холодильн»,
 * «фритюрница» → «фритюрн», «температурный» → «температур»).
 */
function stripInflection(word: string): string {
  if (word.length < 5) return word;
  let s = word.replace(
    /(?:ический|ическая|ическое|ических|ования|ование|ение|ание|ями|ами|ого|ему|ому|ыми|ими|ость|ости|ая|яя|ое|ее|ые|ие|ой|ей|ый|ий|ом|ем|ам|ям|ах|ях|ую|юю|ов|ев|а|я|о|е|ы|и|у|ю)$/i,
    "",
  );
  if (s.length >= 6) {
    const root = s.replace(/(?:льник|лник|ница|нца|тель|ация|яция|ник|ниц|нц|ск|н)$/i, "");
    if (root.length >= 4) s = root;
  }
  return s.length >= 4 ? s : word;
}

/**
 * Расстояние Дамерау — Левенштейна (вставка, удаление, замена и перестановка
 * двух соседних символов = 1 операция) с ранним выходом по `maxDist`.
 */
function editDistance(a: string, b: string, maxDist: number): number {
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > maxDist) return maxDist + 1;
  if (a === b) return 0;

  const dp: number[][] = Array.from({ length: la + 1 }, () => new Array<number>(lb + 1).fill(0));
  for (let i = 0; i <= la; i += 1) dp[i][0] = i;
  for (let j = 0; j <= lb; j += 1) dp[0][j] = j;

  for (let i = 1; i <= la; i += 1) {
    let rowMin = maxDist + 1;
    for (let j = 1; j <= lb; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let val = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost,
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        val = Math.min(val, dp[i - 2][j - 2] + 1);
      }
      dp[i][j] = val;
      if (val < rowMin) rowMin = val;
    }
    if (rowMin > maxDist) return maxDist + 1;
  }
  return dp[la][lb];
}

/** Длина наибольшей общей подпоследовательности (LCS) двух слов. */
function lcsLength(a: string, b: string): number {
  const la = a.length;
  const lb = b.length;
  const prev = new Uint8Array(lb + 1);
  const curr = new Uint8Array(lb + 1);
  for (let i = 1; i <= la; i += 1) {
    for (let j = 1; j <= lb; j += 1) {
      curr[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], curr[j - 1]);
    }
    prev.set(curr);
  }
  return prev[lb];
}

/** Длина общего префикса двух слов. */
function commonPrefixLen(a: string, b: string): number {
  const limit = Math.min(a.length, b.length);
  let i = 0;
  while (i < limit && a[i] === b[i]) i += 1;
  return i;
}

/**
 * Проверяет совпадение одного слова запроса с текстом журнала:
 * 1) точная подстрока (`haystack.includes(qWord)`) или подстрока основы;
 * 2) опечатка в 1–2 символа (Дамерау — Левенштейн) относительно слова или его префикса/основы;
 * 3) пропуск слога в середине длинного слова (от 6 букв, общий префикс ≥ 3 букв и LCS ≥ qLen - 1,
 *    например «темпоура» → «температура»).
 */
function matchesSingleWord(targetWords: string[], haystack: string, qWord: string): boolean {
  if (haystack.includes(qWord)) return true;

  const qStem = stripInflection(qWord);
  if (qStem !== qWord && haystack.includes(qStem)) return true;

  const candidates = qStem !== qWord ? [qWord, qStem] : [qWord];

  for (const cand of candidates) {
    const qLen = cand.length;
    if (qLen < 4) continue;
    const maxEdits = qLen >= 7 ? 2 : 1;

    for (const tWord of targetWords) {
      if (tWord.length < 3) continue;
      // Первая буква должна совпадать (либо переставлены местами первые две буквы)
      const sameStart =
        tWord[0] === cand[0] ||
        (qLen >= 4 && tWord.length >= 4 && tWord[0] === cand[1] && tWord[1] === cand[0]);
      if (!sameStart) continue;

      const tStem = stripInflection(tWord);
      if (editDistance(cand, tStem, maxEdits) <= maxEdits) {
        return true;
      }

      const minSlice = Math.max(3, qLen - maxEdits);
      const maxSlice = Math.min(tWord.length, qLen + maxEdits);
      for (let len = minSlice; len <= maxSlice; len += 1) {
        const slice = len === tWord.length ? tWord : tWord.slice(0, len);
        if (editDistance(cand, slice, maxEdits) <= maxEdits) {
          return true;
        }
      }

      // Пропуск слога в середине длинного слова («темпоура» → «температура»)
      if (
        qLen >= 6 &&
        tWord.length >= qLen &&
        tWord.length <= qLen + 6 &&
        commonPrefixLen(cand, tWord) >= 3 &&
        lcsLength(cand, tWord) >= qLen - 1
      ) {
        return true;
      }
    }
  }

  return false;
}

function matchesWords(haystack: string, targetWords: string[], query: string): boolean {
  const words = normalizeJournalSearch(query).split(" ").filter(Boolean);
  return words.every((word) => matchesSingleWord(targetWords, haystack, word));
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
  if (haystack === "") return false;
  const targetWords = tokenizeWords(haystack);
  if (matchesWords(haystack, targetWords, query)) return true;
  const switched = switchKeyboardLayout(query);
  if (switched === query) return false;
  return matchesWords(haystack, targetWords, switched);
}
