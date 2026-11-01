import { generatePoolForDay } from "@/lib/journal-task-pool";

/**
 * Точка задачи из подборки дня (аудит 2026-11-01). Ключ задачи
 * (`fridge:<id>:…`, `room:<id>:…`) приходит с клиента свободным текстом:
 * без сверки сотрудник точки А мог «взять» холодильник точки Б, а
 * руководитель — поручить задачу точки Б человеку точки А.
 *
 *  - `pool: false` — у журнала нет подборки, сверять не с чем;
 *  - `found: false` — ключа нет в подборке точек человека;
 *  - `pointId` — точка, в подборке которой ключ (null — точки выключены).
 */
export type ScopePoint =
  | { pool: false }
  | { pool: true; found: false }
  | { pool: true; found: true; pointId: string | null };

export function pickScopePoint(
  pools: ReadonlyArray<{ pointId: string | null; pool: boolean; scopeKeys: readonly string[] }>,
  scopeKey: string,
): ScopePoint {
  if (pools.length === 0 || pools.every((entry) => !entry.pool)) return { pool: false };
  const hit = pools.find((entry) => entry.pool && entry.scopeKeys.includes(scopeKey));
  return hit ? { pool: true, found: true, pointId: hit.pointId } : { pool: true, found: false };
}

export async function findScopePoint(args: {
  organizationId: string;
  journalCode: string;
  date: Date;
  points: ReadonlyArray<{ id: string | null }>;
  scopeKey: string;
}): Promise<ScopePoint> {
  const points = args.points.length > 0 ? args.points : [{ id: null }];
  const pools = await Promise.all(
    points.map(async (point) => {
      const pool = await generatePoolForDay({
        organizationId: args.organizationId,
        journalCode: args.journalCode,
        date: args.date,
        buildingId: point.id,
      });
      return { pointId: point.id, pool: pool.pool, scopeKeys: pool.scopes.map((scope) => scope.scopeKey) };
    }),
  );
  return pickScopePoint(pools, args.scopeKey);
}

/**
 * Объект задачи из ключа — для `placeOfEvent`: тревога о температуре
 * холодильника точки А уходит людям точки А, даже если задачу закрыл
 * сотрудник, который работает на всех точках.
 */
export function placeRefFromScopeKey(scopeKey: string): { equipmentId?: string; documentId?: string } {
  const equipment = /^(?:fridge|fryer|uv):([^:]+):/.exec(scopeKey);
  if (equipment && equipment[1] !== "default") return { equipmentId: equipment[1] };
  const hygiene = /^hygiene-shift:([^:]+):/.exec(scopeKey);
  if (hygiene) return { documentId: hygiene[1] };
  return {};
}
