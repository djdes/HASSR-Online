import { LOCALES, type Locale } from "@/i18n/locales";
import { MAX_SEARCH_LENGTH } from "./search";

/**
 * Вид редактора переводов: фильтры строк, кандидаты на автоперевод и
 * состояние в адресе страницы. Модуль чистый — его читают API и клиент.
 */

export const TRANSLATION_FILTERS = ["all", "modified", "untranslated", "stale"] as const;
export type TranslationFilter = (typeof TRANSLATION_FILTERS)[number];

type EntryState = { overridden: readonly Locale[]; untranslated: readonly Locale[]; stale: readonly Locale[] };

/** «Устарели» — есть правка, а русский исходник изменился после неё. */
export function matchesFilter(entry: EntryState, filter: TranslationFilter): boolean {
  if (filter === "modified") return entry.overridden.length > 0;
  if (filter === "untranslated") return entry.untranslated.length > 0;
  if (filter === "stale") return entry.stale.length > 0;
  return true;
}

/** Автоперевод пачкой берёт строки без перевода; ручную правку не трогает. */
export function isAutoCandidate(entry: EntryState, locale: Exclude<Locale, "ru">): boolean {
  return entry.untranslated.includes(locale) && !entry.overridden.includes(locale);
}

/** Раздел «Все строки» в адресе и в состоянии редактора. */
export const ALL_SECTIONS = "all";

export type TranslationView = {
  q: string;
  section: string;
  filter: TranslationFilter;
  /** Страница с нуля; в адресе — с единицы. */
  page: number;
  key: string | null;
};

type Params = URLSearchParams | Record<string, string | string[] | undefined>;

function param(params: Params, name: string): string {
  const value = params instanceof URLSearchParams ? params.get(name) : params[name];
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

/** Адрес → вид. Неизвестный раздел или мусор в числах — значения по умолчанию. */
export function parseTranslationView(params: Params, sections: { known: ReadonlySet<string>; fallback: string }): TranslationView {
  const section = param(params, "section");
  const filter = param(params, "filter") as TranslationFilter;
  const page = Number.parseInt(param(params, "page"), 10);
  const key = param(params, "key");
  return {
    q: param(params, "q").slice(0, MAX_SEARCH_LENGTH),
    section: section === ALL_SECTIONS || sections.known.has(section) ? section : sections.fallback,
    filter: (TRANSLATION_FILTERS as readonly string[]).includes(filter) ? filter : "all",
    page: Number.isFinite(page) && page > 1 ? page - 1 : 0,
    key: key && key.length <= 300 ? key : null,
  };
}

/** Вид → строка запроса. Значения по умолчанию в адрес не пишем. */
export function translationViewSearch(view: TranslationView, defaultSection: string): string {
  const params = new URLSearchParams();
  if (view.q) params.set("q", view.q);
  if (view.section !== defaultSection) params.set("section", view.section);
  if (view.filter !== "all") params.set("filter", view.filter);
  if (view.page > 0) params.set("page", String(view.page + 1));
  if (view.key) params.set("key", view.key);
  const search = params.toString();
  return search ? `?${search}` : "";
}

export type TranslationHistoryItem = {
  id: string;
  locale: Locale;
  /** Правка или сброс к тексту из файла. */
  action: "update" | "reset";
  before: string;
  after: string;
  userName: string | null;
  createdAt: string;
};

type AuditRow = { id: string; action: string; details: unknown; userName: string | null; createdAt: Date };

/** Записи AuditLog редактора → история строки. Битые записи пропускаем. */
export function historyItemsFromAudit(rows: readonly AuditRow[]): TranslationHistoryItem[] {
  const items: TranslationHistoryItem[] = [];
  for (const row of rows) {
    const details = row.details as { locale?: unknown; before?: unknown; after?: unknown } | null;
    const locale = details?.locale;
    if (typeof locale !== "string" || !(LOCALES as readonly string[]).includes(locale)) continue;
    if (typeof details?.before !== "string" || typeof details.after !== "string") continue;
    items.push({
      id: row.id,
      locale: locale as Locale,
      action: row.action === "translation.reset" ? "reset" : "update",
      before: details.before,
      after: details.after,
      userName: row.userName,
      createdAt: row.createdAt.toISOString(),
    });
  }
  return items;
}
