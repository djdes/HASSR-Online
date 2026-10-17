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
 *
 * Вторая волна (`NEW_JOURNAL_CODES_2026_09B`: инвентарь, стерилизация
 * инструментов, отходы класса Б, допуск партии) выключается своим сидером
 * `prisma/seed-disable-new-journals-2026-09b.ts` со своим флагом: первый
 * сидер на проде уже отработал и повторно не запустится.
 */

export const NEW_JOURNAL_CODES_2026_09 = [
  "daily_samples",
  "vitaminization",
  "ration_control",
  "transport_temperature",
  "tableware_breakage",
  "pool_water_control",
] as const;

/** Вторая волна сентября 2026 — после сверки каталога с Service Inspector. */
export const NEW_JOURNAL_CODES_2026_09B = [
  "inventory_condition",
  "instrument_sterilization",
  "medical_waste_b",
  "batch_release",
] as const;

/**
 * Октябрь 2026: мониторинг ККТ вошёл в каталог (набор по ХАССП). Выключает
 * его не отдельный сидер — с 16.10.2026 одноразовые сидеры на деплое идут
 * только по явному флагу, — а сам `prisma/seed.ts`: при ПЕРВОЙ активации
 * шаблона (строки не было или `isActive=false`) он сначала дописывает код
 * в `disabledJournalCodes` всех существующих организаций и только потом
 * включает шаблон. Следующие прогоны видят шаблон активным и ничего не
 * делают — журнал, включённый человеком, больше не выключится.
 */
export const NEW_JOURNAL_CODES_2026_10 = ["ccp_monitoring"] as const;

/** Коды, которые сид выключает у существующих организаций при первой активации шаблона. */
export const DEFAULT_OFF_ON_FIRST_ACTIVATION: readonly string[] = [...NEW_JOURNAL_CODES_2026_10];

/**
 * Какие из `codes` этот прогон сида включает впервые: шаблона ещё нет или
 * он выключен. `existing` — строки `JournalTemplate` из базы.
 */
export function firstActivationCodes(
  codes: readonly string[],
  existing: ReadonlyArray<{ code: string; isActive: boolean }>,
): string[] {
  const active = new Set(existing.filter((row) => row.isActive).map((row) => row.code));
  return codes.filter((code) => DEFAULT_OFF_ON_FIRST_ACTIVATION.includes(code) && !active.has(code));
}

/**
 * Все коды, которые у существующих организаций выключили сидеры, а не
 * человек. Нужен анкете: список из одних таких кодов — «нетронутый».
 */
export const SEEDED_DEFAULT_OFF_CODES: readonly string[] = [
  ...NEW_JOURNAL_CODES_2026_09,
  ...NEW_JOURNAL_CODES_2026_09B,
  ...NEW_JOURNAL_CODES_2026_10,
];

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

/**
 * Дописывает новые коды в `disabledJournalCodes`. Порядок существующих
 * сохраняется, дубли не появляются; `changed=false`, если все коды уже
 * выключены — повторный прогон ничего не меняет.
 */
export function applyNewJournalsDefaultOff(
  disabledJournalCodes: unknown,
  codes: readonly string[] = NEW_JOURNAL_CODES_2026_09,
): {
  disabledJournalCodes: string[];
  added: string[];
  changed: boolean;
} {
  const current = toStringArray(disabledJournalCodes);
  const present = new Set(current);
  const added = codes.filter((code) => !present.has(code));
  return {
    disabledJournalCodes: [...current, ...added],
    added,
    changed: added.length > 0,
  };
}
