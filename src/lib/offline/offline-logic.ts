/**
 * Decisions of the offline screen that do not need React or the network:
 * what a scanned QR opens, who may sign, what a form starts with and what
 * goes into the queue. Pure — covered by tests.
 */
import type { TaskFormField, TaskFormSchema } from "@/lib/tasksflow-adapters/task-form";

import { normalizeOfflineValue, type OfflineValues } from "./merge";
import type { OfflineQrTarget } from "./qr-url";
import { recentDateKeys } from "./record-time";
import type {
  OfflineAuthKind,
  OfflinePack,
  OfflinePackDocument,
  OfflinePackEmployee,
  OfflinePackJournal,
  OfflinePackObject,
  OfflineQueueItem,
} from "./types";

export type OfflineQrResolution =
  | { kind: "object"; object: OfflinePackObject }
  | { kind: "journal"; journal: OfflinePackJournal }
  | { kind: "hub" }
  | { kind: "foreign-org" }
  | { kind: "missing"; what: "object" | "journal" };

/** What a scanned sticker or poster opens with the data saved on this device. */
export function resolveOfflineQr(pack: OfflinePack, target: OfflineQrTarget): OfflineQrResolution {
  if (target.kind === "journal") {
    // The first segment of `/qj/...` may be a point id instead of the organization — then only the code decides.
    if (target.shortSig === null && target.orgId !== pack.organization.id) return { kind: "foreign-org" };
    if (target.hub) return { kind: "hub" };
    const journal = pack.journals.find((item) => item.code === target.code);
    return journal ? { kind: "journal", journal } : { kind: "missing", what: "journal" };
  }
  const id = target.kind === "equipment" ? target.equipmentId : target.roomId;
  const object = pack.objects.find((item) => item.kind === target.kind && item.id === id);
  return object ? { kind: "object", object } : { kind: "missing", what: "object" };
}

/** The point exists in the saved data; an unknown id (points switched off, a deleted point) means "no filter", as on the server. */
export function offlinePoint(pack: OfflinePack, pointId: string | null | undefined) {
  return pointId ? ((pack.points ?? []).find((point) => point.id === pointId) ?? null) : null;
}

/** Documents a QR of the point opens: of this point and shared ones — the rule of `scopeDocumentsToBuilding`. */
export function offlinePointDocuments(pack: OfflinePack, journal: OfflinePackJournal, pointId: string | null | undefined, documentId?: string | null): OfflinePackDocument[] {
  const own = documentId ? journal.documents.filter((document) => document.id === documentId) : [];
  if (own.length > 0) return own;
  const point = offlinePoint(pack, pointId);
  if (!point) return journal.documents;
  return journal.documents.filter((document) => document.buildingId === null || document.buildingId === point.id);
}

/**
 * Who may sign a document opened through a point: a document of a point has
 * its own staff; a shared document opened by a point's QR — the staff of that point.
 */
export function offlineDocumentSignerIds(pack: OfflinePack, document: OfflinePackDocument, pointId: string | null | undefined): string[] {
  const point = document.buildingId ? null : offlinePoint(pack, pointId);
  if (!point) return document.employeeIds;
  const staff = new Set(point.employeeIds);
  return document.employeeIds.filter((id) => staff.has(id));
}

/** The saved data as one point sees it: its journals, documents and objects. Without a point — everything. */
export function scopeOfflinePack(pack: OfflinePack, pointId: string | null | undefined): OfflinePack {
  const point = offlinePoint(pack, pointId);
  if (!point) return pack;
  const disabled = new Set(point.disabledCodes);
  return {
    ...pack,
    journals: pack.journals
      .filter((journal) => !disabled.has(journal.code))
      .map((journal) => ({ ...journal, documents: offlinePointDocuments(pack, journal, point.id) }))
      .filter((journal) => journal.documents.length > 0),
    objects: pack.objects.filter((object) => object.buildingId === null || object.buildingId === point.id),
  };
}

export type OfflineSignerStep =
  /** May sign right away. */
  | { step: "ready"; auth: OfflineAuthKind }
  /** Must enter the PIN first. */
  | { step: "pin" }
  /** Cannot sign without network; `reason` is the key of the text to show (`offlineApp.signer.*`). */
  | { step: "denied"; reason: "deniedAuth" | "deniedNoPin" | "deniedCantVerify" };

/** How an employee is confirmed on the device, mirroring the online QR rules. */
export function offlineSignerStep(pack: OfflinePack, employee: OfflinePackEmployee, pinPassed: boolean): OfflineSignerStep {
  // The account signed in on the device is itself — no PIN, as on the QR page for a signed-in person.
  if (employee.id === pack.user.id) return { step: "ready", auth: "self" };
  const mode = pack.organization.qrFillMode;
  if (mode === "auth") {
    return { step: "denied", reason: "deniedAuth" };
  }
  if (!employee.hasPin) {
    return mode === "pin"
      ? { step: "denied", reason: "deniedNoPin" }
      : { step: "ready", auth: "list" };
  }
  if (!employee.pin || !employee.pinFp) {
    return { step: "denied", reason: "deniedCantVerify" };
  }
  return pinPassed ? { step: "ready", auth: "pin" } : { step: "pin" };
}

