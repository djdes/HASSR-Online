import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { flattenMessages } from "@/i18n/catalog-validation";
import { LOCALES, type Locale } from "@/i18n/locales";
import { loadBaseMessages } from "@/i18n/messages";
import { isStaleOverride, looksUntranslated, placeholderNames, validateOverride, type FlatCatalog, type OverrideValidation } from "./catalog";
import { buildCategories, type TranslationCategorySummary } from "./categories";
import { invalidateTranslationOverrides } from "./overrides.server";
import { normalizeSearchText, searchRank, TRANSLATION_PAGE_SIZE } from "./search";
import { historyItemsFromAudit, isAutoCandidate, matchesFilter, type TranslationFilter, type TranslationHistoryItem } from "./view";

export type TranslationActor = { id: string; name: string; organizationId: string; isRoot: boolean };

/**
 * Редактор открыт ROOT и переводчику (`User.canEditTranslations`).
 * Право читаем из БД на каждый запрос: снятое право действует сразу,
 * без перевыпуска JWT.
 */
export async function getTranslationActor(): Promise<TranslationActor | null> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return null;
  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, name: true, organizationId: true, isRoot: true, canEditTranslations: true, isActive: true, archivedAt: true },
  });
  if (!user || !user.isActive || user.archivedAt) return null;
  if (!user.isRoot && !user.canEditTranslations) return null;
  return { id: user.id, name: user.name, organizationId: user.organizationId, isRoot: user.isRoot };
}

export async function canEditTranslations(userId: string): Promise<boolean> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { isRoot: true, canEditTranslations: true, isActive: true, archivedAt: true },
  });
  return Boolean(user && user.isActive && !user.archivedAt && (user.isRoot || user.canEditTranslations));
}

type BaseCatalogs = {
  flat: Record<Locale, FlatCatalog>;
  keys: string[];
  categories: TranslationCategorySummary[];
  /** Ключ → id категории: результат поиска показывает, откуда строка. */
  categoryOf: Map<string, string>;
};
let baseCatalogs: Promise<BaseCatalogs> | null = null;

export function getBaseCatalogs(): Promise<BaseCatalogs> {
  baseCatalogs ??= (async () => {
    const entries = await Promise.all(LOCALES.map(async (locale) => [locale, flattenMessages(await loadBaseMessages(locale))] as const));
    const flat = Object.fromEntries(entries) as Record<Locale, FlatCatalog>;
    const keys = Object.keys(flat.ru);
    const categories = buildCategories(keys);
    const categoryOf = new Map(categories.flatMap((category) => category.keys.map((key) => [key, category.id] as const)));
    return { flat, keys, categories, categoryOf };
  })();
  return baseCatalogs;
}

type StoredOverride = { value: string; sourceRu: string | null };
type OverrideRow = Partial<Record<Locale, StoredOverride>>;

async function overrideMap(keys?: string[]): Promise<Map<string, OverrideRow>> {
  const rows = await db.translationOverride.findMany({
    where: keys ? { key: { in: keys } } : undefined,
    select: { locale: true, key: true, value: true, sourceRu: true },
  });
  const map = new Map<string, OverrideRow>();
  for (const row of rows) {
    if (!(LOCALES as readonly string[]).includes(row.locale)) continue;
    map.set(row.key, { ...map.get(row.key), [row.locale]: { value: row.value, sourceRu: row.sourceRu } });
  }
  return map;
}

export type TranslationEntry = {
  key: string;
  /** Категория редактора, в которой лежит строка. */
  category: string;
  /** Значение, которое видит интерфейс (файл или правка). */
  values: Record<Locale, string>;
  /** Значение из файла каталога — для сброса и сравнения. */
  base: Record<Locale, string>;
  overridden: Locale[];
  /** Правка сделана вручную, а русский исходник с тех пор изменился. */
  stale: Locale[];
  untranslated: Locale[];
  placeholders: string[];
};

// Разбор ICU дорогой, а русский исходник не меняется до деплоя.
const placeholderCache = new Map<string, string[]>();

// Текст для поиска: каталог не меняется до деплоя, правок — сотни, так
// что кэш ограничен самими строками каталога и правок.
const searchTextCache = new Map<string, string>();

function searchText(text: string): string {
  let normalized = searchTextCache.get(text);
  if (normalized === undefined) {
    normalized = normalizeSearchText(text);
    searchTextCache.set(text, normalized);
  }
  return normalized;
}

