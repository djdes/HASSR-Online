/**
 * Rows of «Настройки → Работа без связи» built from audit records. Pure.
 */
export type OfflineRecordRow = {
  id: string;
  who: string;
  what: string;
  /** Journal day when the record was a past-day edit (`DD.MM`), otherwise null. */
  pastDay: string | null;
  recordedAt: Date;
  syncedAt: Date;
  delayMinutes: number;
  auth: "pin" | "list" | "self";
};

export type OfflineAuditRow = { id: string; userName: string | null; details: unknown; createdAt: Date };

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

/** Audit rows of form submissions → rows of records made without network (others are skipped). */
export function offlineRecordRows(rows: readonly OfflineAuditRow[]): OfflineRecordRow[] {
  const out: OfflineRecordRow[] = [];
  for (const row of rows) {
    if (!isRecord(row.details) || !isRecord(row.details.offline)) continue;
    const offline = row.details.offline;
    const recordedAt = new Date(String(offline.recordedAt ?? ""));
    if (Number.isNaN(recordedAt.getTime())) continue;
    const synced = new Date(String(offline.syncedAt ?? ""));
    const syncedAt = Number.isNaN(synced.getTime()) ? row.createdAt : synced;
    const dateKey = typeof row.details.dateKey === "string" ? row.details.dateKey : "";
    const [, month, day] = dateKey.split("-");
    out.push({
      id: row.id,
      // The audit author of a QR record is «Имя (QR)» — the suffix says nothing here.
      who: (row.userName ?? "").replace(/\s*\(QR\)\s*$/, "") || "—",
      what: typeof row.details.objectName === "string" && row.details.objectName ? row.details.objectName : "—",
      pastDay: offline.pastDayEdit === true && month && day ? `${day}.${month}` : null,
      recordedAt,
      syncedAt,
      delayMinutes: Math.max(0, Math.round((syncedAt.getTime() - recordedAt.getTime()) / 60_000)),
      auth: offline.auth === "pin" || offline.auth === "list" ? offline.auth : "self",
    });
  }
  return out.sort((a, b) => b.syncedAt.getTime() - a.syncedAt.getTime());
}
