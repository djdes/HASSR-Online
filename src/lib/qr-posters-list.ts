import { journalMatchesQuery } from "@/lib/journal-search";
import { sortJournalsByName } from "@/lib/journal-sort";

/**
 * Порядок и поиск карточек страницы «QR-коды» — чистые функции, их
 * читают и сервер (`qr-posters-view.ts` раскладывает по порядку), и
 * клиент (поиск по странице).
 *
 * Порядок (2026-09-27, «давай везде по алфавиту»):
 *   • main (универсальные «Все журналы» / «Допуск», основные QR журнала) —
 *     первыми и в том порядке, в каком их собрал сервер;
 *   • extra (журналы общего экрана, дополнительные QR документов) — по
 *     алфавиту по видимому названию; документ, из которого открыли
 *     страницу, — первым. `sortName` держит пару гигиены (запись +
 *     допуск одного документа) рядом;
 *   • object (наклейки холодильников, помещений, ламп) — по названию,
 *     одинаковые — по месту (цех, точка). Ручного порядка у объектов нет
 *     (в справочниках его не задают), поэтому тоже алфавит.
 *
 * Поиск — тот же матчер, что у журналов (`journal-search.ts`): все слова
 * запроса в любом порядке, «ё» = «е».
 */

export type QrListEntry = {
  key: string;
  group: "main" | "extra" | "object";
  label: string;
  /** По чему сортировать, если не по `label`. */
  sortName?: string;
  /** Где объект: цех или точка — вторая ступень сортировки наклеек. */
  location?: string | null;
  highlighted?: boolean;
  /** Строки, по которым ищет поиск страницы. */
  search: Array<string | null | undefined>;
};

export function orderQrPosterItems<T extends QrListEntry>(items: readonly T[]): T[] {
  const main = items.filter((item) => item.group === "main");
  const extra = items.filter((item) => item.group === "extra");
  const objects = items.filter((item) => item.group === "object");
  const byName = sortJournalsByName(extra, (item) => item.sortName ?? item.label);
  // Сортировка устойчивая: сначала по месту, затем по названию — у
  // одинаковых названий остаётся порядок по месту.
  const objectsByPlace = sortJournalsByName(objects, (item) => item.location ?? "");
  return [
    ...main,
    ...byName.filter((item) => item.highlighted),
    ...byName.filter((item) => !item.highlighted),
    ...sortJournalsByName(objectsByPlace, (item) => item.label),
  ];
}

/** Карточки, подходящие под запрос; пустой запрос — все. */
export function filterQrPosterItems<T extends Pick<QrListEntry, "search">>(items: readonly T[], query: string): T[] {
  return items.filter((item) => journalMatchesQuery(item.search, query));
}

/** Подпись кнопки «Отметить все»: при поиске она действует на найденные. */
export function qrSelectAllLabel({ allSelected, searching }: { allSelected: boolean; searching: boolean }): string {
  if (searching) return allSelected ? "Снять найденные" : "Отметить найденные";
  return allSelected ? "Снять все" : "Отметить все";
}
