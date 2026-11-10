/**
 * What a journal row really holds, read back from the journal entry itself.
 *
 * The first stage compared an offline edit only with earlier form
 * submissions (the QR audit trail), so a value typed into the cabinet table
 * was invisible to the merge and got overwritten. For the journals filled
 * most often — hygiene, health, the cleaning-and-ventilation checklist —
 * the stored entry is mapped back to form values here, and that is what the
 * merge and the offline history use. Pure; the database part is in
 * `stored-values.server.ts`.
 *
 * Other "one row per day" journals keep their rows in shapes only their
 * adapters understand; for them the audit trail stays the source.
 */
import { normalizeOfflineValue, type OfflineValues } from "./merge";

/** Journals whose entries can be read back into form values. */
export const STORED_VALUE_CODES: ReadonlySet<string> = new Set(["hygiene", "health_check", "cleaning_ventilation_checklist"]);

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

/**
 * @param data `JournalDocumentEntry.data` of the row and day
 * @param fieldKeys keys of the row's form — only they are returned
 * @returns form values, or `null` when the entry cannot be read as this form
 */
export function storedRowValues(code: string, data: unknown, fieldKeys: readonly string[]): OfflineValues | null {
  if (!STORED_VALUE_CODES.has(code) || !isRecord(data)) return null;
  const keys = new Set(fieldKeys);
  const out: OfflineValues = {};
  const put = (key: string, value: unknown) => {
    if (keys.has(key)) out[key] = normalizeOfflineValue(value);
  };

  if (code === "hygiene") {
    // New form: three signed statements. Old form: status + temperature flag.
    if (isRecord(data.confirmations)) {
      for (const [key, value] of Object.entries(data.confirmations)) put(key, value === true);
    } else {
      put("status", data.status);
      put("temperatureAbove37", typeof data.temperatureAbove37 === "boolean" ? data.temperatureAbove37 : null);
    }
  } else if (code === "health_check") {
    put("signed", typeof data.signed === "boolean" ? data.signed : null);
    put("measures", data.measures);
  } else {
    // Checklist: a procedure is done when it is present in `procedures`.
    const procedures = isRecord(data.procedures) ? data.procedures : {};
    for (const key of fieldKeys) {
      if (key.startsWith("proc_")) out[key] = Object.prototype.hasOwnProperty.call(procedures, key.slice("proc_".length));
    }
  }
  // An entry of another form version shares no keys with this form — treat as unreadable.
  return Object.keys(out).length > 0 ? out : null;
}

/** `employee-<id>` → id; other row keys are not per-employee entries. */
export function employeeIdOfRowKey(rowKey: string): string | null {
  return rowKey.startsWith("employee-") && rowKey.length > "employee-".length ? rowKey.slice("employee-".length) : null;
}
