/**
 * Площадки Меркурия → точки (2026-11-01).
 *
 * ВСД приходят по площадке (`MercuryEnterprise`), а журнал приёмки — у
 * точки. Площадка без точки кладёт ВСД в общий журнал; раньше площадки
 * никто не создавал и не сопоставлял, поэтому приёмка брала точку из шапки.
 * Здесь — правила сопоставления: какие ВСД переезжают вместе с площадкой и
 * как разложить список площадок, пришедший из Меркурия.
 */
import { db } from "@/lib/db";

import type { MercuryEnterpriseInfo } from "./types";

/**
 * ВСД, чья точка следует за площадкой. Погашенные и гасящиеся остаются на
 * своей точке: их строка уже в журнале приёмки той точки.
 */
export const REPOINT_VSD_STATUSES = ["new", "acknowledged", "process_failed", "irrelevant"] as const;

export function vsdPointFollowsEnterprise(localStatus: string): boolean {
  return (REPOINT_VSD_STATUSES as readonly string[]).includes(localStatus);
}

type ExistingEnterprise = {
  id: string;
  enterpriseGuid: string;
  activityLocationGuid: string | null;
  name: string;
  address: string | null;
};

const keyOf = (enterpriseGuid: string, activityLocationGuid: string | null | undefined) =>
  `${enterpriseGuid.trim().toLowerCase()}|${(activityLocationGuid ?? "").trim().toLowerCase()}`;

/**
 * Список площадок из Меркурия против того, что уже есть: новые — создать
 * (без точки и выключенными, пока руководитель не выберет точку), у
 * знакомых — обновить название и адрес; точку и «опрашивать» не трогаем.
 */
export function planEnterpriseList(
  existing: readonly ExistingEnterprise[],
  items: readonly MercuryEnterpriseInfo[],
): { create: MercuryEnterpriseInfo[]; update: Array<{ id: string; name: string; address: string | null }> } {
  const known = new Map(existing.map((row) => [keyOf(row.enterpriseGuid, row.activityLocationGuid), row]));
  const seen = new Set<string>();
  const create: MercuryEnterpriseInfo[] = [];
  const update: Array<{ id: string; name: string; address: string | null }> = [];
  for (const item of items) {
    const key = keyOf(item.enterpriseGuid, item.activityLocationGuid);
    if (seen.has(key)) continue;
    seen.add(key);
    const row = known.get(key);
    if (!row) {
      create.push(item);
      continue;
    }
    const address = item.address ?? null;
    if (row.name !== item.name || row.address !== address) update.push({ id: row.id, name: item.name, address });
  }
  return { create, update };
}

/** Записать список площадок из Меркурия (ответ `getActivityLocationList`). */
export async function applyEnterpriseList(
  integration: { id: string; organizationId: string },
  items: readonly MercuryEnterpriseInfo[],
): Promise<{ created: number; updated: number }> {
  const existing = await db.mercuryEnterprise.findMany({
    where: { integrationId: integration.id },
    select: { id: true, enterpriseGuid: true, activityLocationGuid: true, name: true, address: true },
  });
  const plan = planEnterpriseList(existing, items);
  for (const item of plan.create) {
    await db.mercuryEnterprise.create({
      data: {
        integrationId: integration.id,
        organizationId: integration.organizationId,
        enterpriseGuid: item.enterpriseGuid,
        activityLocationGuid: item.activityLocationGuid ?? null,
        name: item.name,
        address: item.address ?? null,
        buildingId: null,
        enabled: false,
      },
    });
  }
  for (const row of plan.update) {
    await db.mercuryEnterprise.update({ where: { id: row.id }, data: { name: row.name, address: row.address } });
  }
  return { created: plan.create.length, updated: plan.update.length };
}

/** Новая точка площадки — её ещё не погашенные ВСД переезжают туда же. */
export async function repointEnterpriseDocuments(enterpriseId: string, buildingId: string | null): Promise<number> {
  const result = await db.mercuryVetDocument.updateMany({
    where: { enterpriseId, localStatus: { in: [...REPOINT_VSD_STATUSES] } },
    data: { buildingId },
  });
  return result.count;
}

/** Есть ли уже такая площадка (у места деятельности null не уникален в БД). */
export async function findDuplicateEnterprise(args: {
  integrationId: string;
  enterpriseGuid: string;
  activityLocationGuid: string | null;
  exceptId?: string;
}): Promise<boolean> {
  const rows = await db.mercuryEnterprise.findMany({
    where: { integrationId: args.integrationId, ...(args.exceptId ? { NOT: { id: args.exceptId } } : {}) },
    select: { enterpriseGuid: true, activityLocationGuid: true },
  });
  const wanted = keyOf(args.enterpriseGuid, args.activityLocationGuid);
  return rows.some((row) => keyOf(row.enterpriseGuid, row.activityLocationGuid) === wanted);
}

/**
 * Площадка получила точку впервые и была выключена — включаем опрос:
 * выбрать точку и значит начать получать её ВСД. Явный выбор
 * «опрашивать» в том же запросе важнее.
 */
export function autoEnableOnMapping(args: {
  currentBuildingId: string | null;
  currentEnabled: boolean;
  nextBuildingId: string | null | undefined;
  requestedEnabled: boolean | undefined;
}): boolean | undefined {
  if (args.requestedEnabled !== undefined) return args.requestedEnabled;
  if (args.nextBuildingId && !args.currentBuildingId && !args.currentEnabled) return true;
  return undefined;
}
