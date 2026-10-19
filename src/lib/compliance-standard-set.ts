/**
 * «Готовность»: проверка «Журналы стандартного набора включены».
 *
 * Раньше обязательными считались все журналы каталога (45), и заведение,
 * честно ведущее нужное, получало «Включено 12 из 45 обязательных» и
 * провал. Обязательный минимум для любого общепита — 11 пунктов
 * стандартного набора из эскиза руководителя (`JOURNAL_SETS.standard`):
 * по ним и считаем. Модуль чистый — без БД, чтобы проверку можно было
 * покрыть тестом.
 */
import { ACTIVE_JOURNAL_CATALOG } from "@/lib/journal-catalog";
import { STANDARD_JOURNAL_CODES } from "@/lib/journal-sets";

const NAMES = new Map<string, string>(ACTIVE_JOURNAL_CATALOG.map((item) => [item.code, item.name]));

export type StandardSetCheck = {
  status: "ok" | "warn" | "fail";
  score: number;
  enabled: number;
  total: number;
  missing: string[];
  detail: string;
};

/** Сколько пунктов может не хватать, чтобы проверка была «внимание», а не «провал». */
const WARN_MISSING_MAX = 3;

export function standardSetCheck(disabledCodes: ReadonlySet<string>): StandardSetCheck {
  const total = STANDARD_JOURNAL_CODES.length;
  const missing = STANDARD_JOURNAL_CODES.filter((code) => disabledCodes.has(code));
  const enabled = total - missing.length;
  const status = missing.length === 0 ? "ok" : missing.length <= WARN_MISSING_MAX ? "warn" : "fail";
  const names = missing.map((code) => `«${NAMES.get(code) ?? code}»`);
  const detail =
    missing.length === 0
      ? `Включены все ${total} журналов стандартного набора.`
      : `Включено ${enabled} из ${total} журналов стандартного набора. Не включены: ${names.join(", ")}.`;
  return { status, score: total === 0 ? 1 : enabled / total, enabled, total, missing, detail };
}