/** Employees to offer in "Кто вы?": the allowed ones, the signed-in account first. */
export function offlineSigners(pack: OfflinePack, allowedIds: readonly string[]): OfflinePackEmployee[] {
  const allowed = new Set(allowedIds);
  const list = pack.employees.filter((employee) => allowed.has(employee.id));
  if (pack.organization.qrFillMode === "auth") return list.filter((employee) => employee.id === pack.user.id);
  return [...list].sort((a, b) => Number(b.id === pack.user.id) - Number(a.id === pack.user.id));
}

export function offlineRowKey(document: OfflinePackDocument, rowKey: string | null, employeeId: string): string {
  return document.perEmployee ? `employee-${employeeId}` : (rowKey ?? "");
}

/** Days a row can be opened for: today back to 31 days, inside the document period, newest first. */
export function offlineEditableDays(document: OfflinePackDocument, todayKey: string): string[] {
  return recentDateKeys(todayKey).filter((day) => day >= document.dateFrom && day <= document.dateTo);
}

export function formDefaults(schema: TaskFormSchema): OfflineValues {
  const out: OfflineValues = {};
  for (const field of schema.fields) {
    if (field.type === "photo" || field.type === "signature") continue;
    out[field.key] = normalizeOfflineValue((field as { defaultValue?: unknown }).defaultValue);
  }
  return out;
}

const journalTargetKey = (item: Pick<OfflineQueueItem, "target">) =>
  item.target.kind === "journal" ? `${item.target.documentId}|${item.target.rowKey}|${item.target.day ?? ""}` : null;

/** Unsent edit of the same row and day made on this device, if any. */
export function queuedRowEdit(queue: readonly OfflineQueueItem[], documentId: string, rowKey: string, day: string | null): OfflineQueueItem | null {
  const key = `${documentId}|${rowKey}|${day ?? ""}`;
  const matches = queue.filter((item) => journalTargetKey(item) === key && item.status !== "rejected");
  return matches.length > 0 ? matches[matches.length - 1] : null;
}

export type OfflineRowState = {
  /** What the form shows when opened. */
  values: OfflineValues;
  /** What the journal held when the pack was downloaded — sent as the merge base. */
  base: OfflineValues;
  /** The row already has a saved or queued record for that day. */
  filled: boolean;
  /** The values come from an unsent record of this device. */
  unsent: boolean;
};

/**
 * Starting point of a "one row per day" form. `day` is null for today.
 * Saved values come from the pack history; an unsent record of this device
 * is shown on top so the person sees their own latest edit.
 */
export function offlineRowState(params: {
  document: OfflinePackDocument;
  schema: TaskFormSchema;
  rowKey: string;
  day: string | null;
  todayKey: string;
  queue: readonly OfflineQueueItem[];
}): OfflineRowState {
  const dayKey = params.day ?? params.todayKey;
  const saved = params.document.history[params.rowKey]?.[dayKey] ?? null;
  const queued = queuedRowEdit(params.queue, params.document.id, params.rowKey, params.day);
  const queuedValues = queued ? ((queued.body.values ?? {}) as OfflineValues) : null;
  const defaults = formDefaults(params.schema);
  // A filled row is shown as saved: defaults would silently "pre-answer" fields that were left empty.
  const values = queuedValues ? { ...(saved ?? {}), ...queuedValues } : saved ? { ...saved } : defaults;
  return { values, base: saved ?? {}, filled: Boolean(saved || queued), unsent: Boolean(queued) };
}

export type OfflineRange = { min?: number | null; max?: number | null } | null | undefined;

export function isOutOfRange(value: unknown, range: OfflineRange): boolean {
  if (!range) return false;
  const number = typeof value === "number" ? value : Number(String(value ?? "").replace(",", "."));
  if (value === null || value === undefined || String(value).trim() === "" || Number.isNaN(number)) return false;
  return (typeof range.min === "number" && number < range.min) || (typeof range.max === "number" && number > range.max);
}

export function rangeText(range: OfflineRange, unit: string): string | null {
  if (!range) return null;
  const sign = (value: number) => (unit === "°C" && value > 0 ? `+${value}` : String(value));
  const { min, max } = range;
  if (typeof min === "number" && typeof max === "number") return `${sign(min)}…${sign(max)} ${unit}`;
  if (typeof min === "number") return `от ${sign(min)} ${unit}`;
  if (typeof max === "number") return `до ${sign(max)} ${unit}`;
  return null;
}

