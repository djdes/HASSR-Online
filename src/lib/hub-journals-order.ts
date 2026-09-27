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
