import { journalMatchesQuery, normalizeJournalSearch, switchKeyboardLayout } from "@/lib/journal-search";

/**
 * Поиск по сайту (кнопка «Поиск» в шапке публичных страниц): журналы,
 * бланки, приказы, статьи блога и базы знаний, глоссарий, возможности,
 * страницы для ниш и служебные страницы — всё в одном окне.
 *
 * Индекс небольшой (сотни строк), поэтому браузер скачивает его один раз
 * при открытии окна и ищет сам — результат появляется на каждую букву.
 * Матчер тот же, что у каталога журналов (`journal-search.ts`): опечатки,
 * падежи, неверная раскладка клавиатуры.
 *
 * Чистый модуль — его импортирует клиентский компонент.
 */

export const SITE_SEARCH_KINDS = [
  "journal",
  "blank",
  "order",
  "page",
  "kb",
  "blog",
  "glossary",
  "feature",
] as const;
export type SiteSearchKind = (typeof SITE_SEARCH_KINDS)[number];

export type SiteSearchItem = {
  kind: SiteSearchKind;
  title: string;
  /** Короткое пояснение под заголовком (одна-две строки). */
  description: string;
  href: string;
  /** Скрытые слова для поиска: код журнала, синонимы, норматив. */
  keywords?: string;
};

/** Чем выше, тем раньше группа и её строки при равном совпадении. */
const KIND_WEIGHT: Record<SiteSearchKind, number> = {
  journal: 8,
  blank: 6,
  order: 5,
  page: 4,
  feature: 3,
  kb: 3,
  glossary: 2,
  blog: 1,
};

/**
 * Насколько строка подходит к запросу; 0 — не подходит. Целиком в названии
 * (особенно с начала) — выше всего, затем нечёткое совпадение в названии,
 * затем — в описании и скрытых словах.
 */
export function siteSearchScore(item: SiteSearchItem, query: string): number {
  const q = normalizeJournalSearch(query);
  if (!q) return 0;
  const title = normalizeJournalSearch(item.title);
  const weight = KIND_WEIGHT[item.kind];
  const switched = switchKeyboardLayout(q);
  for (const variant of switched === q ? [q] : [q, switched]) {
    if (title.startsWith(variant)) return 120 + weight;
    if (title.includes(` ${variant}`)) return 110 + weight;
    if (title.includes(variant)) return 100 + weight;
  }
  if (journalMatchesQuery([item.title], q)) return 60 + weight;
  if (journalMatchesQuery([item.title, item.description, item.keywords], q)) return 30 + weight;
  return 0;
}

export type SiteSearchGroup = { kind: SiteSearchKind; items: SiteSearchItem[] };

/**
 * Результаты запроса, сгруппированные по видам. Группы — по лучшему
 * совпадению внутри (самое точное — первым), в группе не больше `perGroup`.
 */
export function searchSite(
  items: readonly SiteSearchItem[],
  query: string,
  options: { perGroup?: number; limit?: number } = {},
): SiteSearchGroup[] {
  const perGroup = options.perGroup ?? 6;
  const limit = options.limit ?? 30;
  const scored = items
    .map((item, index) => ({ item, index, score: siteSearchScore(item, query) }))
    .filter((row) => row.score > 0)
    // При равном совпадении — короче название (точнее), затем порядок индекса.
    .sort((a, b) => b.score - a.score || a.item.title.length - b.item.title.length || a.index - b.index);
  const groups = new Map<SiteSearchKind, { best: number; items: SiteSearchItem[] }>();
  let total = 0;
  for (const row of scored) {
    if (total >= limit) break;
    const group = groups.get(row.item.kind) ?? { best: row.score, items: [] };
    if (group.items.length >= perGroup) continue;
    group.items.push(row.item);
    groups.set(row.item.kind, group);
    total += 1;
  }
  return [...groups.entries()]
    .sort((a, b) => b[1].best - a[1].best)
    .map(([kind, group]) => ({ kind, items: group.items }));
}

/** Плоский порядок результатов — для стрелок на клавиатуре. */
export function flattenSiteSearch(groups: readonly SiteSearchGroup[]): SiteSearchItem[] {
  return groups.flatMap((group) => group.items);
}

/** Обрезка описания до одной-двух строк без разрыва слова. */
export function shortDescription(text: string | null | undefined, max = 140): string {
  const clean = (text ?? "").replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:—-]+$/, "")}…`;
}
