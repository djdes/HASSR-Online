import { db } from "@/lib/db";

import type { OfflineValues } from "./merge";
import { OFFLINE_MAX_AGE_DAYS } from "./record-time";
import { employeeIdOfRowKey, STORED_VALUE_CODES, storedRowValues } from "./stored-values";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * What the journal holds for this row and day, read from the entry itself.
 * `undefined` — this journal cannot be read back (use the audit trail);
 * `null` — it can, and there is no entry.
 */
export async function loadStoredRowValues(params: {
  code: string;
  documentId: string;
  rowKey: string;
  dateKey: string;
  fieldKeys: readonly string[];
}): Promise<OfflineValues | null | undefined> {
  if (!STORED_VALUE_CODES.has(params.code)) return undefined;
  const employeeId = employeeIdOfRowKey(params.rowKey);
  if (!employeeId) return undefined;
  const entry = await db.journalDocumentEntry.findUnique({
    where: { documentId_employeeId_date: { documentId: params.documentId, employeeId, date: new Date(`${params.dateKey}T00:00:00.000Z`) } },
    select: { data: true },
  });
  if (!entry) return null;
  // An entry of a shape this form does not know: fall back to the audit trail rather than call it empty.
  return storedRowValues(params.code, entry.data, params.fieldKeys) ?? undefined;
}

/** Stored values of the offline window for a document: `rowKey → day → values`. Empty for journals that cannot be read back. */
export async function loadStoredHistory(params: {
  code: string;
  documentId: string;
  /** Form field keys per row key. */
  fieldKeysByRow: ReadonlyMap<string, readonly string[]>;
  todayKey: string;
}): Promise<Map<string, Map<string, OfflineValues>>> {
  const out = new Map<string, Map<string, OfflineValues>>();
  if (!STORED_VALUE_CODES.has(params.code)) return out;
  const today = new Date(`${params.todayKey}T00:00:00.000Z`);
  const entries = await db.journalDocumentEntry.findMany({
    where: { documentId: params.documentId, date: { gte: new Date(today.getTime() - OFFLINE_MAX_AGE_DAYS * DAY_MS), lte: today } },
    select: { employeeId: true, date: true, data: true },
  });
  for (const entry of entries) {
    const rowKey = `employee-${entry.employeeId}`;
    const fieldKeys = params.fieldKeysByRow.get(rowKey);
    if (!fieldKeys) continue;
    const values = storedRowValues(params.code, entry.data, fieldKeys);
    if (!values) continue;
    const days = out.get(rowKey) ?? new Map<string, OfflineValues>();
    days.set(entry.date.toISOString().slice(0, 10), values);
    out.set(rowKey, days);
  }
  return out;
}
