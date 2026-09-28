/**
 * Fuzzy-match имени должности из импорта (Excel / iiko / 1С) на
 * существующую `JobPosition` в WeSetup.
 *
 * Стратегия (в порядке приоритета):
 *   1. Exact match (case-insensitive, после нормализации)
 *   2. Alias-rules — таблица типичных вариаций для RU-индустрии
 *      («повар горячего цеха» → «Повар», «sushi-chef» → «Шеф-повар»)
 *   3. Levenshtein-distance ≤ 2 на нормализованных строках
 *   4. Substring containment (одно содержит другое)
 *
 * Возвращает confidence 0..1 — caller может фильтровать по threshold
 * (рекомендуется ≥ 0.7 для авто-присвоения, < 0.7 → ручной выбор).
 *
 * Не использует LLM — fast и deterministic. Если confidence низкая —
 * ручной выбор.
 */

export type MatchResult = {
  /** Текст из импорта */
  input: string;
  /** ID найденной JobPosition или null если не нашли */
  positionId: string | null;
  /** Имя найденной позиции (для UI confirmation) */
  positionName: string | null;
  /** 0..1, как уверены что match правильный.
   *  1.0 = exact match, 0.9 = alias, 0.7-0.8 = fuzzy, < 0.5 = guess */
  confidence: number;
  /** Какая стратегия сработала — для отладки и UI badge'ов */
  strategy: "exact" | "alias" | "levenshtein" | "substring" | "none";
};

export type JobPositionLite = {
  id: string;
  name: string;
};

