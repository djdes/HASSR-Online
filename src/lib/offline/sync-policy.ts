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

export function decideOfflineDelivery(result: OfflineDeliveryResult): OfflineDeliveryDecision {
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
  if (status === 429 || status === 408 || status >= 500 || code === "offline-in-flight") return { kind: "retry", error, code };
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
