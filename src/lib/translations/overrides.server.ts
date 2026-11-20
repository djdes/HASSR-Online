import type { Locale } from "@/i18n/locales";
import { flattenMessages } from "@/i18n/catalog-validation";
import { loadBaseMessages } from "@/i18n/messages";
import {
  readPromoTranslationOverrides,
  schedulePromoDatasetRefresh,
} from "@/lib/promo-cache";
import { applyOverrides, selectSafeOverrides, type FlatCatalog } from "./catalog";

/**
 * Правки каталога переводов из файлового JSON-снапшота (`translation-overrides.json`).
 *
 * Вместо опроса PostgreSQL каждые 30 секунд на всех страницах сайта читаем
 * компактный атомарный JSON-снапшот с диска (0 SELECT к БД, 0 долгоживущего
 * кеша словарей в RAM). При сохранении правок в редакторе `/translations`
 * снапшот пересобирается сразу.
 */

let russianCatalog: Promise<FlatCatalog> | null = null;

function getRussianCatalog(): Promise<FlatCatalog> {
  russianCatalog ??= loadBaseMessages("ru").then((messages) => flattenMessages(messages));
  return russianCatalog;
}

export async function withTranslationOverrides<T extends object>(locale: Locale, base: T): Promise<T> {
  try {
    const rows = await readPromoTranslationOverrides();
    const localeRows = rows.filter((row) => row.locale === locale);
    if (localeRows.length === 0) return base;

    const russian = await getRussianCatalog();
    const pairs: [string, string][] = localeRows.map((row) => [row.key, row.value]);
    const safe = selectSafeOverrides(pairs, (key) => russian[key]);
    if (safe.length === 0) return base;

    return applyOverrides(base, safe);
  } catch (error) {
    console.error("[translations] override snapshot read failed", error);
    return base;
  }
}

/** После записи в редакторе: сразу обновляем JSON-снапшот на диске. */
export function invalidateTranslationOverrides(): void {
  schedulePromoDatasetRefresh("translation-overrides");
}
