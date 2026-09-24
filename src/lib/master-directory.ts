import * as XLSX from "xlsx";

import { db } from "@/lib/db";
import { resolveDishPoolOrgIds } from "@/lib/dish-pool";
import { parseOrgKind, type OrgKind } from "@/lib/master-directory-access";

/**
 * Мастер-кабинет справочников (2026-09-24).
 *
 * Отдельная организация `kind="directory"` в пуле служебного кода
 * (`dish-pool.ts`): сотрудник бэк-офиса один раз загружает меню (для
 * бракеража готовой продукции) и сырьё (для скоропорта), а все пищеблоки
 * пула получают эти списки в свои журналы (`master-directory-push.ts`),
 * подсказки и справочник организации.
 *
 * Здесь — чтение/замена списков, сравнение и разбор загруженного файла
 * или вставленного текста.
 */

export type SharedKind = "dish" | "product";
export type SharedItem = { name: string; supplier: string | null; manufacturer: string | null };

export const MASTER_ORG_KIND = "directory";
export const REGULAR_ORG_KIND = "regular";
/** Для фоновых задач: мастер-кабинет не ведёт журналы и не получает рассылок. */
export const NOT_DIRECTORY_ORG_WHERE = { kind: { not: "directory" } } as const;

export const SHARED_ITEMS_MAX = 5000;
export const SHARED_KINDS: readonly SharedKind[] = ["dish", "product"];

export function isSharedKind(value: unknown): value is SharedKind {
  return value === "dish" || value === "product";
}

/* ───────────────────────── pure helpers ───────────────────────── */

function cleanText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

function keyOf(value: string): string {
  return cleanText(value).toLowerCase();
}

/** trim, схлопнуть пробелы, убрать пустые, дедуп без регистра (первое вхождение), максимум 5000. */
export function normalizeSharedItems(raw: SharedItem[]): SharedItem[] {
  const seen = new Set<string>();
  const out: SharedItem[] = [];
  for (const entry of raw ?? []) {
    if (!entry || typeof entry !== "object") continue;
    const name = cleanText(entry.name).slice(0, 300);
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      name,
      supplier: cleanText(entry.supplier).slice(0, 300) || null,
      manufacturer: cleanText(entry.manufacturer).slice(0, 300) || null,
    });
    if (out.length >= SHARED_ITEMS_MAX) break;
  }
  return out;
}

/** Что добавится и что уйдёт при замене списка — без учёта регистра и крайних пробелов. */
export function diffSharedNames(
  current: string[],
  next: string[]
): { added: string[]; removed: string[]; unchanged: number } {
  const currentKeys = new Set(current.map(keyOf));
  const nextKeys = new Set(next.map(keyOf));
  const added: string[] = [];
  const addedKeys = new Set<string>();
  for (const name of next) {
    const key = keyOf(name);
    if (!key || currentKeys.has(key) || addedKeys.has(key)) continue;
    addedKeys.add(key);
    added.push(cleanText(name));
  }
  const removed: string[] = [];
  const removedKeys = new Set<string>();
  let unchanged = 0;
  const unchangedKeys = new Set<string>();
  for (const name of current) {
    const key = keyOf(name);
    if (!key) continue;
    if (nextKeys.has(key)) {
      if (!unchangedKeys.has(key)) {
        unchangedKeys.add(key);
        unchanged += 1;
      }
      continue;
    }
    if (removedKeys.has(key)) continue;
    removedKeys.add(key);
    removed.push(cleanText(name));
  }
  return { added, removed, unchanged };
}

/**
 * Вставленный текст: строка (или кусок между «;») = позиция;
 * «Название | Поставщик | Изготовитель» — поставщик и изготовитель по желанию.
 */
export function parseSharedItemsFromText(text: string): SharedItem[] {
  const pieces = String(text ?? "").split(/[\r\n;]+/);
  const items: SharedItem[] = [];
  for (const piece of pieces) {
    const [name, supplier, manufacturer] = piece.split("|").map(cleanText);
    if (!name) continue;
    items.push({ name, supplier: supplier || null, manufacturer: manufacturer || null });
  }
  return normalizeSharedItems(items);
}

type ColumnRole = "name" | "supplier" | "manufacturer" | "type" | "code";
type HeaderColumns = Partial<Record<ColumnRole, number>>;

/** Сколько строк сверху просматриваем в поисках шапки: у выгрузок iiko/1С над ней заголовок отчёта. */
const HEADER_SCAN_ROWS = 30;
/**
 * Заголовок колонки названий — строго: «Наименование», «Название товара», «Полное наименование».
 * Заголовок отчёта («Номенклатура. Выгрузка из iiko…», «Товары на складах») шапкой не считается.
 */
