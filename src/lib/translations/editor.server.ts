import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { flattenMessages } from "@/i18n/catalog-validation";
import { LOCALES, type Locale } from "@/i18n/locales";
import { loadBaseMessages } from "@/i18n/messages";
import { looksUntranslated, placeholderNames, validateOverride, type FlatCatalog, type OverrideValidation } from "./catalog";
import { buildCategories, type TranslationCategorySummary } from "./categories";
import { invalidateTranslationOverrides } from "./overrides.server";

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

type BaseCatalogs = { flat: Record<Locale, FlatCatalog>; keys: string[]; categories: TranslationCategorySummary[] };
let baseCatalogs: Promise<BaseCatalogs> | null = null;

export function getBaseCatalogs(): Promise<BaseCatalogs> {
  baseCatalogs ??= (async () => {
    const entries = await Promise.all(LOCALES.map(async (locale) => [locale, flattenMessages(await loadBaseMessages(locale))] as const));
    const flat = Object.fromEntries(entries) as Record<Locale, FlatCatalog>;
    const keys = Object.keys(flat.ru);
    return { flat, keys, categories: buildCategories(keys) };
  })();
  return baseCatalogs;
}

async function overrideMap(keys?: string[]): Promise<Map<string, Partial<Record<Locale, string>>>> {
  const rows = await db.translationOverride.findMany({
    where: keys ? { key: { in: keys } } : undefined,
    select: { locale: true, key: true, value: true },
  });
  const map = new Map<string, Partial<Record<Locale, string>>>();
  for (const row of rows) {
    if (!(LOCALES as readonly string[]).includes(row.locale)) continue;
    map.set(row.key, { ...map.get(row.key), [row.locale]: row.value });
  }
  return map;
}

export type TranslationEntry = {
  key: string;
  /** Значение, которое видит интерфейс (файл или правка). */
  values: Record<Locale, string>;
  /** Значение из файла каталога — для сброса и сравнения. */
  base: Record<Locale, string>;
  overridden: Locale[];
  untranslated: Locale[];
  placeholders: string[];
};

// Разбор ICU дорогой, а русский исходник не меняется до деплоя.
const placeholderCache = new Map<string, string[]>();

function placeholdersOf(key: string, russian: string): string[] {
  let names = placeholderCache.get(key);
  if (!names) {
    names = placeholderNames(russian);
    placeholderCache.set(key, names);
  }
  return names;
}

/** Без `placeholders`: их добавляет `withPlaceholders` для выдаваемой страницы. */
function toEntry(key: string, flat: Record<Locale, FlatCatalog>, overrides: Partial<Record<Locale, string>> | undefined): Omit<TranslationEntry, "placeholders"> {
  const base = Object.fromEntries(LOCALES.map((locale) => [locale, flat[locale][key] ?? ""])) as Record<Locale, string>;
  const values = Object.fromEntries(LOCALES.map((locale) => [locale, overrides?.[locale] ?? base[locale]])) as Record<Locale, string>;
  return {
    key,
    values,
    base,
    overridden: LOCALES.filter((locale) => overrides?.[locale] !== undefined),
    untranslated: LOCALES.filter((locale) => looksUntranslated(locale, values[locale], values.ru)),
  };
}

function withPlaceholders(entry: Omit<TranslationEntry, "placeholders">): TranslationEntry {
  return { ...entry, placeholders: placeholdersOf(entry.key, entry.base.ru) };
}

export type CategoryStats = { id: string; group: TranslationCategorySummary["group"]; namespace?: string; total: number; modified: number; untranslated: number };

export async function listCategoryStats(): Promise<CategoryStats[]> {
  const { flat, categories } = await getBaseCatalogs();
  const overrides = await overrideMap();
  return categories.map((category) => {
    let modified = 0;
    let untranslated = 0;
    for (const key of category.keys) {
      const entry = toEntry(key, flat, overrides.get(key));
      if (entry.overridden.length) modified++;
      if (entry.untranslated.length) untranslated++;
    }
    return { id: category.id, group: category.group, namespace: category.namespace, total: category.keys.length, modified, untranslated };
  });
}

export type EntryQuery = { category?: string; q?: string; filter?: "all" | "modified" | "untranslated"; offset?: number; limit?: number };

export async function listEntries(query: EntryQuery): Promise<{ total: number; entries: TranslationEntry[] } | null> {
  const { flat, keys, categories } = await getBaseCatalogs();
  let scope = keys;
  if (query.category) {
    const category = categories.find((item) => item.id === query.category);
    if (!category) return null;
    scope = category.keys;
  }
  const needle = query.q?.trim().toLocaleLowerCase("ru");
  const filter = query.filter ?? "all";
  // Правок — сотни, не тысячи: читаем все одним запросом.
  const overrides = await overrideMap();
  const matched: Omit<TranslationEntry, "placeholders">[] = [];
  for (const key of scope) {
    const entry = toEntry(key, flat, overrides.get(key));
    if (filter === "modified" && !entry.overridden.length) continue;
    if (filter === "untranslated" && !entry.untranslated.length) continue;
    if (needle && !key.toLocaleLowerCase("ru").includes(needle) && !LOCALES.some((locale) => entry.values[locale].toLocaleLowerCase("ru").includes(needle))) continue;
    matched.push(entry);
  }
  const offset = Math.max(0, query.offset ?? 0);
  const limit = Math.min(200, Math.max(1, query.limit ?? 100));
  return { total: matched.length, entries: matched.slice(offset, offset + limit).map(withPlaceholders) };
}

export async function getEntries(keys: string[]): Promise<TranslationEntry[]> {
  const { flat } = await getBaseCatalogs();
  const overrides = await overrideMap(keys);
  return keys.filter((key) => flat.ru[key] !== undefined).map((key) => withPlaceholders(toEntry(key, flat, overrides.get(key))));
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
  const after = verdict.action === "set" ? verdict.value : flat[locale][input.key];
  if (verdict.action === "set") {
    await db.translationOverride.upsert({
      where: { locale_key: { locale, key: input.key } },
      update: { value: verdict.value, updatedById: actor.id },
      create: { locale, key: input.key, value: verdict.value, updatedById: actor.id },
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
