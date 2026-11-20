/**
 * Откат версий отпечатка связей обмена (серия D, Р1) — работа с базой.
 * Чистая часть и правила — в `hash-downgrade.ts`; запуск —
 * `scripts/directory-exchange-hash-downgrade.ts`, порядок отката —
 * `docs/directory-exchange-rollback.md`.
 *
 * Запись строится так же, как её видит обмен (`exchangeEntity` в
 * run.server.ts): `loadEntityRows` с группой родителя по связям родителя того
 * же кабинета и той же организации. Пробный прогон только читает. Запись —
 * под замком обмена кабинета (`withExchangeLock`), план пересчитывается уже
 * под замком, все связи кабинета пишутся одной транзакцией и только там, где
 * отпечаток ещё прежний.
 */

import { db } from "@/lib/db";
import { loadEntityRows, type EntityRow, type ParentGroupLookup } from "@/lib/directory-exchange/entities.server";
import { DirectoryExchangeError } from "@/lib/directory-exchange/errors";
import {
  DEFAULT_DOWNGRADE_VERSION,
  downgradeEntities,
  needsDowngrade,
  planCabinetDowngrade,
  type DowngradeCounts,
  type DowngradeLink,
} from "@/lib/directory-exchange/hash-downgrade";
import { ENTITY_PARENT, hashTag, isExchangeEntity, type ExchangeEntity } from "@/lib/directory-exchange/kinds";
import { EXCHANGE_BUSY_CODE, withExchangeLock } from "@/lib/directory-exchange/run.server";

export type CabinetDowngradeResult =
  | {
      masterOrganizationId: string;
      status: "planned" | "applied";
      counts: DowngradeCounts;
      /** Сколько связей записано (`applied`); у пробного прогона 0. */
      written: number;
      /** Отпечаток сменился между планом и записью — связь не тронута. */
      stale: number;
    }
  /** Кабинет занят обменом — пропущен, ничего не записано. */
  | { masterOrganizationId: string; status: "busy" };

/** Кабинеты, у которых есть связи сущностей с версией выше `targetVersion`. */
export async function listDowngradeCabinets(targetVersion: number = DEFAULT_DOWNGRADE_VERSION): Promise<string[]> {
  const entities = downgradeEntities(targetVersion);
  if (entities.length === 0) return [];
  const rows = await db.directoryExchangeLink.findMany({
    where: { entity: { in: entities }, hash: { contains: "v" } },
    distinct: ["masterOrganizationId"],
    orderBy: { masterOrganizationId: "asc" },
    select: { masterOrganizationId: true },
  });
  return rows.map((row) => row.masterOrganizationId);
}

async function loadCabinetPlan(masterOrganizationId: string, targetVersion: number) {
  const entities = downgradeEntities(targetVersion);
  const stored = await db.directoryExchangeLink.findMany({
    where: { masterOrganizationId, entity: { in: entities } },
    orderBy: { id: "asc" },
    select: { id: true, entity: true, organizationId: true, entityId: true, hash: true },
  });
  const links: DowngradeLink[] = stored.flatMap((link) =>
    isExchangeEntity(link.entity) && hashTag(link.hash).version > targetVersion ? [{ ...link, entity: link.entity }] : [],
  );

  // Записи читаются только там, где есть что откатывать: организация × сущность.
  const wanted = new Map<string, { organizationId: string; entity: ExchangeEntity }>();
  for (const link of links) {
    if (needsDowngrade(link, targetVersion)) wanted.set(`${link.entity}\u0000${link.organizationId}`, { organizationId: link.organizationId, entity: link.entity });
  }
  const rows = new Map<string, Map<string, EntityRow>>();
  for (const [key, { organizationId, entity }] of wanted) {
    const lookup = await parentLookup(masterOrganizationId, entity, organizationId);
    // Состав `account`: читаются все поля — из них считается любой прежний состав.
    const loaded = await loadEntityRows(entity, organizationId, lookup, "account");
    rows.set(key, new Map(loaded.map((row) => [row.id, row])));
  }
  return planCabinetDowngrade(links, (link) => rows.get(`${link.entity}\u0000${link.organizationId}`)?.get(link.entityId ?? "") ?? null, {
    targetVersion,
  });
}

/** Группа родителя по его id — по связям родителя того же кабинета и организации, как в обмене. */
async function parentLookup(masterOrganizationId: string, entity: ExchangeEntity, organizationId: string): Promise<ParentGroupLookup> {
  const parent = ENTITY_PARENT[entity];
  if (!parent) return () => null;
  const links = await db.directoryExchangeLink.findMany({
    where: { masterOrganizationId, entity: parent.entity, organizationId },
    select: { groupId: true, entityId: true },
  });
  const groups = new Map<string, string>();
  for (const link of links) if (link.entityId) groups.set(link.entityId, link.groupId);
  return (id) => groups.get(id) ?? null;
}

/**
 * Откат отпечатков одного кабинета. Без `apply` — только план (ничего не
 * пишется). С `apply` — под замком обмена; кабинет занят дольше `waitMs` —
 * `busy`, ничего не записано.
 */
export async function downgradeCabinetHashes(
  masterOrganizationId: string,
  options: { apply?: boolean; targetVersion?: number; waitMs?: number } = {},
): Promise<CabinetDowngradeResult> {
  const targetVersion = options.targetVersion ?? DEFAULT_DOWNGRADE_VERSION;
  if (!options.apply) {
    const { counts } = await loadCabinetPlan(masterOrganizationId, targetVersion);
    return { masterOrganizationId, status: "planned", counts, written: 0, stale: 0 };
  }
  try {
    return await withExchangeLock(
      masterOrganizationId,
      async () => {
        const { rewrites, counts } = await loadCabinetPlan(masterOrganizationId, targetVersion);
        if (rewrites.length === 0) return { masterOrganizationId, status: "applied" as const, counts, written: 0, stale: 0 };
        // Одна транзакция на кабинет; пишется только связь, чей отпечаток всё ещё тот, что в плане.
        const results = await db.$transaction(
          rewrites.map((rewrite) =>
            db.directoryExchangeLink.updateMany({ where: { id: rewrite.id, hash: rewrite.from }, data: { hash: rewrite.to } }),
          ),
        );
        const written = results.reduce((sum, result) => sum + result.count, 0);
        return { masterOrganizationId, status: "applied" as const, counts, written, stale: rewrites.length - written };
      },
      { waitMs: options.waitMs },
    );
  } catch (error) {
    if (error instanceof DirectoryExchangeError && error.code === EXCHANGE_BUSY_CODE) return { masterOrganizationId, status: "busy" };
    throw error;
  }
}
