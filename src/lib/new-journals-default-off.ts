/**
 * Журналы, добавленные в каталог в сентябре 2026 (табличные реестры).
 *
 * У организаций, которые существовали до выката, они должны появиться
 * ВЫКЛЮЧЕННЫМИ: человек не просил шесть новых карточек на дашборде, а
 * у детсада внезапное «обязательно: суточные пробы 0/1» выглядело бы
 * как поломка. Включить можно в /settings/journals. Новые организации
 * получают их по правилам сферы (`defaultDisabledCodesFor`).
 *
 * Выключение делает one-shot сидер
 * `prisma/seed-disable-new-journals-2026-09.ts`. Модуль чистый — без БД.
 */

export const NEW_JOURNAL_CODES_2026_09 = [
  "daily_samples",
  "vitaminization",
  "ration_control",
  "transport_temperature",
  "tableware_breakage",
  "pool_water_control",
] as const;

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

/**
 * Дописывает новые коды в `disabledJournalCodes`. Порядок существующих
 * сохраняется, дубли не появляются; `changed=false`, если все коды уже
 * выключены — повторный прогон ничего не меняет.
 */
export function applyNewJournalsDefaultOff(disabledJournalCodes: unknown): {
  disabledJournalCodes: string[];
  added: string[];
  changed: boolean;
} {
  const current = toStringArray(disabledJournalCodes);
  const present = new Set(current);
  const added = NEW_JOURNAL_CODES_2026_09.filter((code) => !present.has(code));
  return {
    disabledJournalCodes: [...current, ...added],
    added,
    changed: added.length > 0,
  };
}
