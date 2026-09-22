/**
 * «Добавить изделия списком» в бракераже готовой продукции: разбор вставки
 * из Excel / текста в таблицу «Наименование | Выход». Чистые функции —
 * окно только хранит строки и вызывает их.
 */

export const FINISHED_PRODUCT_BULK_MAX = 50;
const NAME_MAX = 200;
const YIELD_MAX = 20;

export type DishYieldRow = { name: string; yield: string };

/**
 * pairs — вставили два столбца (заполняем оба);
 * names / yields — один столбец (заполняем только его).
 */
export type DishYieldPasteKind = "pairs" | "names" | "yields";

export type DishYieldPaste = { rows: DishYieldRow[]; kind: DishYieldPasteKind };

// «150», «150 г», «200/10», «250/10/5», «0,5», «1 шт.», «200 мл».
const YIELD_RE =
  /^\d+(?:[.,]\d+)?\s*(?:г|гр|мл|шт\.?)?(?:\s*\/\s*\d+(?:[.,]\d+)?\s*(?:г|гр|мл)?)*$/i;
const HEADER_RE = /^(?:наимен|назван|блюд|издел|продук|выход|вес)/i;
// Один столбец: «Блюдо дня» — это блюдо, а не заголовок.
const SINGLE_HEADER_RE = /^(?:наименование|название)/i;
const NUMBERING_RE = /^\s*(?:\d{1,3}[.)](?!\d)|[-–—•*])\s*/;

function collapse(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function isYieldValue(value: string): boolean {
  const v = collapse(value);
  return v !== "" && YIELD_RE.test(v);
}

function cleanName(value: string): string {
  return collapse(value.replace(NUMBERING_RE, "")).slice(0, NAME_MAX);
}

function cleanYield(value: string): string {
  return collapse(value).slice(0, YIELD_MAX);
}

export function emptyDishYieldRows(count: number): DishYieldRow[] {
  return Array.from({ length: count }, () => ({ name: "", yield: "" }));
}

/** Текст из буфера похож на блок (несколько строк или ячеек)? */
export function isMultiCellPaste(text: string): boolean {
  return /[\t\n]/.test(text.replace(/\r?\n$/, ""));
}

export function parseDishYieldPaste(text: string): DishYieldPaste {
  const lines = text.split(/\r?\n/);
  // Excel добавляет перевод строки в конце — пустые края отбрасываем,
  // пустые строки в середине оставляем, чтобы не сбить выравнивание.
  while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();
  while (lines.length > 0 && lines[0].trim() === "") lines.shift();
  if (lines.length === 0) return { rows: [], kind: "names" };

  const delimiter = text.includes("\t") ? "\t" : text.includes(";") ? ";" : text.includes("|") ? "|" : null;
  let table = lines.map((line) => (delimiter ? line.split(delimiter) : [line]).map((cell) => collapse(cell)));

  const first = table[0];
  const headerRe = first.length > 1 ? HEADER_RE : SINGLE_HEADER_RE;
  if (first.some((cell) => headerRe.test(cell)) && !first.some((cell) => isYieldValue(cell))) {
    table = table.slice(1);
  }
  table = table.slice(0, FINISHED_PRODUCT_BULK_MAX);

  const width = table.reduce((max, cells) => Math.max(max, cells.length), 0);
  const stats = Array.from({ length: width }, (_, col) => {
    let filled = 0;
    let yields = 0;
    for (const cells of table) {
      const cell = cells[col] ?? "";
      if (!cell) continue;
      filled += 1;
      if (isYieldValue(cell)) yields += 1;
    }
    return { col, filled, yields, texts: filled - yields };
  });

  if (width <= 1) {
    const allYields = stats[0] && stats[0].filled > 0 && stats[0].yields === stats[0].filled;
    return allYields
      ? { kind: "yields", rows: table.map((cells) => ({ name: "", yield: cleanYield(cells[0] ?? "") })) }
      : { kind: "names", rows: table.map((cells) => ({ name: cleanName(cells[0] ?? ""), yield: "" })) };
  }

  // Столбец выхода — где больше всего «похожих на выход» ячеек; при равенстве
  // правый (слева обычно стоит номер строки).
  let yieldCol = -1;
  let bestRatio = 0;
  for (const s of stats) {
    if (s.filled === 0) continue;
    const ratio = s.yields / s.filled;
    if (ratio >= 0.5 && ratio >= bestRatio) {
      bestRatio = ratio;
      yieldCol = s.col;
    }
  }
  let nameCol = -1;
  for (const s of stats) {
    if (s.col === yieldCol || s.texts === 0) continue;
    if (nameCol === -1 || s.texts > stats[nameCol].texts) nameCol = s.col;
  }

  if (nameCol === -1) {
    return {
      kind: "yields",
      rows: table.map((cells) => ({ name: "", yield: yieldCol >= 0 ? cleanYield(cells[yieldCol] ?? "") : "" })),
    };
  }
  if (yieldCol === -1) {
    return { kind: "names", rows: table.map((cells) => ({ name: cleanName(cells[nameCol] ?? ""), yield: "" })) };
  }
  return {
    kind: "pairs",
    rows: table.map((cells) => ({
      name: cleanName(cells[nameCol] ?? ""),
      yield: cleanYield(cells[yieldCol] ?? ""),
    })),
  };
}

/**
 * Кладёт разобранную вставку в таблицу окна начиная со строки startIndex.
 * Пары заполняют оба столбца; один столбец — только свой, соседний
 * столбец остаётся как был. Строки выше startIndex не трогаются, таблица
 * при необходимости удлиняется (но не больше 50 строк).
 */
export function applyPaste(rows: DishYieldRow[], startIndex: number, parsed: DishYieldPaste): DishYieldRow[] {
  const next = rows.map((row) => ({ ...row }));
  const start = Math.max(0, Math.min(startIndex, FINISHED_PRODUCT_BULK_MAX - 1));
  parsed.rows.forEach((item, offset) => {
    const index = start + offset;
    if (index >= FINISHED_PRODUCT_BULK_MAX) return;
    while (next.length <= index) next.push({ name: "", yield: "" });
    if (parsed.kind === "pairs") next[index] = { name: item.name, yield: item.yield };
    else if (parsed.kind === "names") next[index].name = item.name;
    else next[index].yield = item.yield;
  });
  return next;
}

/** Строки, которые реально станут записями журнала — только с наименованием. */
export function dishYieldRowsToAdd(rows: DishYieldRow[]): DishYieldRow[] {
  return rows
    .map((row) => ({ name: collapse(row.name).slice(0, NAME_MAX), yield: collapse(row.yield).slice(0, YIELD_MAX) }))
    .filter((row) => row.name !== "");
}
