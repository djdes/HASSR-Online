import { ENTITY_KIND, isExchangeEntity, normalizeExchangeKinds } from "@/lib/directory-exchange/kinds";
import { isRequestStatus } from "@/lib/directory-exchange/requests";

/**
 * Уборка служебных таблиц обмена при плановом обмене (серия E, Р4) — чистая
 * часть: сроки и что считать ненужным. Удаляет `cleanup.server.ts`.
 *
 *   • строки разбора пропусков (`DirectoryExchangeSkip`), которых обмен не
 *     видел 30 дней или чья организация больше не участвует этим списком
 *     (участника кабинета нет, или у него снята галочка списка записи);
 *   • запросы другой компании в статусах «отклонён / отменён / истёк» старше
 *     180 дней (открытый запрос с истёкшим сроком — тоже «истёк»: статус
 *     отмечается лениво, при чтении);
 *   • записи о разовых переносах (`DirectoryTransfer`) старше 180 дней —
 *     отменить перенос можно только 7 дней.
 *
 * Журнал обменов (90 дней) и историю изменений (30 дней) чистит
 * `pruneExchangeLogs` (runs.server.ts).
 */

export const SKIP_RETENTION_DAYS = 30;
export const CLOSED_REQUEST_RETENTION_DAYS = 180;
export const TRANSFER_RETENTION_DAYS = 180;
const DAY_MS = 86_400_000;

export type ExchangeCleanupCounts = { skips: number; requests: number; transfers: number };

export function emptyCleanupCounts(): ExchangeCleanupCounts {
  return { skips: 0, requests: 0, transfers: 0 };
}

export type ExchangeCleanupCutoffs = {
  /** Строки разбора, которых не видели с этого момента. */
  skipsSeenBefore: Date;
  /** Закрытые запросы, последний раз менявшиеся до этого момента. */
  requestsBefore: Date;
  /** Переносы, сделанные до этого момента. */
  transfersBefore: Date;
};

export function exchangeCleanupCutoffs(now: Date): ExchangeCleanupCutoffs {
  const before = (days: number) => new Date(now.getTime() - days * DAY_MS);
  return {
    skipsSeenBefore: before(SKIP_RETENTION_DAYS),
    requestsBefore: before(CLOSED_REQUEST_RETENTION_DAYS),
    transfersBefore: before(TRANSFER_RETENTION_DAYS),
  };
}

/** Строки разбора одной организации, сущности и кабинета. */
export type SkipScope = { masterOrganizationId: string; organizationId: string; entity: string };
export type ExchangeMemberKinds = { masterOrganizationId: string; organizationId: string; kinds: unknown };

const memberKey = (masterOrganizationId: string, organizationId: string) => `${masterOrganizationId}\u0000${organizationId}`;

/**
 * Строки разбора, чья организация больше не участвует этим списком: её нет
 * среди участников кабинета, у неё снята галочка списка записи
 * (`ENTITY_KIND`) или сущность незнакомая.
 */
export function orphanSkipScopes(scopes: readonly SkipScope[], members: readonly ExchangeMemberKinds[]): SkipScope[] {
  const kindsOf = new Map<string, Set<string>>();
  for (const member of members) {
    kindsOf.set(memberKey(member.masterOrganizationId, member.organizationId), new Set(normalizeExchangeKinds(member.kinds)));
  }
  return scopes.filter((scope) => {
    const kinds = kindsOf.get(memberKey(scope.masterOrganizationId, scope.organizationId));
    if (!kinds || !isExchangeEntity(scope.entity)) return true;
    return !kinds.has(ENTITY_KIND[scope.entity]);
  });
}

/**
 * Запрос другой компании можно удалить: он закрыт (отклонён, отменён,
 * истёк; незнакомый статус читается как «истёк») и не менялся 180 дней, или
 * он так и остался открытым, а срок ответа истёк больше 180 дней назад.
 * Подтверждённые запросы не удаляются.
 */
export function isDisposableRequest(
  request: { status: string; updatedAt: Date; decidedAt: Date | null; expiresAt: Date },
  cutoffs: Pick<ExchangeCleanupCutoffs, "requestsBefore">,
): boolean {
  const before = cutoffs.requestsBefore.getTime();
  if (request.status === "approved") return false;
  if (request.status === "pending") return request.expiresAt.getTime() < before;
  const closed = !isRequestStatus(request.status) || ["declined", "cancelled", "expired"].includes(request.status);
  return closed && request.updatedAt.getTime() < before && (request.decidedAt === null || request.decidedAt.getTime() < before);
}
