import * as XLSX from "xlsx";

import { db } from "@/lib/db";
import { cleanYield, normalizeMenuTime } from "@/lib/finished-product-bulk";
import { resolveDishPoolOrgIds } from "@/lib/dish-pool";
import { journalPointsOf, wholeOrgPoints } from "@/lib/master-pool-points";
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
/**
 * Позиция списка. supplier/manufacturer — у сырья; portion (выход, как
 * ввели: «200», «200/10», «1 шт.») и time (время изготовления «HH:MM») — у меню.
 */
export type SharedItem = {
  name: string;
  supplier: string | null;
  manufacturer: string | null;
  portion?: string | null;
  time?: string | null;
};

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
    // Выход и время — только когда есть: у сырья их не бывает.
    const portion = cleanYield(cleanText(entry.portion));
    const time = normalizeMenuTime(entry.time);
    if (portion) out[out.length - 1].portion = portion;
    if (time) out[out.length - 1].time = time;
    if (out.length >= SHARED_ITEMS_MAX) break;
  }
  return out;
}

/**
 * Позиции списка по виду: у сырья выход и время не используются, у меню —
 * поставщик и изготовитель.
 */
export function sharedItemsForKind(kind: SharedKind, items: SharedItem[]): SharedItem[] {
  return normalizeSharedItems(items).map((item) =>
    kind === "dish"
      ? {
          name: item.name,
          supplier: null,
          manufacturer: null,
          ...(item.portion ? { portion: item.portion } : {}),
          ...(item.time ? { time: item.time } : {}),
        }
      : { name: item.name, supplier: item.supplier, manufacturer: item.manufacturer }
  );
}

export type SharedDiff = { added: string[]; removed: string[]; changed: string[]; unchanged: number };

/**
 * Различия списков для предпросмотра: добавится / уберётся / изменится
 * (та же позиция, другой выход или время — поля меню) / без изменений.
 */
