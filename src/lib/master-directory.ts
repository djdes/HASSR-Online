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

type ColumnRole = "name" | "supplier" | "manufacturer";

/** Роль колонки по заголовку. Поставщик/изготовитель проверяем первыми: «Наименование поставщика» — поставщик. */
function headerRole(cell: unknown): ColumnRole | null {
  const text = cleanText(cell).toLowerCase().replace(/ё/g, "е");
  if (!text) return null;
  if (/поставщик|supplier/.test(text)) return "supplier";
  if (/изготовител|производител|manufacturer/.test(text)) return "manufacturer";
  if (/наименование|название|блюдо|продукт|товар|номенклатур|сырье/.test(text) || text === "name") return "name";
  return null;
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
  const firstIndex = rows.findIndex((row) => Array.isArray(row) && row.some((cell) => cleanText(cell) !== ""));
  if (firstIndex < 0) return [];

  const header = rows[firstIndex] ?? [];
  const columns: Partial<Record<ColumnRole, number>> = {};
  header.forEach((cell, index) => {
    const role = headerRole(cell);
    if (role && columns[role] === undefined) columns[role] = index;
  });

  const hasHeader = columns.name !== undefined;
  const nameCol = columns.name ?? 0;
  const dataRows = hasHeader ? rows.slice(firstIndex + 1) : rows.slice(firstIndex);
  const items: SharedItem[] = dataRows.map((row) => ({
    name: cleanText(row?.[nameCol]),
    supplier: hasHeader && columns.supplier !== undefined ? cleanText(row?.[columns.supplier]) || null : null,
    manufacturer:
      hasHeader && columns.manufacturer !== undefined ? cleanText(row?.[columns.manufacturer]) || null : null,
  }));
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