function placeholdersOf(key: string, russian: string): string[] {
  let names = placeholderCache.get(key);
  if (!names) {
    names = placeholderNames(russian);
    placeholderCache.set(key, names);
  }
  return names;
}

type BareEntry = Omit<TranslationEntry, "placeholders" | "category">;

/** Без `placeholders` и `category`: их добавляет `finishEntry` для выдаваемой страницы. */
function toEntry(key: string, flat: Record<Locale, FlatCatalog>, overrides: OverrideRow | undefined): BareEntry {
  const base = Object.fromEntries(LOCALES.map((locale) => [locale, flat[locale][key] ?? ""])) as Record<Locale, string>;
  const values = Object.fromEntries(LOCALES.map((locale) => [locale, overrides?.[locale]?.value ?? base[locale]])) as Record<Locale, string>;
  return {
    key,
    values,
    base,
    overridden: LOCALES.filter((locale) => overrides?.[locale] !== undefined),
    // Русская строка сверяется с файлом, en/uz — с русским, каким его видит сайт.
    stale: LOCALES.filter((locale) => overrides?.[locale] !== undefined && isStaleOverride(overrides[locale]!.sourceRu, locale === "ru" ? base.ru : values.ru)),
    untranslated: LOCALES.filter((locale) => looksUntranslated(locale, values[locale], values.ru)),
  };
}

function finishEntry(entry: BareEntry, categoryOf: Map<string, string>): TranslationEntry {
  return { ...entry, category: categoryOf.get(entry.key) ?? "", placeholders: placeholdersOf(entry.key, entry.base.ru) };
}

export type CategoryStats = { id: string; group: TranslationCategorySummary["group"]; namespace?: string; title?: string; total: number; modified: number; stale: number; untranslated: number };

export async function listCategoryStats(): Promise<CategoryStats[]> {
  const { flat, categories } = await getBaseCatalogs();
  const overrides = await overrideMap();
  return categories.map((category) => {
    let modified = 0;
    let stale = 0;
    let untranslated = 0;
    for (const key of category.keys) {
      const entry = toEntry(key, flat, overrides.get(key));
      if (entry.overridden.length) modified++;
      if (entry.stale.length) stale++;
      if (entry.untranslated.length) untranslated++;
    }
    const title = category.titleKey ? flat.ru[category.titleKey] : undefined;
    return { id: category.id, group: category.group, namespace: category.namespace, title, total: category.keys.length, modified, stale, untranslated };
  });
}

export type EntryQuery = { category?: string; q?: string; filter?: TranslationFilter; offset?: number; limit?: number };

type AutoLocale = Exclude<Locale, "ru">;

/**
 * Строки раздела (или всего каталога — так работает глобальный поиск)
 * после фильтра и поиска. С запросом упорядочены по `searchRank`
 * (точные совпадения выше), без запроса — в порядке категории.
 */
async function scanEntries(query: EntryQuery): Promise<BareEntry[] | null> {
  const { flat, keys, categories } = await getBaseCatalogs();
  let scope = keys;
  if (query.category) {
    const category = categories.find((item) => item.id === query.category);
    if (!category) return null;
    scope = category.keys;
  }
  const needle = normalizeSearchText(query.q ?? "").trim();
  const filter = query.filter ?? "all";
  // Правок — сотни, не тысячи: читаем все одним запросом.
  const overrides = await overrideMap();
  const matched: { entry: BareEntry; rank: number }[] = [];
  for (const key of scope) {
    const entry = toEntry(key, flat, overrides.get(key));
    if (!matchesFilter(entry, filter)) continue;
    let rank = 0;
    if (needle) {
      const found = searchRank(needle, searchText(key), LOCALES.map((locale) => searchText(entry.values[locale])));
      if (found === null) continue;
      rank = found;
    }
    matched.push({ entry, rank });
  }
  // Сортировка устойчивая: при равном месте — порядок каталога.
  if (needle) matched.sort((a, b) => a.rank - b.rank);
  return matched.map(({ entry }) => entry);
}

export type EntryPage = {
  total: number;
  offset: number;
  entries: TranslationEntry[];
  /** Сколько строк всего раздела (поиска) ждут автоперевода — не только этой страницы. */
  candidates: Record<AutoLocale, number>;
};