export function diffSharedItems(current: SharedItem[], next: SharedItem[]): SharedDiff {
  const names = diffSharedNames(
    current.map((item) => item.name),
    next.map((item) => item.name)
  );
  const before = new Map<string, SharedItem>();
  for (const item of current) {
    const key = keyOf(item.name);
    if (key && !before.has(key)) before.set(key, item);
  }
  const changed: string[] = [];
  const seen = new Set<string>();
  for (const item of next) {
    const key = keyOf(item.name);
    const old = before.get(key);
    if (!key || !old || seen.has(key)) continue;
    seen.add(key);
    if ((old.portion ?? "") !== (item.portion ?? "") || (old.time ?? "") !== (item.time ?? "")) {
      changed.push(cleanText(item.name));
    }
  }
  return { added: names.added, removed: names.removed, changed, unchanged: names.unchanged - changed.length };
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
 * сырьё — «Название | Поставщик | Изготовитель», меню (kind="dish") —
 * «Название | Выход | Время»; всё после названия по желанию.
 */
export function parseSharedItemsFromText(text: string, kind: SharedKind = "product"): SharedItem[] {
  const pieces = String(text ?? "").split(/[\r\n;]+/);
  const items: SharedItem[] = [];
  for (const piece of pieces) {
    const [name, second, third] = piece.split("|").map(cleanText);
    if (!name) continue;
    // Меню — «Название | Выход | Время», сырьё — «Название | Поставщик | Изготовитель».
    items.push(
      kind === "dish"
        ? { name, supplier: null, manufacturer: null, portion: second || null, time: third || null }
        : { name, supplier: second || null, manufacturer: third || null }
    );
  }
  return normalizeSharedItems(items);
}

type ColumnRole = "name" | "supplier" | "manufacturer" | "type" | "code" | "portion" | "time";
type HeaderColumns = Partial<Record<ColumnRole, number>>;

/** Сколько строк сверху просматриваем в поисках шапки: у выгрузок iiko/1С над ней заголовок отчёта. */
const HEADER_SCAN_ROWS = 30;
/**
 * Заголовок колонки названий — строго: «Наименование», «Название товара», «Полное наименование».
 * Заголовок отчёта («Номенклатура. Выгрузка из iiko…», «Товары на складах») шапкой не считается.
 */
const NAME_LABEL =
  /^((полное|краткое|рабочее)\s+)?(наименование|название|блюдо|блюда|продукт|продукты|продукция|товар|товары|номенклатура|сырье|позиция|изделие|name|item)(\s+(блюда|блюд|товара|товаров|продукта|продуктов|продукции|позиции|номенклатуры|сырья|материала|изделия))?$/;
/** Выход меню: «Выход», «Вес», «Выход, г», «Вес порции», «Выход (г)». */
const PORTION_LABEL =
  /^(выход|вес)(\s+(порции|блюда|изделия|готового\s+блюда))?(\s*[,(]?\s*(г|гр|грамм|граммы|мл)\s*\)?)?$/;
/** Время меню: «Время», «Время изготовления», «Время выдачи». */
const TIME_LABEL = /^время(\s+(изготовления|выдачи|приготовления|производства))?$/;
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
    else if (PORTION_LABEL.test(text)) role = "portion";
    else if (TIME_LABEL.test(text)) role = "time";
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
      portion: columns.portion !== undefined ? cleanText(row?.[columns.portion]) || null : null,
      time: columns.time !== undefined ? normalizeMenuTime(row?.[columns.time]) || null : null,
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

/** Мастер-кабинет пула с кодом `code` (самый ранний, если их несколько). */
async function findMasterByPoolCode(code: string): Promise<string | null> {
  const master = await db.organization.findFirst({
    where: {
      kind: MASTER_ORG_KIND,
      OR: [{ linkedServiceCode: code }, { serviceCode: code, linkedServiceCode: null }],
    },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  return master?.id ?? null;
}

/**
 * Мастер-кабинет (`kind="directory"`) в пуле организации; сам мастер — тоже
 * находит себя. С точкой, подключённой к пулу (`Building.linkedServiceCode`,
 * слитая организация), — мастер пула точки.
 */
export async function findPoolMasterOrgId(orgId: string, buildingId?: string | null): Promise<string | null> {
  if (buildingId) {
    const building = await db.building.findFirst({
      where: { id: buildingId, organizationId: orgId },
      select: { linkedServiceCode: true },
    });
    if (building?.linkedServiceCode) return findMasterByPoolCode(building.linkedServiceCode);
  }
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

/**
 * Все мастер-кабинеты организации: её пула и пулов её точек. Для подсказок
 * и справочника организации, где точка не выбрана, — списки объединяются.
 */
async function findPoolMasterOrgIds(orgId: string): Promise<string[]> {
  const [own, buildings] = await Promise.all([
    findPoolMasterOrgId(orgId),
    db.building.findMany({
      where: { organizationId: orgId, linkedServiceCode: { not: null } },
      select: { linkedServiceCode: true },
      distinct: ["linkedServiceCode"],
    }),
  ]);
  const ids = own ? [own] : [];
  for (const building of buildings) {
    const master = building.linkedServiceCode ? await findMasterByPoolCode(building.linkedServiceCode) : null;
    if (master && !ids.includes(master)) ids.push(master);
  }
  return ids;
}

export async function listSharedItems(masterOrgId: string, kind: SharedKind): Promise<SharedItem[]> {
  const rows = await db.sharedDirectoryItem.findMany({
    where: { organizationId: masterOrgId, kind },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: { name: true, supplier: true, manufacturer: true, portion: true, time: true },
    take: SHARED_ITEMS_MAX,
  });
  return rows.map((row) => ({
    name: row.name,
    supplier: row.supplier,
    manufacturer: row.manufacturer,
    portion: row.portion,
    time: row.time,
  }));
}

/**
 * Список мастера в пуле организации (пусто — мастера в пуле нет). Без
 * точки у организации, чьи точки в разных пулах, — списки всех её мастеров.
 */
export async function listPoolSharedItems(
  orgId: string,
  kind: SharedKind,
  buildingId?: string | null
): Promise<SharedItem[]> {
  const masterOrgIds = buildingId
    ? [await findPoolMasterOrgId(orgId, buildingId)].filter((id): id is string => Boolean(id))
    : await findPoolMasterOrgIds(orgId);
  if (masterOrgIds.length <= 1) return masterOrgIds[0] ? listSharedItems(masterOrgIds[0], kind) : [];
  const lists = await Promise.all(masterOrgIds.map((id) => listSharedItems(id, kind)));
  const seen = new Set<string>();
  return lists.flat().filter((item) => {
    const key = keyOf(item.name);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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
  const normalized = sharedItemsForKind(kind, items);
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
            portion: item.portion ?? null,
            time: item.time ?? null,
            sortOrder: index,
          })),
        });
      }
    },
    { timeout: 30_000 }
  );
  return { total: normalized.length };
}

/**
 * Объект пула мастера: организация целиком или её точка, подключённая к
 * пулу (`Building.linkedServiceCode`, слитая организация). `id` — ключ
 * объекта: id организации или `<организация>:<точка>`.
 */
