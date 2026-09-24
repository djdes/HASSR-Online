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

/** Выход как ввели: без лишних пробелов, не длиннее 20 символов. */
export function cleanYield(value: string): string {
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
export function applyPaste<T extends DishYieldRow = DishYieldRow>(
  rows: T[],
  startIndex: number,
  parsed: DishYieldPaste
): T[] {
  const next: T[] = rows.map((row) => ({ ...row }));
  const start = Math.max(0, Math.min(startIndex, FINISHED_PRODUCT_BULK_MAX - 1));
  parsed.rows.forEach((item, offset) => {
    const index = start + offset;
    if (index >= FINISHED_PRODUCT_BULK_MAX) return;
    while (next.length <= index) next.push({ name: "", yield: "" } as T);
    if (parsed.kind === "pairs") next[index] = { ...next[index], name: item.name, yield: item.yield };
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

/* ─────────── Меню мастер-кабинета: «Наименование | Выход | Время» ─────────── */

/**
 * Время изготовления по меню: «8:0», «08.00», «8-30», «8:30:00», «8ч30» →
 * «08:00» / «08:30». Всё остальное (мусор, 25:00) — пустая строка.
 */
export function normalizeMenuTime(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = collapse(String(value)).toLowerCase();
  const match = /^(\d{1,2})\s*(?::|\.|-|ч)\s*(\d{1,2})(?:\s*(?::|\.)\s*\d{1,2})?\s*(?:мин)?$/.exec(text);
  if (!match) return "";
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return "";
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/** Ячейка точно время: с двоеточием («8:30», «08:30:00»). */
function isStrictTime(value: string): boolean {
  return /^\d{1,2}:\d{2}(?::\d{2})?$/.test(value) && normalizeMenuTime(value) !== "";
}

/** Ячейка может быть временем: «8:30», «08.00», «8-30». */
function isLooseTime(value: string): boolean {
  return /^\d{1,2}[:.-]\d{2}(?::\d{2})?$/.test(value) && normalizeMenuTime(value) !== "";
}

export type MenuRow = { name: string; yield: string; time: string };
export type MenuColumn = "name" | "yield" | "time";
/** columns — какие столбцы есть во вставке: только они и заполняются. */
export type MenuPaste = { rows: MenuRow[]; columns: MenuColumn[] };

export function emptyMenuRows(count: number): MenuRow[] {
  return Array.from({ length: count }, () => ({ name: "", yield: "", time: "" }));
}

const MENU_NAME_HEADER = /^(?:наимен|назван|блюд|издел|продук|позиц)/i;
const MENU_YIELD_HEADER = /^(?:выход|вес)/i;
const MENU_TIME_HEADER = /^время/i;

function menuHeaderRole(cell: string): MenuColumn | null {
  if (MENU_TIME_HEADER.test(cell)) return "time";
  if (MENU_YIELD_HEADER.test(cell)) return "yield";
  if (MENU_NAME_HEADER.test(cell)) return "name";
  return null;
}

/** Столбец «1, 2, 3…» — нумерация строк, а не выход. */
function isNumberingColumn(values: string[]): boolean {
  const filled = values.filter((value) => value !== "");
  if (filled.length < 2) return false;
  const start = parseInt(filled[0], 10);
  return filled.every((value, index) => /^\d{1,4}[.)]?$/.test(value) && parseInt(value, 10) === start + index);
}

function menuCells(cells: string[], at: Partial<Record<MenuColumn, number>>): MenuRow {
  return {
    name: at.name !== undefined ? cleanName(cells[at.name] ?? "") : "",
    yield: at.yield !== undefined ? cleanYield(cells[at.yield] ?? "") : "",
    time: at.time !== undefined ? normalizeMenuTime(cells[at.time] ?? "") : "",
  };
}

/**
 * Вставка из Excel / текста в таблицу меню: один, два или три столбца в
 * любом порядке, с шапкой или без, с нумерацией. Шапка («Наименование»,
 * «Выход», «Время») задаёт столбцы; без неё — по виду ячеек: время — с
 * двоеточием, выход — числа/«200/10»/«1 шт.», наименование — текст.
 */
export function parseMenuPaste(text: string, maxRows: number): MenuPaste {
  const source = String(text ?? "");
  const lines = source.split(/\r?\n/);
  while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();
  while (lines.length > 0 && lines[0].trim() === "") lines.shift();
  if (lines.length === 0) return { rows: [], columns: ["name"] };

  const delimiter = source.includes("\t") ? "\t" : source.includes(";") ? ";" : source.includes("|") ? "|" : null;
  let table = lines.map((line) => (delimiter ? line.split(delimiter) : [line]).map((cell) => collapse(cell)));
  const width = table.reduce((max, cells) => Math.max(max, cells.length), 0);

  // Шапка: в первой строке есть подпись столбца и нет значений выхода/времени.
  const first = table[0];
  const headerRoles = first.map((cell) => menuHeaderRole(cell));
  const looksLikeHeader =
    (width > 1 ? headerRoles.some(Boolean) : SINGLE_HEADER_RE.test(first[0] ?? "")) &&
    !first.some((cell) => isYieldValue(cell) || isLooseTime(cell));
  const assigned: Partial<Record<MenuColumn, number>> = {};
  if (looksLikeHeader) {
    table = table.slice(1);
    if (width > 1) {
      headerRoles.forEach((role, col) => {
        if (role && assigned[role] === undefined) assigned[role] = col;
      });
    }
  }
  table = table.slice(0, Math.max(0, maxRows));

  // Один столбец: время / выход / наименования — по виду ячеек.
  if (width <= 1) {
    const filled = table.map((cells) => cells[0] ?? "").filter((cell) => cell !== "");
    const all = (test: (cell: string) => boolean) => filled.length > 0 && filled.every(test);
    const only: MenuColumn = all(isStrictTime) ? "time" : all(isYieldValue) ? "yield" : "name";
    return { columns: [only], rows: table.map((cells) => menuCells(cells, { [only]: 0 })) };
  }

  const stats = Array.from({ length: width }, (_, col) => {
    const values = table.map((cells) => cells[col] ?? "");
    let filled = 0;
    let strict = 0;
    let loose = 0;
    let yields = 0;
    let texts = 0;
    for (const cell of values) {
      if (!cell) continue;
      filled += 1;
      if (isStrictTime(cell)) strict += 1;
      if (isLooseTime(cell)) loose += 1;
      if (isYieldValue(cell)) yields += 1;
      else if (/\p{L}/u.test(cell)) texts += 1;
    }
    return { col, filled, strict, loose, yields, texts, numbering: isNumberingColumn(values) };
  });
  const isTaken = (col: number) => Object.values(assigned).includes(col);

  // Время: большинство ячеек с двоеточием (правый столбец при равенстве).
  if (assigned.time === undefined) {
    for (const s of stats) {
      if (isTaken(s.col) || s.filled === 0) continue;
      if (s.strict / s.filled >= 0.5) assigned.time = s.col;
    }
  }
  // «08.00» без двоеточия похоже и на выход: из двух таких столбцов правый — время.
  const yieldLike = stats.filter(
    (s) => !isTaken(s.col) && s.filled > 0 && !s.numbering && s.yields / s.filled >= 0.5
  );
  if (assigned.time === undefined && yieldLike.length >= 2) {
    const last = yieldLike[yieldLike.length - 1];
    if (last.loose / last.filled >= 0.5) assigned.time = last.col;
  }
  // Выход: большинство «похожих на выход», не нумерация (правый при равенстве).
  if (assigned.yield === undefined) {
    let best = 0;
    for (const s of yieldLike) {
      if (isTaken(s.col)) continue;
      const ratio = s.yields / s.filled;
      if (ratio >= best) {
        best = ratio;
        assigned.yield = s.col;
      }
    }
  }
  if (assigned.name === undefined) {
    let nameCol: number | undefined;
    for (const s of stats) {
      if (isTaken(s.col) || s.texts === 0) continue;
      if (nameCol === undefined || s.texts > stats[nameCol].texts) nameCol = s.col;
    }
    if (nameCol !== undefined) assigned.name = nameCol;
  }

  const columns = (["name", "yield", "time"] as const).filter((role) => assigned[role] !== undefined);
  if (columns.length === 0) return { rows: [], columns: ["name"] };
  return { columns: [...columns], rows: table.map((cells) => menuCells(cells, assigned)) };
}

/**
 * Кладёт вставку в таблицу меню со строки startIndex: заполняются только
 * вставленные столбцы, остальные в строке остаются. Таблица удлиняется,
 * но не больше maxRows строк.
 */
export function applyMenuPaste(rows: MenuRow[], startIndex: number, parsed: MenuPaste, maxRows: number): MenuRow[] {
  const next = rows.map((row) => ({ ...row }));
  const start = Math.max(0, Math.min(startIndex, maxRows - 1));
  parsed.rows.forEach((item, offset) => {
    const index = start + offset;
    if (index >= maxRows) return;
    while (next.length <= index) next.push({ name: "", yield: "", time: "" });
    for (const column of parsed.columns) next[index][column] = item[column];
  });
  return next;
}

/** Строки таблицы меню, которые уйдут в список, — только с наименованием. */
export function menuRowsToSave(rows: MenuRow[]): MenuRow[] {
  return rows
    .map((row) => ({
      name: collapse(row.name).slice(0, NAME_MAX),
      yield: cleanYield(row.yield),
      time: normalizeMenuTime(row.time),
    }))
    .filter((row) => row.name !== "");
}
