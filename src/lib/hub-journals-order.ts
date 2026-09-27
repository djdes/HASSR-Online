import { sortJournalsByName } from "@/lib/journal-sort";

/**
 * Порядок журналов на странице QR «Все журналы»: сначала журналы, которые
 * заполняют отсюда, по алфавиту; объектные (холодильники, склады, УФ-лампы
 * — их записывают по наклейке на объекте) — в конце, тоже по алфавиту.
 * Названия уже с учётом своих названий компании.
 */
export function orderHubJournals<T extends { name: string }>(fillable: readonly T[], objects: readonly T[]): T[] {
  return [...sortJournalsByName(fillable, (item) => item.name), ...sortJournalsByName(objects, (item) => item.name)];
}

export const HUB_ADMISSION_NAME = "Допуск сотрудников к смене";
export const HUB_ADMISSION_NOTE = "Для ответственного за смену — «Допущен» или «Отстранён» каждому";

/**
 * «Допуск сотрудников к смене» — и в хабе «Все журналы», рядом с журналами
 * (решение начальника 27.09.2026: без PIN сотрудника допуск всё равно не
 * поставить, отдельный плакат при этом остаётся). Пункт есть, только если
 * в хабе есть гигиена, и встаёт по алфавиту среди журналов, до объектных.
 */
export function withHubAdmission<T extends { code: string; name: string }>(
  items: readonly T[],
  isObject: (item: T) => boolean,
  admission: T,
): T[] {
  if (!items.some((item) => item.code === "hygiene" && !isObject(item))) return [...items];
  return orderHubJournals(
    [...items.filter((item) => !isObject(item)), admission],
    items.filter(isObject),
  );
}
