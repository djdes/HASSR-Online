/**
 * What to do with a queued offline record after a delivery attempt. Pure —
 * this is where "the record is never lost silently" is decided, so it is
 * under test.
 */
import { OFFLINE_PIN_REJECT_CODES, type OfflineQueueItem } from "./types";

export type OfflineDeliveryResult =
  | { kind: "network" }
  | { kind: "http"; status: number; body: { error?: unknown; code?: unknown; conflicts?: unknown } | null };

export type OfflineDeliveryDecision =
  /** Accepted — drop from the queue. */
  | { kind: "done" }
  /** Accepted, but some fields kept the server value — the person decides. */
  | { kind: "conflict"; conflicts: NonNullable<OfflineQueueItem["conflicts"]> }
  /** Try again later by itself (no network, server trouble, not signed in). */
  | { kind: "retry"; error: string | null; code: string | null }
  /** The server refused — stays visible until the person acts. */
  | { kind: "rejected"; error: string; code: string | null };

const RETRY_STEPS_MS = [5_000, 15_000, 60_000, 5 * 60_000, 15 * 60_000];

export function offlineRetryDelayMs(attempts: number): number {
  return RETRY_STEPS_MS[Math.min(Math.max(attempts, 1), RETRY_STEPS_MS.length) - 1];
}

function parseConflicts(raw: unknown): NonNullable<OfflineQueueItem["conflicts"]> {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item) => ({
      key: String(item.key ?? ""),
      label: String(item.label ?? item.key ?? ""),
      mine: item.mine,
      theirs: item.theirs,
    }))
    .filter((item) => item.key !== "");
}

/**
 * How many times in a row the server may answer "try later" before the record is shown
 * as not delivered. Without a limit a request the server can never accept (it keeps
 * answering 500) would be retried forever while the person believes it is on its way.
 */
export const OFFLINE_MAX_SERVER_RETRIES = 5;

/**
 * @param attempts delivery attempts made before this one
 */
export function decideOfflineDelivery(result: OfflineDeliveryResult, attempts: number = 0): OfflineDeliveryDecision {
  if (result.kind === "network") return { kind: "retry", error: null, code: null };
  const { status, body } = result;
  const error = typeof body?.error === "string" && body.error.trim() ? body.error.trim() : null;
  const code = typeof body?.code === "string" ? body.code : null;

  if (status >= 200 && status < 300) {
    const conflicts = parseConflicts(body?.conflicts);
    return conflicts.length > 0 ? { kind: "conflict", conflicts } : { kind: "done" };
  }
  // Not signed in: the record waits for the account, it is not refused.
  if (code === "offline-login") return { kind: "retry", error: error ?? "Войдите в кабинет — запись отправится после входа", code };
  // Too many requests, a duplicate still in flight, server errors — the same request can succeed later.
  if (status === 429 || status === 408 || status >= 500 || code === "offline-in-flight") {
    // No network and "sign in" never count: those are not the server refusing the record.
    if (status >= 500 && attempts + 1 >= OFFLINE_MAX_SERVER_RETRIES) {
      return { kind: "rejected", error: error ?? `Сервер не принимает запись (${status})`, code: code ?? "offline-server-error" };
    }
    return { kind: "retry", error, code };
  }
  return { kind: "rejected", error: error ?? `Сервер не принял запись (${status})`, code };
}

/** The refusal can be fixed by entering the employee's current PIN. */
export function needsPinReentry(item: Pick<OfflineQueueItem, "status" | "lastCode">): boolean {
  return item.status === "rejected" && OFFLINE_PIN_REJECT_CODES.includes(item.lastCode ?? "");
}

/** Only the account that was signed in when the record was made may deliver it. */
export function canDeliverOfflineItem(ownerUserId: string | null | undefined, currentUserId: string | null | undefined): boolean {
  return Boolean(ownerUserId) && ownerUserId === currentUserId;
}
