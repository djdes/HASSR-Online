import { db } from "@/lib/db";
import {
  emptyCleanupCounts,
  exchangeCleanupCutoffs,
  isDisposableRequest,
  orphanSkipScopes,
  type ExchangeCleanupCounts,
} from "@/lib/directory-exchange/cleanup";

/**
 * Уборка служебных таблиц обмена при плановом обмене (серия E, Р4): старые и
 * ненужные строки разбора пропусков, закрытые запросы другой компании и
 * записи о разовых переносах (правила — cleanup.ts). Каждая часть — сама по
 * себе: сбой одной пишется в лог и не мешает остальным и обмену.
 */

const CHUNK = 500;

async function cleanupSkips(now: Date): Promise<number> {
  const { skipsSeenBefore } = exchangeCleanupCutoffs(now);
  let count = (await db.directoryExchangeSkip.deleteMany({ where: { lastSeenAt: { lt: skipsSeenBefore } } })).count;
  const [scopes, members] = await Promise.all([
    db.directoryExchangeSkip.groupBy({ by: ["masterOrganizationId", "organizationId", "entity"] }),
    db.directoryExchangeMember.findMany({ select: { masterOrganizationId: true, organizationId: true, kinds: true } }),
  ]);
  const orphans = orphanSkipScopes(scopes, members);
  for (let index = 0; index < orphans.length; index += CHUNK) {
    const where = { OR: orphans.slice(index, index + CHUNK).map(({ masterOrganizationId, organizationId, entity }) => ({ masterOrganizationId, organizationId, entity })) };
    count += (await db.directoryExchangeSkip.deleteMany({ where })).count;
  }
  return count;
}

async function cleanupRequests(now: Date): Promise<number> {
  const cutoffs = exchangeCleanupCutoffs(now);
  // Кандидаты — что давно не менялось или давно истекло; решает `isDisposableRequest`.
  const candidates = await db.directoryExchangeRequest.findMany({
    where: {
      status: { not: "approved" },
      OR: [{ updatedAt: { lt: cutoffs.requestsBefore } }, { expiresAt: { lt: cutoffs.requestsBefore } }],
    },
    select: { id: true, status: true, updatedAt: true, decidedAt: true, expiresAt: true },
  });
  const ids = candidates.filter((request) => isDisposableRequest(request, cutoffs)).map((request) => request.id);
  let count = 0;
  for (let index = 0; index < ids.length; index += CHUNK) {
    count += (await db.directoryExchangeRequest.deleteMany({ where: { id: { in: ids.slice(index, index + CHUNK) } } })).count;
  }
  return count;
}

async function cleanupTransfers(now: Date): Promise<number> {
  const { transfersBefore } = exchangeCleanupCutoffs(now);
  return (await db.directoryTransfer.deleteMany({ where: { createdAt: { lt: transfersBefore } } })).count;
}

/** Уборка всех трёх таблиц; возвращает, сколько строк удалено. Не бросает. */
export async function cleanupExchangeTables(now: Date = new Date()): Promise<ExchangeCleanupCounts> {
  const counts = emptyCleanupCounts();
  const parts: Array<[keyof ExchangeCleanupCounts, (now: Date) => Promise<number>]> = [
    ["skips", cleanupSkips],
    ["requests", cleanupRequests],
    ["transfers", cleanupTransfers],
  ];
  for (const [key, run] of parts) {
    try {
      counts[key] = await run(now);
    } catch (error) {
      console.error(`[directory-exchange] cleanup of ${key} failed`, error);
    }
  }
  return counts;
}
