/**
 * History of "one row per day" journals for offline work, rebuilt from the
 * audit trail of form submissions (`journal.qr_fill`: QR pages, the offline
 * app, the messenger bot). Pure part — no database here.
 *
 * Journals store rows in very different shapes (entries, document config),
 * and only the adapters know how to write them. What every form submission
 * shares is its audit record with the submitted values, so that is the one
 * generic source of "what this row held on that day".
 */
import { normalizeOfflineValue, type OfflineValues } from "./merge";

export type FillAuditRow = { entityId: string | null; details: unknown; createdAt: Date };

/** documentId → rowKey → day → values (the latest submission wins). */
export type FillHistoryMap = Map<string, Map<string, Map<string, OfflineValues>>>;

export function buildFillHistory(rows: readonly FillAuditRow[]): FillHistoryMap {
  const out: FillHistoryMap = new Map();
  const ordered = [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  for (const row of ordered) {
    const details = row.details;
    if (!row.entityId || !details || typeof details !== "object" || Array.isArray(details)) continue;
    const { kind, rowKey, dateKey, values } = details as Record<string, unknown>;
    if (kind !== "journal" || typeof rowKey !== "string" || !rowKey || typeof dateKey !== "string") continue;
    if (!values || typeof values !== "object" || Array.isArray(values)) continue;
    const clean: OfflineValues = {};
    for (const [key, value] of Object.entries(values as Record<string, unknown>)) clean[key] = normalizeOfflineValue(value);
    const byRow = out.get(row.entityId) ?? new Map<string, Map<string, OfflineValues>>();
    const byDay = byRow.get(rowKey) ?? new Map<string, OfflineValues>();
    // A later submission replaces the earlier one field by field, as the journal row does.
    byDay.set(dateKey, { ...(byDay.get(dateKey) ?? {}), ...clean });
    byRow.set(rowKey, byDay);
    out.set(row.entityId, byRow);
  }
  return out;
}

export function historyToPlain(map: Map<string, Map<string, OfflineValues>> | undefined): Record<string, Record<string, OfflineValues>> {
  const out: Record<string, Record<string, OfflineValues>> = {};
  for (const [rowKey, days] of map ?? []) out[rowKey] = Object.fromEntries(days);
  return out;
}
