import { messageArguments } from "@/i18n/catalog-validation";
import { LOCALES, type Locale } from "@/i18n/locales";

/**
 * Правки каталога интерфейса поверх `src/i18n/messages/<locale>.json`
 * (редактор переводов, 2026-10-24). Модуль чистый: без БД и React —
 * его читают `loadMessages`, API редактора и тесты.
 */

export type FlatCatalog = Record<string, string>;

export const MAX_TRANSLATION_LENGTH = 10_000;

/** Строка с кириллицей в en/uz — почти всегда непереведённая. */
const CYRILLIC = /[А-Яа-яЁё]/;

export function readCatalogString(catalog: unknown, key: string): string | undefined {
  let node: unknown = catalog;
  for (const segment of key.split(".")) {
    if (!node || typeof node !== "object" || !Object.hasOwn(node, segment)) return undefined;
    node = (node as Record<string, unknown>)[segment];
  }
  return typeof node === "string" ? node : undefined;
}

/**
 * Каталог с правками. Без применимых правок — тот же объект (без
 * копирования 1,6 МБ на запрос). Ключ, которого в каталоге уже нет
 * (строку переименовали), пропускается.
 */
export function applyOverrides<T extends object>(base: T, overrides: Iterable<readonly [string, string]>): T {
  let copy: T | null = null;
  for (const [key, value] of overrides) {
    if (readCatalogString(base, key) === undefined) continue;
    copy ??= structuredClone(base);
    const path = key.split(".");
    let target = copy as Record<string, unknown>;
    for (const segment of path.slice(0, -1)) target = target[segment] as Record<string, unknown>;
    target[path[path.length - 1]] = value;
  }
  return copy ?? base;
}

export type OverrideValidation =
  | { ok: true; action: "set"; value: string }
  | { ok: true; action: "reset" }
  | { ok: false; error: "unknown_locale" | "unknown_key" | "too_long" | "corrupted" | "invalid_icu" | "argument_mismatch"; expected?: string[] };

/**
 * Правку можно сохранить, только если она не ломает подстановки: набор
 * аргументов ICU (`{name}`, plural/select, теги) — как у русского
 * исходника, тот же контракт, что проверяет `validateCatalog`.
 * Пустое значение или равное файлу — сброс правки.
 */
export function validateOverride(
  input: { locale: string; key: string; value: string | null },
  catalogs: { ru: FlatCatalog } & Partial<Record<Locale, FlatCatalog>>,
): OverrideValidation {
  if (!(LOCALES as readonly string[]).includes(input.locale)) return { ok: false, error: "unknown_locale" };
  const locale = input.locale as Locale;
  const reference = catalogs.ru[input.key];
  const original = catalogs[locale]?.[input.key];
  if (reference === undefined || original === undefined) return { ok: false, error: "unknown_key" };
  const value = input.value ?? "";
  if (!value.trim() || value === original) return { ok: true, action: "reset" };
  if (value.length > MAX_TRANSLATION_LENGTH) return { ok: false, error: "too_long" };
  if (/�/.test(value)) return { ok: false, error: "corrupted" };
  let actual: string[];
  try {
    actual = messageArguments(value);
  } catch {
    return { ok: false, error: "invalid_icu" };
  }
  const expected = messageArguments(reference);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    return { ok: false, error: "argument_mismatch", expected: expected.map((arg) => arg.split(":")[0]) };
  }
  return { ok: true, action: "set", value };
}

/** Перевод не сделан: совпадает с русским или пишет кириллицей. */
export function looksUntranslated(locale: Locale, value: string, russian: string): boolean {
  if (locale === "ru") return false;
  return value === russian || CYRILLIC.test(value);
}

/** Имена аргументов для подсказки под полем: `{count}`, `{name}`. */
export function placeholderNames(message: string): string[] {
  try {
    return [...new Set(messageArguments(message).map((arg) => arg.split(":")[0]))];
  } catch {
    return [];
  }
}

/**
 * Правка устарела, если русский исходник изменился после её сохранения.
 * Правка при этом продолжает действовать — ей только нужна повторная проверка.
 * Правки, сохранённые до появления снимка (`sourceRu == null`), не помечаем.
 */
export function isStaleOverride(sourceRu: string | null | undefined, currentRu: string): boolean {
  return sourceRu != null && sourceRu !== currentRu;
}

/**
 * Применяем только правки, чьи аргументы ICU совпадают с текущим русским
 * исходником: после смены исходника старая правка с другими подстановками
 * ломала бы страницу.
 */
export function selectSafeOverrides(
  overrides: Iterable<readonly [string, string]>,
  russian: (key: string) => string | undefined,
): [string, string][] {
  const safe: [string, string][] = [];
  for (const [key, value] of overrides) {
    const reference = russian(key);
    if (reference === undefined) continue;
    try {
      if (JSON.stringify(messageArguments(value)) !== JSON.stringify(messageArguments(reference))) continue;
    } catch {
      continue;
    }
    safe.push([key, value]);
  }
  return safe;
}
