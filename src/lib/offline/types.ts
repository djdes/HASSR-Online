/**
 * Shared contract of offline work: what the server puts into the offline
 * pack, what the device keeps in its queue and which headers accompany a
 * record made without network. Types and constants only — safe for the
 * browser bundle and for the server.
 */
import type { TaskFormSchema } from "@/lib/tasksflow-adapters/task-form";

import type { OfflineValues } from "./merge";
import type { OfflinePinVerifier } from "./pin-verifier";
import type { OfflineTimeError } from "./record-time";

export const OFFLINE_RECORDED_AT_HEADER = "x-offline-recorded-at";
/** Journal day of a past-day edit (`YYYY-MM-DD`); absent — the day of the record itself. */
export const OFFLINE_DAY_HEADER = "x-offline-day";
export const OFFLINE_AUTH_HEADER = "x-offline-auth";
export const OFFLINE_PIN_FP_HEADER = "x-offline-pin-fp";

/** How the author was confirmed on the device: own PIN, picked from the list, or the signed-in account itself. */
export type OfflineAuthKind = "pin" | "list" | "self";

export type OfflineRejectCode =
  | "offline-login"
  | "offline-other-org"
  | `offline-time-${OfflineTimeError}`
  | "offline-employee"
  | "offline-pin-changed"
  | "offline-pin-required"
  | "offline-not-self"
  | "offline-in-flight";

/** Refusals that a fresh PIN entry (online) can fix. */
export const OFFLINE_PIN_REJECT_CODES: readonly string[] = ["offline-pin-changed", "offline-pin-required"];

export const OFFLINE_PACK_VERSION = 1;
/** The cabinet refreshes the pack on open, but not more often than this. */
export const OFFLINE_PACK_MIN_REFRESH_MS = 15 * 60 * 1000;
/** Path of the offline screen; starts with `/mini` so the cabinet service worker (scope `/mini`) serves it. */
export const OFFLINE_APP_PATH = "/mini-offline";

export type OfflinePackEmployee = {
  id: string;
  name: string;
  positionTitle: string | null;
  hasPin: boolean;
  /** Offline verifier of the PIN; null — no PIN, or it cannot be checked without network. */
  pin: OfflinePinVerifier | null;
  /** Fingerprint of the PIN the verifier was made from; sent back with the record. */
  pinFp: string | null;
  isManagement: boolean;
};

export type OfflinePackRow = { rowKey: string; label: string; sublabel?: string; responsibleUserId: string | null };

export type OfflinePackDocument = {
  id: string;
  title: string;
  building: string | null;
  buildingId: string | null;
  dateFrom: string;
  dateTo: string;
  /** One row per employee (hygiene, health): the row is the employee who fills. */
  perEmployee: boolean;
  rows: OfflinePackRow[];
  /** Form of each row (per-employee documents: one form per employee row key). */
  forms: Record<string, TaskFormSchema>;
  /** Employees who may fill this document (its point), as on the online QR page. */
  employeeIds: string[];
  /** Saved values of the last 31 days: `rowKey → day → values` ("one row per day" journals only). */
  history: Record<string, Record<string, OfflineValues>>;
};

export type OfflinePackJournal = {
  code: string;
  name: string;
  /** Every record is a new row (brakerage, acceptance) — no past-day editing, no merge. */
  append: boolean;
  /** Journal QR token used when the record is delivered. */
  token: string;
  documents: OfflinePackDocument[];
};

export type OfflineObjectFill = "temperature" | "climate" | "uv" | "unsupported";

export type OfflinePackObject = {
  kind: "equipment" | "room";
  id: string;
  name: string;
  /** Workshop / building line under the name. */
  place: string | null;
  buildingId: string | null;
  token: string;
  fill: OfflineObjectFill;
  /** Why the object cannot be filled offline (fryer, no active journal). */
  unsupportedReason?: string;
  temperature: { min: number | null; max: number | null } | null;
  humidity: { min: number | null; max: number | null } | null;
  /** The organization requires a photo of the reading — impossible without network. */
  photoRequired: boolean;
  /** Employees who may fill this object (its point and "who fills" list). */
  employeeIds: string[];
};

export type OfflinePack = {
  version: number;
  generatedAt: string;
  user: { id: string; name: string };
  organization: { id: string; name: string; timeZone: string; qrFillMode: "public" | "pin" | "auth" };
  todayKey: string;
  employees: OfflinePackEmployee[];
  journals: OfflinePackJournal[];
  objects: OfflinePackObject[];
};

export type OfflineQueueTarget =
  | { kind: "journal"; code: string; documentId: string; rowKey: string; day: string | null }
  | { kind: "equipment" | "room"; objectId: string; action: "temperature" | "climate" | "uv-on" | "uv-off" };

export type OfflineQueueStatus = "pending" | "rejected" | "conflict";

export type OfflineQueueItem = {
  /** Also the idempotency key — the same for every delivery attempt. */
  id: string;
  /** Account signed in on the device when the record was made; only its session may deliver it. */
  ownerUserId: string;
  organizationId: string;
  employeeId: string;
  employeeName: string;
  auth: OfflineAuthKind;
  pinFp: string | null;
  /** ISO time of the device at the moment of saving. */
  recordedAt: string;
  target: OfflineQueueTarget;
  url: string;
  body: Record<string, unknown>;
  /** What the person sees in the list: «Холодильник №2 · +4 °C». */
  label: string;
  sublabel: string;
  status: OfflineQueueStatus;
  attempts: number;
  /** Server "try later" answers in a row (5xx); after a few the record is shown as not delivered. */
  serverFailures?: number;
  nextAttemptAt: number;
  lastError: string | null;
  lastCode: string | null;
  conflicts?: Array<{ key: string; label: string; mine: unknown; theirs: unknown }>;
};

export type OfflineSyncSummary = { sent: number; rejected: number; conflicts: number; pending: number; foreign: number };