const NAME_LABEL =
  /^((полное|краткое|рабочее)\s+)?(наименование|название|блюдо|блюда|продукт|продукты|продукция|товар|товары|номенклатура|сырье|позиция|изделие|name|item)(\s+(блюда|блюд|товара|товаров|продукта|продуктов|продукции|позиции|номенклатуры|сырья|материала|изделия))?$/;
const TYPE_LABEL = /^((тип|вид)(\s+(номенклатуры|позиции|товара))?|type)$/;
const CODE_LABEL = /^(код|артикул|code|sku|id|№|номер)(\s+\S+)?$/;
/** Строка-группа в колонке «Тип» выгрузки iiko/1С. */
const GROUP_VALUE = /^(группа|папка|категория|раздел|group|folder|category)(\s+\S+)?$/;
/** Итоговая строка отчёта. */
const TOTAL_ROW = /^(итого|всего|total)(\s|:|$)/i;

function headerLabel(cell: unknown): string {
  return cleanText(cell)
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/^[\s*:.#]+|[\s*:.]+$/g, "");
}

/** Роли колонок строки-шапки. Поставщик/изготовитель проверяем первыми: «Наименование поставщика» — поставщик. */
function headerColumns(row: unknown[]): HeaderColumns {
  const columns: HeaderColumns = {};
  row.forEach((cell, index) => {
    const text = headerLabel(cell);
    if (!text || text.length > 40) return;
    let role: ColumnRole | null = null;
    if (/поставщик|supplier/.test(text)) role = "supplier";
    else if (/изготовител|производител|manufacturer/.test(text)) role = "manufacturer";
    else if (NAME_LABEL.test(text)) role = "name";
    else if (TYPE_LABEL.test(text)) role = "type";
    else if (CODE_LABEL.test(text)) role = "code";
    if (role && columns[role] === undefined) columns[role] = index;
  });
  return columns;
}

function hasLetter(text: string): boolean {
  return /\p{L}/u.test(text);
}

/** Файл без шапки: колонка, где больше всего ячеек с буквами (названия, а не коды). */
function pickNameColumn(rows: unknown[][]): number {
  const counts: number[] = [];
  for (const row of rows.slice(0, 200)) {
    (row ?? []).forEach((cell, index) => {
      if (hasLetter(cleanText(cell))) counts[index] = (counts[index] ?? 0) + 1;
    });
  }
  let best = 0;
  counts.forEach((count, index) => {
    if (count > (counts[best] ?? 0)) best = index;
  });
  return best;
}

/** CSV без BOM читаем как UTF-8, а если это не UTF-8 — как Windows-1251 (выгрузки из Excel). */
function decodeCsv(buf: Buffer): string {
  const utf8 = new TextDecoder("utf-8", { fatal: false }).decode(buf);
  const REPLACEMENT_CHAR = String.fromCharCode(0xfffd);
  const BOM = String.fromCharCode(0xfeff);
  if (!utf8.includes(REPLACEMENT_CHAR)) return utf8.startsWith(BOM) ? utf8.slice(1) : utf8;
  try {
    return new TextDecoder("windows-1251").decode(buf);
  } catch {
    return utf8;
  }
}

/**
 * Файл xlsx/xls/csv: первый лист. Колонка названия — по синонимам
 * заголовка; без заголовка — первая колонка, первая строка тоже позиция.
 */
export function parseSharedItemsFromSheet(buf: Buffer, filename: string): SharedItem[] {
  const isCsv = /\.(csv|txt)$/i.test(filename);
  const workbook = isCsv
    ? XLSX.read(decodeCsv(buf), { type: "string", raw: true })
    : XLSX.read(buf, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], {
    header: 1,
    raw: false,
    blankrows: false,
    defval: "",
  });
  if (!rows.some((row) => Array.isArray(row) && row.some((cell) => cleanText(cell) !== ""))) return [];

  // Шапка — первая строка сверху, где есть колонка названий; выше неё — заголовок отчёта.
  let headerIndex = -1;
  let columns: HeaderColumns = {};
  for (let index = 0; index < Math.min(rows.length, HEADER_SCAN_ROWS); index += 1) {
    const found = headerColumns(rows[index] ?? []);
    if (found.name !== undefined) {
      headerIndex = index;
      columns = found;
      break;
    }
  }
  const hasHeader = headerIndex >= 0;
  const dataRows = hasHeader ? rows.slice(headerIndex + 1) : rows;
  const nameCol = hasHeader ? (columns.name as number) : pickNameColumn(rows);

  // Выгрузка без «Тип»: у позиций есть артикул, у строк-групп — нет.
  const codeCol = columns.code;
  let skipCodeless = false;
  if (hasHeader && codeCol !== undefined && columns.type === undefined) {
    const named = dataRows.filter((row) => hasLetter(cleanText(row?.[nameCol])));
    const withCode = named.filter((row) => cleanText(row?.[codeCol]) !== "").length;
    skipCodeless = named.length > 0 && withCode / named.length >= 0.5;
  }

  const items: SharedItem[] = [];
  for (const row of dataRows) {
    const name = cleanText(row?.[nameCol]);
    if (!name || !hasLetter(name) || TOTAL_ROW.test(name)) continue;
    if (columns.type !== undefined && GROUP_VALUE.test(headerLabel(row?.[columns.type]))) continue;
    if (skipCodeless && codeCol !== undefined && cleanText(row?.[codeCol]) === "") continue;
    items.push({
      name,
      supplier: columns.supplier !== undefined ? cleanText(row?.[columns.supplier]) || null : null,
      manufacturer: columns.manufacturer !== undefined ? cleanText(row?.[columns.manufacturer]) || null : null,
    });
  }
  return normalizeSharedItems(items);
}

