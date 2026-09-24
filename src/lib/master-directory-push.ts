import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { withDocumentConfigLock } from "@/lib/document-config-lock";
import { FINISHED_PRODUCT_DOCUMENT_TEMPLATE_CODE } from "@/lib/finished-product-document";
import {
  findPoolMasterOrgId,
  listPoolOrganizations,
  listSharedItems,
  type SharedItem,
} from "@/lib/master-directory";
import { PERISHABLE_REJECTION_TEMPLATE_CODE } from "@/lib/perishable-rejection-document";

/**
 * Раздача списков мастер-кабинета в журналы организаций пула.
 *
 * Модель «копия с памятью»: в `config` документа лежит и рабочий список
 * (`itemsCatalog`, `productLists[0].items`, `suppliers`, `manufacturers`),
 * и то, что мастер прислал в прошлый раз (`sharedCatalog`,
 * `sharedProducts`, `sharedSuppliers`, `sharedManufacturers`). Так при
 * следующей раздаче уходит только убранное мастером, а позиции, которые
 * кухня добавила сама, остаются.
 */

export const MASTER_SHARED_JOURNAL_CODES = [
  FINISHED_PRODUCT_DOCUMENT_TEMPLATE_CODE,
  PERISHABLE_REJECTION_TEMPLATE_CODE,
] as const;

function keyOf(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function uniqueNames(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const value = (raw ?? "").replace(/\s+/g, " ").trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

/**
 * (current без тех, что были в previousShared и нет в nextShared) +
 * (nextShared, которых ещё нет в current). Сравнение без регистра; порядок —
 * текущие как были, затем новые в порядке мастера.
 */
export function mergeSharedIntoList(current: string[], previousShared: string[], nextShared: string[]): string[] {
  const nextKeys = new Set(nextShared.map(keyOf));
  const droppedKeys = new Set(previousShared.map(keyOf).filter((key) => key && !nextKeys.has(key)));
  const result: string[] = [];
  const seen = new Set<string>();
  for (const item of current) {
    const key = keyOf(item);
    if (!key || droppedKeys.has(key) || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  for (const item of nextShared) {
    const key = keyOf(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(item.replace(/\s+/g, " ").trim());
  }
  return result;
}

/** Меню мастера → `itemsCatalog` документа бракеража готовой продукции. */
export function applySharedToFinishedProductConfig(
  config: Record<string, unknown>,
  sharedNames: string[]
): Record<string, unknown> {
  const next = uniqueNames(sharedNames);
  return {
    ...config,
    itemsCatalog: mergeSharedIntoList(asStrings(config.itemsCatalog), asStrings(config.sharedCatalog), next),
    sharedCatalog: next,
  };
}

/** Сырьё мастера → изделия, поставщики и изготовители документа скоропорта. */
export function applySharedToPerishableConfig(
  config: Record<string, unknown>,
  shared: SharedItem[]
): Record<string, unknown> {
  const products = uniqueNames(shared.map((item) => item.name));
  const suppliers = uniqueNames(shared.map((item) => item.supplier));
  const manufacturers = uniqueNames(shared.map((item) => item.manufacturer));
  const lists = Array.isArray(config.productLists)
    ? (config.productLists as unknown[]).map((list) => asRecord(list))
    : [];
  const first = lists[0] ?? { id: `perishable-list-${Date.now().toString(36)}`, name: "Изделия", items: [] };
  const nextFirst = {
    ...first,
    items: mergeSharedIntoList(asStrings(first.items), asStrings(config.sharedProducts), products),
  };
  return {
    ...config,
    productLists: [nextFirst, ...lists.slice(1)],
    suppliers: mergeSharedIntoList(asStrings(config.suppliers), asStrings(config.sharedSuppliers), suppliers),
    manufacturers: mergeSharedIntoList(
      asStrings(config.manufacturers),
      asStrings(config.sharedManufacturers),
      manufacturers
    ),
    sharedProducts: products,
    sharedSuppliers: suppliers,
    sharedManufacturers: manufacturers,
  };
}

type MasterLists = { dishes: string[]; products: SharedItem[] };

async function loadMasterLists(masterOrgId: string): Promise<MasterLists> {
  const [dishes, products] = await Promise.all([
    listSharedItems(masterOrgId, "dish"),
    listSharedItems(masterOrgId, "product"),
  ]);
  return { dishes: dishes.map((item) => item.name), products };
}

function applyLists(code: string, config: Record<string, unknown>, lists: MasterLists): Record<string, unknown> {
  if (code === FINISHED_PRODUCT_DOCUMENT_TEMPLATE_CODE) return applySharedToFinishedProductConfig(config, lists.dishes);
  if (code === PERISHABLE_REJECTION_TEMPLATE_CODE) return applySharedToPerishableConfig(config, lists.products);
  return config;
}

async function pushListsToOrg(orgId: string, lists: MasterLists): Promise<{ documents: number }> {
  // «Активный документ» — как у saveOrgCommission: status="active" нужного журнала.
  const docs = await db.journalDocument.findMany({
    where: { organizationId: orgId, status: "active", template: { code: { in: [...MASTER_SHARED_JOURNAL_CODES] } } },
    select: { id: true },
  });
  let documents = 0;
  for (const doc of docs) {
    const done = await withDocumentConfigLock(doc.id, async (locked) => {
      if (locked.status !== "active") return { result: false };
      const config = applyLists(locked.templateCode, asRecord(locked.config), lists);
      return { config: config as Prisma.InputJsonValue, result: true };
    });
    if (done) documents += 1;
  }
  return { documents };
}

/** Раздать списки мастера одной организации пула (при подключении к коду). */
export async function pushSharedListsToOrg(orgId: string, masterOrgId: string): Promise<{ documents: number }> {
  if (orgId === masterOrgId) return { documents: 0 };
  return pushListsToOrg(orgId, await loadMasterLists(masterOrgId));
}

/** Раздать списки мастера всем организациям пула, кроме самого кабинета. */
export async function pushSharedListsToPool(
  masterOrgId: string
): Promise<{ organizations: number; documents: number }> {
  const [lists, orgs] = await Promise.all([loadMasterLists(masterOrgId), listPoolOrganizations(masterOrgId)]);
  let documents = 0;
  for (const org of orgs) {
    try {
      documents += (await pushListsToOrg(org.id, lists)).documents;
    } catch (err) {
      // Одна сломанная организация не должна останавливать раздачу остальным.
      console.error("[master-directory] push failed", { orgId: org.id, masterOrgId }, err);
    }
  }
  return { organizations: orgs.length, documents };
}

/**
 * Новый документ БЖГП/скоропорта у организации пула: сразу со списками
 * мастера. Без мастера в пуле конфиг не меняется.
 */
export async function withMasterSharedLists(
  organizationId: string,
  journalCode: string,
  config: Record<string, unknown>
): Promise<Record<string, unknown>> {
  if (!(MASTER_SHARED_JOURNAL_CODES as readonly string[]).includes(journalCode)) return config;
  try {
    const masterOrgId = await findPoolMasterOrgId(organizationId);
    if (!masterOrgId || masterOrgId === organizationId) return config;
    return applyLists(journalCode, config, await loadMasterLists(masterOrgId));
  } catch (err) {
    console.error("[master-directory] seed new document failed", { organizationId, journalCode }, err);
    return config;
  }
}
