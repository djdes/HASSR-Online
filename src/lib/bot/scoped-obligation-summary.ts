import { db } from "@/lib/db";
import { getManagerObligationSummary } from "@/lib/journal-obligations";
import { documentWorkerScopeWhere, personWorkerScopeWhere, type WorkerPointScope } from "@/lib/worker-point-scope";

function utcDayStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/**
 * Сводка дня руководителя (аудит 2026-11-01): руководитель точки видит
 * обязательства своих точек (и общие) только своих людей; без области —
 * вся организация, как `getManagerObligationSummary`.
 */
export async function scopedManagerObligationSummary(
  organizationId: string,
  now: Date,
  scope: WorkerPointScope,
): Promise<Awaited<ReturnType<typeof getManagerObligationSummary>>> {
  if (!scope) return getManagerObligationSummary(organizationId, now);
  const rows = await db.journalObligation.findMany({
    where: {
      organizationId,
      dateKey: utcDayStart(now),
      ...documentWorkerScopeWhere(scope),
      user: personWorkerScopeWhere(scope),
    },
    select: { userId: true, status: true },
  });
  // Как getManagerObligationSummary: всё, что не done, — ждёт.
  const pending = rows.filter((row) => row.status !== "done");
  return {
    total: rows.length,
    pending: pending.length,
    done: rows.length - pending.length,
    employeesWithPending: new Set(pending.map((row) => row.userId)).size,
  };
}