/** Страница строк по `offset`/`limit` (по умолчанию 100). */
export async function listEntries(query: EntryQuery): Promise<EntryPage | null> {
  const matched = await scanEntries(query);
  if (!matched) return null;
  const { categoryOf } = await getBaseCatalogs();
  const limit = Math.min(200, Math.max(1, query.limit ?? TRANSLATION_PAGE_SIZE));
  const offset = Math.max(0, query.offset ?? 0);
  return {
    total: matched.length,
    offset,
    entries: matched.slice(offset, offset + limit).map((entry) => finishEntry(entry, categoryOf)),
    candidates: {
      en: matched.filter((entry) => isAutoCandidate(entry, "en")).length,
      uz: matched.filter((entry) => isAutoCandidate(entry, "uz")).length,
    },
  };
}

/** Все ключи раздела (поиска), которые ждут автоперевода на `locale`, — для перевода пачками. */
export async function listCandidateKeys(query: EntryQuery, locale: AutoLocale): Promise<string[] | null> {
  const matched = await scanEntries(query);
  return matched ? matched.filter((entry) => isAutoCandidate(entry, locale)).map((entry) => entry.key) : null;
}

/**
 * История правок строки по всем языкам — из AuditLog (`translation.update`,
 * `translation.reset`), новые сверху. Правки переводов общие для всей
 * платформы, поэтому история не режется по организации; читать её могут
 * только ROOT и переводчики (проверка — в API).
 */
export async function listTranslationHistory(key: string, limit = 50): Promise<TranslationHistoryItem[]> {
  const rows = await db.auditLog.findMany({
    where: { entity: "translation", entityId: { in: LOCALES.map((locale) => `${locale}:${key}`) } },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: { id: true, action: true, details: true, userName: true, createdAt: true },
  });
  return historyItemsFromAudit(rows);
}

export async function getEntries(keys: string[]): Promise<TranslationEntry[]> {
  const { flat, categoryOf } = await getBaseCatalogs();
  const overrides = await overrideMap(keys);
  return keys.filter((key) => flat.ru[key] !== undefined).map((key) => finishEntry(toEntry(key, flat, overrides.get(key)), categoryOf));
}

export type SaveResult = { ok: true; entry: TranslationEntry } | Extract<OverrideValidation, { ok: false }>;

export async function saveOverride(actor: TranslationActor, input: { key: string; locale: string; value: string | null }): Promise<SaveResult> {
  const { flat } = await getBaseCatalogs();
  const verdict = validateOverride(input, flat);
  if (!verdict.ok) return verdict;
  const locale = input.locale as Locale;
  const previous = await db.translationOverride.findUnique({
    where: { locale_key: { locale, key: input.key } },
    select: { value: true },
  });
  const before = previous?.value ?? flat[locale][input.key];
  // Снимок русского исходника: по нему видно, что строка устарела после его правки.
  let sourceRu = flat.ru[input.key];
  if (locale !== "ru") {
    const russianOverride = await db.translationOverride.findUnique({ where: { locale_key: { locale: "ru", key: input.key } }, select: { value: true } });
    sourceRu = russianOverride?.value ?? sourceRu;
  }
  const after = verdict.action === "set" ? verdict.value : flat[locale][input.key];
  if (verdict.action === "set") {
    await db.translationOverride.upsert({
      where: { locale_key: { locale, key: input.key } },
      update: { value: verdict.value, sourceRu, updatedById: actor.id },
      create: { locale, key: input.key, value: verdict.value, sourceRu, updatedById: actor.id },
    });
  } else if (previous) {
    // deleteMany: параллельный сброс той же строки не превращается в 500.
    await db.translationOverride.deleteMany({ where: { locale, key: input.key } });
  }
  invalidateTranslationOverrides();
  if (before !== after) {
    await db.auditLog
      .create({
        data: {
          organizationId: actor.organizationId,
          userId: actor.id,
          userName: actor.name,
          action: verdict.action === "set" ? "translation.update" : "translation.reset",
          entity: "translation",
          entityId: `${locale}:${input.key}`,
          details: { locale, key: input.key, before, after },
        },
      })
      .catch((error) => console.error("[translations] audit failed", error));
  }
  const [entry] = await getEntries([input.key]);
  return { ok: true, entry };
}
