import { db } from "@/lib/db";

import { buildFillHistory, type FillHistoryMap } from "./history";
import type { OfflineValues } from "./merge";
import { OFFLINE_MAX_AGE_DAYS } from "./record-time";

const DAY_MS = 24 * 60 * 60 * 1000;
const FILL_ACTION = "journal.qr_fill";

/** Form submissions of these documents for the offline window (31 days + a day of slack for time zones). */
export async function loadFillHistory(organizationId: string, documentIds: readonly string[], now: Date = new Date()): Promise<FillHistoryMap> {
  if (documentIds.length === 0) return new Map();
  const rows = await db.auditLog.findMany({
    where: {
      organizationId,
      action: FILL_ACTION,
      entity: "JournalDocument",
      entityId: { in: [...documentIds] },
      createdAt: { gte: new Date(now.getTime() - (OFFLINE_MAX_AGE_DAYS + 2) * DAY_MS) },
    },
    select: { entityId: true, details: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  return buildFillHistory(rows);
}

/** What the journal row holds for that day according to form submissions; `null` — nothing was submitted. */
export async function loadRowDayValues(params: { organizationId: string; documentId: string; rowKey: string; dateKey: string }): Promise<OfflineValues | null> {
  const history = await loadFillHistory(params.organizationId, [params.documentId]);
  return history.get(params.documentId)?.get(params.rowKey)?.get(params.dateKey) ?? null;
}