/** Number typed by a person («4,5») → number, or null when empty / not a number. */
export function parseTypedNumber(raw: string): number | null {
  const text = raw.trim().replace(",", ".").replace(/^\+/, "");
  if (text === "" || !/^-?\d+(\.\d+)?$/.test(text)) return null;
  return Number(text);
}

export function fieldsNeedingCorrection(schema: TaskFormSchema, values: OfflineValues): TaskFormField[] {
  return schema.fields.filter((field) => field.type === "number" && isOutOfRange(values[field.key], field.normalRange));
}

/** Short value summary for the queue list: «Температура 4 · Чисто: да». */
export function summarizeValues(schema: TaskFormSchema | null, values: OfflineValues, limit: number = 3): string {
  if (!schema) return "";
  const parts: string[] = [];
  for (const field of schema.fields) {
    const value = values[field.key];
    if (value === null || value === undefined || value === "" || field.type === "photo" || field.type === "signature") continue;
    const label = field.label.replace(/\s*\(.*?\)\s*$/, "");
    if (field.type === "boolean") {
      if (value === true) parts.push(label);
    } else if (field.type === "select") {
      parts.push(field.options.find((option) => option.value === value)?.label ?? String(value));
    } else {
      parts.push(`${label}: ${value}${field.type === "number" && field.unit ? ` ${field.unit}` : ""}`);
    }
    if (parts.length >= limit) break;
  }
  return parts.join(" · ");
}

/* ------------------------------------------------------------------
 * «Что заполнено сегодня» on the home screen
 * ---------------------------------------------------------------- */

export type OfflineTodayState = "done" | "queued" | "todo";

const countsToday = (item: OfflineQueueItem) => item.status !== "rejected" && (item.target.kind !== "journal" || item.target.day === null);

/** A sticker object today: filled (by the pack), waiting on this device, or not yet. */
export function objectTodayMark(object: OfflinePackObject, queue: readonly OfflineQueueItem[]): { state: OfflineTodayState; summary: string | null } {
  const queued = queue.some((item) => countsToday(item) && item.target.kind === object.kind && item.target.objectId === object.id);
  if (queued) return { state: "queued", summary: null };
  return object.today?.done ? { state: "done", summary: object.today.summary || null } : { state: "todo", summary: null };
}

export type OfflineJournalMark = {
  state: OfflineTodayState;
  /** Rows filled today out of the rows of the journal; `null` for journals without a fixed list of rows. */
  rows: { done: number; total: number } | null;
  /** Records made today (journals where every record is a new row, and per-employee journals). */
  count: number;
};

export function journalTodayMark(journal: OfflinePackJournal, queue: readonly OfflineQueueItem[], todayKey: string): OfflineJournalMark {
  const queuedToday = queue.filter((item) => countsToday(item) && item.target.kind === "journal" && item.target.code === journal.code);
  const queuedRows = new Set(queuedToday.map((item) => (item.target.kind === "journal" ? `${item.target.documentId}|${item.target.rowKey}` : "")));
  let total = 0;
  let done = 0;
  let count = 0;
  let fixedRows = false;
  for (const document of journal.documents) {
    if (journal.append) {
      count += document.todayCount;
      continue;
    }
    const filled = new Set(Object.entries(document.history).filter(([, days]) => Boolean(days[todayKey])).map(([rowKey]) => rowKey));
    for (const key of queuedRows) if (key.startsWith(`${document.id}|`)) filled.add(key.slice(document.id.length + 1));
    if (document.perEmployee) {
      count += filled.size;
    } else {
      fixedRows = true;
      total += document.rows.length;
      done += document.rows.filter((row) => filled.has(row.rowKey)).length;
    }
  }
  if (journal.append) count += queuedToday.length;
  const any = fixedRows ? done > 0 : count > 0;
  const complete = fixedRows ? total > 0 && done >= total : count > 0;
  return {
    // A journal with rows is "done" only when every row is filled; partly filled stays "todo" with its counter.
    state: queuedToday.length > 0 && any ? "queued" : complete ? "done" : "todo",
    rows: fixedRows ? { done, total } : null,
    count,
  };
}

/** «Сегодня заполнено: N из M» — objects that can be filled offline plus journals. */
export function offlineTodaySummary(pack: OfflinePack, queue: readonly OfflineQueueItem[]): { done: number; total: number } {
  const objects = pack.objects.filter((object) => object.fill !== "unsupported");
  const doneObjects = objects.filter((object) => objectTodayMark(object, queue).state !== "todo").length;
  const doneJournals = pack.journals.filter((journal) => journalTodayMark(journal, queue, pack.todayKey).state !== "todo").length;
  return { done: doneObjects + doneJournals, total: objects.length + pack.journals.length };
}
