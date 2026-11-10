/**
 * Delivery of records made without network. Client only.
 *
 * Each queued record is the same request the QR page would send, plus the
 * `x-offline-*` headers (when it was made, how the author was confirmed)
 * and its id as the idempotency key, so a repeat never writes twice.
 */
import { listOfflineQueue, newOfflineId, putOfflineQueueItem, removeOfflineQueueItem } from "./store";
import { canDeliverOfflineItem, decideOfflineDelivery, offlineRetryDelayMs } from "./sync-policy";
import {
  OFFLINE_AUTH_HEADER,
  OFFLINE_DAY_HEADER,
  OFFLINE_PIN_FP_HEADER,
  OFFLINE_RECORDED_AT_HEADER,
  type OfflineQueueItem,
  type OfflineSyncSummary,
} from "./types";

let flushing: Promise<OfflineSyncSummary> | null = null;

async function deliver(item: OfflineQueueItem): Promise<void> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Idempotency-Key": item.id,
    [OFFLINE_RECORDED_AT_HEADER]: item.recordedAt,
    [OFFLINE_AUTH_HEADER]: item.auth,
  };
  if (item.pinFp) headers[OFFLINE_PIN_FP_HEADER] = item.pinFp;
  if (item.target.kind === "journal" && item.target.day) headers[OFFLINE_DAY_HEADER] = item.target.day;

  let decision;
  try {
    const response = await fetch(item.url, { method: "POST", headers, body: JSON.stringify(item.body), credentials: "same-origin" });
    const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    // Sticker endpoints name the reason `errorCode`, the journal endpoint — `code`.
    const code = body?.code ?? body?.errorCode;
    decision = decideOfflineDelivery({ kind: "http", status: response.status, body: body ? { ...body, code } : null });
  } catch {
    decision = decideOfflineDelivery({ kind: "network" });
  }

  if (decision.kind === "done") {
    await removeOfflineQueueItem(item.id);
    return;
  }
  const attempts = item.attempts + 1;
  if (decision.kind === "conflict") {
    await putOfflineQueueItem({ ...item, status: "conflict", attempts, conflicts: decision.conflicts, lastError: null, lastCode: null });
  } else if (decision.kind === "rejected") {
    await putOfflineQueueItem({ ...item, status: "rejected", attempts, lastError: decision.error, lastCode: decision.code });
  } else {
    await putOfflineQueueItem({
      ...item,
      status: "pending",
      attempts,
      nextAttemptAt: Date.now() + offlineRetryDelayMs(attempts),
      lastError: decision.error,
      lastCode: decision.code,
    });
  }
}

async function flush(currentUserId: string | null): Promise<OfflineSyncSummary> {
  const before = await listOfflineQueue();
  const beforeIds = new Set(before.map((item) => item.id));
  let foreign = 0;
  for (const item of before) {
    if (!canDeliverOfflineItem(item.ownerUserId, currentUserId)) {
      foreign++;
      continue;
    }
    if (item.status !== "pending" || item.nextAttemptAt > Date.now()) continue;
    await deliver(item);
  }
  const after = await listOfflineQueue();
  const mine = after.filter((item) => canDeliverOfflineItem(item.ownerUserId, currentUserId));
  return {
    sent: [...beforeIds].filter((id) => !after.some((item) => item.id === id)).length,
    rejected: mine.filter((item) => item.status === "rejected").length,
    conflicts: mine.filter((item) => item.status === "conflict").length,
    pending: mine.filter((item) => item.status === "pending").length,
    foreign,
  };
}

/** Sends everything that is due. Concurrent calls share one run. */
export function flushOfflineQueue(currentUserId: string | null): Promise<OfflineSyncSummary> {
  if (!flushing) {
    flushing = flush(currentUserId).finally(() => {
      flushing = null;
    });
  }
  return flushing;
}

/** «Повторить»: clear the delay and the refusal, try again on the next flush. */
export async function retryOfflineItem(item: OfflineQueueItem, patch: Partial<OfflineQueueItem> = {}): Promise<void> {
  await putOfflineQueueItem({ ...item, ...patch, status: "pending", nextAttemptAt: Date.now(), lastError: null, lastCode: null });
}

/**
 * «Записать моё»: the person saw the conflict and chose the device value.
 * A new id is required — the first delivery was accepted, and its stored
 * answer would be replayed for the old idempotency key.
 */
export async function forceOfflineItem(item: OfflineQueueItem): Promise<void> {
  await removeOfflineQueueItem(item.id);
  await putOfflineQueueItem({
    ...item,
    id: newOfflineId(),
    body: { ...item.body, force: true },
    status: "pending",
    attempts: 0,
    nextAttemptAt: Date.now(),
    conflicts: undefined,
    lastError: null,
    lastCode: null,
  });
}
