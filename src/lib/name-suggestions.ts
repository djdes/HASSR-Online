/**
 * Память наименований организации — client-safe константы и чистые
 * функции (без `@/lib/db`, см. memory `client-safe-lib-split`).
 */

import { cleanYield, normalizeMenuTime } from "@/lib/finished-product-bulk";

export const NAME_SUGGESTION_SCOPES = ["dish", "product", "partner"] as const;
export type NameSuggestionScope = (typeof NAME_SUGGESTION_SCOPES)[number];

export const NAME_SUGGESTION_MAX_LENGTH = 200;

/**
 * Сопутствующие значения по наименованию: `productTemp` — последний ввод
 * пищеблока; `portionWeight` (выход) и `productionTime` («HH:MM») —
 * из меню мастер-кабинета пула (своё значение пищеблока приоритетнее).
 */
export type NameSuggestionMeta = { productTemp?: string; portionWeight?: string; productionTime?: string };

export function normalizeSuggestionMeta(raw: unknown): NameSuggestionMeta | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const meta: NameSuggestionMeta = {};
  if (typeof record.productTemp === "string" && record.productTemp.trim() !== "") {
    meta.productTemp = record.productTemp.trim().slice(0, 20);
  }
  if (typeof record.portionWeight === "string") {
    const portion = cleanYield(record.portionWeight);
    if (portion) meta.portionWeight = portion;
  }
  const time = normalizeMenuTime(record.productionTime);
  if (time) meta.productionTime = time;
  return Object.keys(meta).length > 0 ? meta : null;
}

/**
 * Meta меню мастера под своей: поле пищеблока, если оно уже есть,
 * приоритетнее мастерского.
 */
export function mergeMasterMenuMeta(
  own: NameSuggestionMeta | null | undefined,
  menu: { portion?: string | null; time?: string | null }
): NameSuggestionMeta | null {
  const fromMenu = normalizeSuggestionMeta({ portionWeight: menu.portion ?? "", productionTime: menu.time ?? "" });
  if (!fromMenu) return own ?? null;
  return { ...fromMenu, ...(own ?? {}) };
}

/** Ключ для поиска meta по имени — без учёта регистра и лишних пробелов. */
export function suggestionKey(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}
export const NAME_SUGGESTION_LIMIT = 200;

export function isNameSuggestionScope(value: unknown): value is NameSuggestionScope {
  return typeof value === "string" && (NAME_SUGGESTION_SCOPES as readonly string[]).includes(value);
}

/** Обрезает, схлопывает пробелы, отбрасывает пустое и слишком длинное. */
export function normalizeSuggestionValue(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.replace(/\s+/g, " ").trim();
  if (!value || value.length > NAME_SUGGESTION_MAX_LENGTH) return null;
  return value;
}

/**
 * Список для выпадашки: недавние наименования организации первыми, затем
 * справочник документа; без повторов (регистр не учитывается).
 */
export function mergeSuggestions(
  recent: readonly string[],
  ...catalogs: readonly (readonly string[])[]
): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const list of [recent, ...catalogs]) {
    for (const item of list) {
      const value = normalizeSuggestionValue(item);
      if (!value) continue;
      const key = value.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(value);
    }
  }
  return result;
}

/** Локальное «запомнили»: переносит значения наверх, как сделает сервер. */
export function promoteSuggestions(recent: readonly string[], values: readonly string[]): string[] {
  const promoted = mergeSuggestions(values);
  return mergeSuggestions(promoted, recent);
}
