import { db } from "@/lib/db";
import type { ExchangeEntity } from "@/lib/directory-exchange/kinds";
import { planSkipSync, type ExchangeSkipRecord } from "@/lib/directory-exchange/skips";

/**
 * Строки разбора пропущенных записей (`DirectoryExchangeSkip`, Р9.1) после
 * прохода одной сущности обмена (`exchangeEntity` в run.server.ts): новые
 * пропуски записываются, повторные сдвигают `lastSeenAt`, а строки, которые
 * проход разрешил (запись создана, связана, надгробие), удаляются.
 *
 * Сбой здесь обмен не останавливает: пишется в лог, а строки поправит
 * следующий обмен.
 */
export async function recordExchangeSkips(input: {
  masterOrganizationId: string;
  entity: ExchangeEntity;
  /** Участники прохода. */
  organizationIds: readonly string[];
  /** Группы, которые проход видел: связи и операции плана. */
  groups: Iterable<string>;
  skipped: readonly ExchangeSkipRecord[];
  now?: Date;
}): Promise<void> {
  const { masterOrganizationId, entity } = input;
  try {
    const stored = await db.directoryExchangeSkip.findMany({
      where: { masterOrganizationId, entity, organizationId: { in: [...input.organizationIds] } },
      select: {
        id: true,
        groupId: true,
        organizationId: true,
        sourceOrganizationId: true,
        sourceEntityId: true,
        name: true,
        reason: true,
      },
    });
    if (stored.length === 0 && input.skipped.length === 0) return;
    const plan = planSkipSync({ stored, skipped: input.skipped, groups: input.groups });
    const now = input.now ?? new Date();
    if (plan.remove.length > 0) {
      await db.directoryExchangeSkip.deleteMany({ where: { id: { in: plan.remove } } });
    }
    if (plan.touch.length > 0) {
      await db.directoryExchangeSkip.updateMany({ where: { id: { in: plan.touch } }, data: { lastSeenAt: now } });
    }
    for (const { id, record } of plan.change) {
      await db.directoryExchangeSkip.update({
        where: { id },
        data: {
          sourceOrganizationId: record.sourceOrganizationId,
          sourceEntityId: record.sourceEntityId,
          name: record.name,
          reason: record.reason,
          lastSeenAt: now,
        },
      });
    }
    if (plan.add.length > 0) {
      await db.directoryExchangeSkip.createMany({
        data: plan.add.map((record) => ({ masterOrganizationId, entity, ...record, firstSeenAt: now, lastSeenAt: now })),
        skipDuplicates: true,
      });
    }
  } catch (error) {
    console.error("[directory-exchange] skip rows failed", { masterOrganizationId, entity, error });
  }
}