/* ───────────────────────── database ───────────────────────── */

/** Признак организации для токена сессии (`token.orgKind`). Нет организации — "regular". */
export async function readOrgKind(orgId: string | null | undefined): Promise<OrgKind> {
  if (!orgId) return "regular";
  const org = await db.organization.findUnique({ where: { id: orgId }, select: { kind: true } });
  return parseOrgKind(org?.kind);
}

/** Мастер-кабинет (`kind="directory"`) в пуле организации; сам мастер — тоже находит себя. */
export async function findPoolMasterOrgId(orgId: string): Promise<string | null> {
  const self = await db.organization.findUnique({
    where: { id: orgId },
    select: { kind: true, serviceCode: true, linkedServiceCode: true },
  });
  if (!self) return null;
  if (self.kind === MASTER_ORG_KIND) return orgId;
  // Без кода пула нет — не тратим второй запрос.
  if (!self.linkedServiceCode && !self.serviceCode) return null;
  const poolIds = await resolveDishPoolOrgIds(orgId);
  const others = poolIds.filter((id) => id !== orgId);
  if (others.length === 0) return null;
  const master = await db.organization.findFirst({
    where: { id: { in: others }, kind: MASTER_ORG_KIND },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  return master?.id ?? null;
}

export async function listSharedItems(masterOrgId: string, kind: SharedKind): Promise<SharedItem[]> {
  const rows = await db.sharedDirectoryItem.findMany({
    where: { organizationId: masterOrgId, kind },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: { name: true, supplier: true, manufacturer: true },
    take: SHARED_ITEMS_MAX,
  });
  return rows.map((row) => ({ name: row.name, supplier: row.supplier, manufacturer: row.manufacturer }));
}

/** Список мастера в пуле организации (пусто — мастера в пуле нет). */
export async function listPoolSharedItems(orgId: string, kind: SharedKind): Promise<SharedItem[]> {
  const masterOrgId = await findPoolMasterOrgId(orgId);
  if (!masterOrgId) return [];
  return listSharedItems(masterOrgId, kind);
}

/** Имена списка мастера в пуле организации (пусто — мастера в пуле нет). */
export async function listPoolSharedNames(orgId: string, kind: SharedKind): Promise<string[]> {
  return (await listPoolSharedItems(orgId, kind)).map((item) => item.name);
}

export async function replaceSharedItems(
  masterOrgId: string,
  kind: SharedKind,
  items: SharedItem[]
): Promise<{ total: number }> {
  const normalized = normalizeSharedItems(items);
  await db.$transaction(
    async (tx) => {
      await tx.sharedDirectoryItem.deleteMany({ where: { organizationId: masterOrgId, kind } });
      if (normalized.length > 0) {
        await tx.sharedDirectoryItem.createMany({
          data: normalized.map((item, index) => ({
            organizationId: masterOrgId,
            kind,
            name: item.name,
            supplier: item.supplier,
            manufacturer: item.manufacturer,
            sortOrder: index,
          })),
        });
      }
    },
    { timeout: 30_000 }
  );
  return { total: normalized.length };
}

/** Организации пула мастер-кабинета, кроме самого кабинета. */
export async function listPoolOrganizations(masterOrgId: string): Promise<Array<{ id: string; name: string }>> {
  const poolIds = await resolveDishPoolOrgIds(masterOrgId);
  const orgs = await db.organization.findMany({
    where: { id: { in: poolIds.filter((id) => id !== masterOrgId) }, ...NOT_DIRECTORY_ORG_WHERE },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  return orgs;
}