/**
 * Нормализация: lowercase, trim, удаление лишних пробелов и
 * пунктуации. Это база для всех сравнений.
 */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[«»"'.,!?()\-–—]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Алиасы — типичные вариации названий должностей в индустрии.
 * Ключ — нормализованный вариант, значение — нормализованное
 * каноничное имя должности из preset'ов.
 *
 * Расширяется по мере обнаружения новых вариаций (можно вынести в
 * отдельный JSON-config файл, если разрастётся).
 */
const ALIASES: Record<string, string> = {
  // Управление
  "управляющий": "управляющий",
  "управляющая": "управляющий",
  "директор": "управляющий",
  "директор ресторана": "управляющий",
  "генеральный директор": "управляющий",
  "генеральный": "управляющий",
  "руководитель": "управляющий",
  "владелец": "управляющий",
  "собственник": "управляющий",
  "manager": "управляющий",

  // Шеф-повар
  "шеф": "шеф-повар",
  "шеф повар": "шеф-повар",
  "шеф повара": "шеф-повар",
  "главный повар": "шеф-повар",
  "head chef": "шеф-повар",
  "executive chef": "шеф-повар",
  "су шеф": "су-шеф",
  "су-шеф": "су-шеф",
  "sous chef": "су-шеф",

  // Технолог
  "технолог": "технолог",
  "технолог производства": "технолог",
  "главный технолог": "технолог",
  "qa": "технолог",
  "qc": "технолог",

  // Повара (по специализациям)
  "повар": "повар",
  "повар горячего цеха": "повар горячего цеха",
  "повар горячего": "повар горячего цеха",
  "горячий цех": "повар горячего цеха",
  "повар холодного цеха": "повар холодного цеха",
  "повар холодного": "повар холодного цеха",
  "холодный цех": "повар холодного цеха",
  "повар кондитер": "кондитер",
  "пекарь": "пекарь",
  "хлебопёк": "пекарь",
  "хлебопек": "пекарь",
  "тестомес": "тестомес",
  "кондитер": "кондитер",
  "cook": "повар",
  "chef": "повар",

  // Бар / зал
  "бармен": "бармен",
  "бариста": "бариста",
  "barista": "бариста",
  "bartender": "бармен",
  "официант": "официант",
  "официантка": "официант",
  "waiter": "официант",
  "waitress": "официант",
  "хостес": "хостес",

  // Подсобный персонал
  "уборщик": "уборщица",
  "уборщица": "уборщица",
  "уборщик помещений": "уборщица",
  "клинер": "уборщица",
  "cleaner": "уборщица",
  "грузчик": "грузчик",
  "loader": "грузчик",
  "посудомойщик": "посудомойщик",
  "посудомойщица": "посудомойщик",
  "dishwasher": "посудомойщик",
  "кухонный работник": "кухонный работник",
  "помощник повара": "помощник повара",

  // Производство (мясо, кондитерка)
  "мясник": "мясник",
  "обвальщик": "обвальщик",
  "разделочник": "обвальщик",
  "оператор линии": "оператор линии",
  "упаковщик": "упаковщик",
  "кладовщик": "кладовщик",
  "кладовая": "кладовщик",
  "приёмщик": "кладовщик",
  "приемщик": "кладовщик",
  "приёмщик товара": "кладовщик",
};

/**
 * Levenshtein distance — минимальное количество правок (вставок,
 * удалений, замен) для превращения одной строки в другую. Используем
 * для fuzzy match'а коротких имён должностей.
 *
 * Стандартный DP, O(n*m) memory. Для имён в 30-40 символов — ms.
 */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1, // insertion
          matrix[i - 1][j] + 1 // deletion
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

/**
 * Главная функция. Принимает список входных строк + список существующих
 * позиций, возвращает MatchResult по каждому input'у.
 */
export function matchJobPositions(
  inputs: string[],
  positions: JobPositionLite[]
): MatchResult[] {
  // Pre-build lookup-таблицы для скорости.
  const positionsByNorm = new Map<string, JobPositionLite>();
  for (const p of positions) {
    positionsByNorm.set(normalize(p.name), p);
  }

  const results: MatchResult[] = [];

  for (const input of inputs) {
    const norm = normalize(input);
    if (!norm) {
      results.push({
        input,
        positionId: null,
        positionName: null,
        confidence: 0,
        strategy: "none",
      });
      continue;
    }

    // 1. Exact match
    const exact = positionsByNorm.get(norm);
    if (exact) {
      results.push({
        input,
        positionId: exact.id,
        positionName: exact.name,
        confidence: 1.0,
        strategy: "exact",
      });
      continue;
    }

    // 2. Alias rule
    const aliasTarget = ALIASES[norm];
    if (aliasTarget) {
      const aliased = positionsByNorm.get(aliasTarget);
      if (aliased) {
        results.push({
          input,
          positionId: aliased.id,
          positionName: aliased.name,
          confidence: 0.92,
          strategy: "alias",
        });
        continue;
      }
    }

    // 3. Levenshtein — ищем ближайшую позицию по distance
    let bestPos: JobPositionLite | null = null;
    let bestDist = Number.POSITIVE_INFINITY;
    for (const p of positions) {
      const d = levenshtein(norm, normalize(p.name));
      if (d < bestDist) {
        bestDist = d;
        bestPos = p;
      }
    }
    if (bestPos && bestDist <= 2) {
      // distance ≤ 2 на коротких строках = почти точно совпадение
      // (опечатка / одна буква). confidence убывает с distance.
      const conf = bestDist === 0 ? 1.0 : bestDist === 1 ? 0.85 : 0.72;
      results.push({
        input,
        positionId: bestPos.id,
        positionName: bestPos.name,
        confidence: conf,
        strategy: "levenshtein",
      });
      continue;
    }

    // 4. Substring containment — «повар горячего цеха» ↔ «Повар»
    let containsMatch: JobPositionLite | null = null;
    for (const p of positions) {
      const np = normalize(p.name);
      if (norm.includes(np) || np.includes(norm)) {
        // Предпочитаем более длинные совпадения (точнее)
        if (
          !containsMatch ||
          normalize(containsMatch.name).length < np.length
        ) {
          containsMatch = p;
        }
      }
    }
    if (containsMatch) {
      results.push({
        input,
        positionId: containsMatch.id,
        positionName: containsMatch.name,
        confidence: 0.65,
        strategy: "substring",
      });
      continue;
    }

    // 5. Не нашли
    results.push({
      input,
      positionId: null,
      positionName: null,
      confidence: 0,
      strategy: "none",
    });
  }

  return results;
}