export type PoolObject = {
  id: string;
  name: string;
  organizationId: string;
  buildingId: string | null;
  /**
   * Точка организации, подключённой целиком (2026-10-28): её общие документы
   * (без точки) — тоже этого кабинета, списки раздаются и в них.
   */
  wholeOrganization?: boolean;
};

export function poolObjectId(organizationId: string, buildingId: string | null | undefined): string {
  return buildingId ? `${organizationId}:${buildingId}` : organizationId;
}

/** Название объекта точки: «Организация · Точка». */
export function poolObjectName(organizationName: string, buildingName: string | null | undefined): string {
  return buildingName ? `${organizationName} · ${buildingName}` : organizationName;
}

/** Код пула мастер-кабинета: привязка или свой код. */
export async function masterPoolCode(masterOrgId: string): Promise<string | null> {
  const master = await db.organization.findUnique({
    where: { id: masterOrgId },
    select: { serviceCode: true, linkedServiceCode: true },
  });
  return master?.linkedServiceCode ?? master?.serviceCode ?? null;
}

const POINT_SELECT = {
  select: { id: true, name: true, kind: true, linkedServiceCode: true },
  orderBy: [{ sortOrder: "asc" as const }, { name: "asc" as const }],
};

/**
 * Объекты пула мастер-кабинета (организации и точки), кроме самого кабинета.
 * Организация с журналами по точкам, подключённая целиком, — это её точки
 * (2026-10-28: «у каждой точки свой журнал, по ним объединяется выгрузка»):
 * у каждой свой объект и свой документ.
 */
export async function listPoolOrganizations(masterOrgId: string): Promise<PoolObject[]> {
  const [poolIds, code] = await Promise.all([resolveDishPoolOrgIds(masterOrgId), masterPoolCode(masterOrgId)]);
  const [orgs, buildings] = await Promise.all([
    db.organization.findMany({
      where: { id: { in: poolIds.filter((id) => id !== masterOrgId) }, ...NOT_DIRECTORY_ORG_WHERE },
      select: { id: true, name: true, perLocationJournals: true, buildings: POINT_SELECT },
    }),
    code
      ? db.building.findMany({
          where: { linkedServiceCode: code, organization: NOT_DIRECTORY_ORG_WHERE },
          select: { id: true, name: true, organizationId: true, organization: { select: { name: true } } },
        })
      : Promise.resolve([]),
  ]);
  const objects: PoolObject[] = [
    ...orgs.flatMap((org): PoolObject[] => {
      if (journalPointsOf(org, org.buildings).length === 0) {
        return [{ id: org.id, name: org.name, organizationId: org.id, buildingId: null }];
      }
      // Точки, подключённые своим кодом к другому кабинету, — не здесь.
      return wholeOrgPoints(org, org.buildings, code ?? "").map((point) => ({
        id: poolObjectId(org.id, point.id),
        name: poolObjectName(org.name, point.name),
        organizationId: org.id,
        buildingId: point.id,
        wholeOrganization: true,
      }));
    }),
    // Точка организации, которая и сама целиком в пуле, уже есть выше
    // (точкой или в составе организации без журналов по точкам).
    ...buildings
      .filter((building) => !poolIds.includes(building.organizationId))
      .map((building) => ({
        id: poolObjectId(building.organizationId, building.id),
        name: poolObjectName(building.organization.name, building.name),
        organizationId: building.organizationId,
        buildingId: building.id,
      })),
  ];
  return objects.sort((a, b) => a.name.localeCompare(b.name, "ru"));
}

/**
 * Объект ещё в пуле этого кода: точка — по своей привязке или как точка
 * организации, подключённой целиком; организация — по своей привязке.
 */
export async function isPoolObjectInPool(
  object: { organizationId: string; buildingId?: string | null },
  code: string
): Promise<boolean> {
  if (object.buildingId) {
    const building = await db.building.findFirst({
      where: { id: object.buildingId, organizationId: object.organizationId },
      select: {
        id: true,
        name: true,
        kind: true,
        linkedServiceCode: true,
        organization: { select: { kind: true, perLocationJournals: true, serviceCode: true, linkedServiceCode: true } },
      },
    });
    if (!building || building.organization.kind === MASTER_ORG_KIND) return false;
    if (building.linkedServiceCode === code) return true;
    const org = building.organization;
    return (org.linkedServiceCode ?? org.serviceCode) === code && wholeOrgPoints(org, [building], code).length > 0;
  }
  const org = await db.organization.findUnique({
    where: { id: object.organizationId },
    select: { kind: true, serviceCode: true, linkedServiceCode: true },
  });
  return Boolean(org && org.kind !== MASTER_ORG_KIND && (org.linkedServiceCode ?? org.serviceCode) === code);
}
