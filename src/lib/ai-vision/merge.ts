import { normalizeTypedTime } from "@/lib/finished-product-bulk";
import type { VisionMenuItem } from "@/lib/ai-vision/shared";

/**
 * Куда кладутся распознанные строки — чистые функции для хозяев кнопки
 * «С фото»: таблица «Наименование | Выход | Время» (БЖГП «списком»,
 * «Добавить в журналы на дату», меню мастер-кабинета).
 *
 * Правило одно: сначала заполняются пустые строки таблицы, потом строки
 * дописываются в конец (не больше предела таблицы); то, что уже есть в
 * таблице (то же наименование, а в таблицах со временем — и то же время),
 * второй раз не добавляется — повторное распознавание того же фото не
 * задваивает список.
 */

type MenuLikeRow = { name: string; yield: string; time: string };

function key(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function isBlankRow(row: MenuLikeRow): boolean {
  return row.name.trim() === "" && row.yield.trim() === "" && row.time.trim() === "";
}

export type MergeSummary = {
  /** Сколько строк легло в таблицу. */
  added: number;
  /** Уже были в таблице — пропущены. */
  skipped: number;
  /** Не влезли в предел таблицы. */
  overflow: number;
};

export function mergeMenuItemsIntoRows<T extends MenuLikeRow>(
  rows: T[],
  items: VisionMenuItem[],
  options: { maxRows: number; withYield: boolean; withTime: boolean; make: (values: MenuLikeRow) => T }
): { rows: T[] } & MergeSummary {
  const { maxRows, withYield, withTime, make } = options;
  const rowKey = (name: string, time: string) => `${key(name)}|${withTime ? normalizeTypedTime(time) : ""}`;
  const seen = new Set(rows.filter((row) => row.name.trim() !== "").map((row) => rowKey(row.name, row.time)));
  const next = rows.slice();
  let added = 0;
  let skipped = 0;
  let overflow = 0;
  let cursor = 0;
  for (const item of items) {
    const name = item.name.replace(/\s+/g, " ").trim();
    if (!name) continue;
    const values: MenuLikeRow = {
      name,
      yield: withYield ? item.yield : "",
      time: withTime ? normalizeTypedTime(item.time) : "",
    };
    const itemKey = rowKey(values.name, values.time);
    if (seen.has(itemKey)) {
      skipped += 1;
      continue;
    }
    while (cursor < next.length && !isBlankRow(next[cursor])) cursor += 1;
    if (cursor < next.length) {
      next[cursor] = { ...next[cursor], ...make(values) };
    } else if (next.length < maxRows) {
      next.push(make(values));
      cursor = next.length;
    } else {
      overflow += 1;
      continue;
    }
    seen.add(itemKey);
    added += 1;
  }
  return { rows: next, added, skipped, overflow };
}
