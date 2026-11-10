/**
 * Delivery of records made without network. Client only.
 *
 * Each queued record is the same request the QR page would send, plus the
 * `x-offline-*` headers (when it was made, how the author was confirmed)
 * and its id as the idempotency key, so a repeat never writes twice.
 */
import { listOfflineQueue, newOfflineId, putOfflineQueueItem, removeOfflineQueueItem } from "./store";
import { photoSlotsOf, withPhotoLinks } from "./photo-slots";
import { canDeliverOfflineItem, decideOfflineDelivery, offlineRetryDelayMs } from "./sync-policy";
import {
  OFFLINE_AUTH_HEADER,
  OFFLINE_DAY_HEADER,
  OFFLINE_PIN_FP_HEADER,
  OFFLINE_READING_PHOTO_SLOT,
  OFFLINE_RECORDED_AT_HEADER,
  type OfflineQueueItem,
  type OfflineSyncSummary,
} from "./types";

let flushing: Promise<OfflineSyncSummary> | null = null;

type PhotoOutcome =
  | { ok: true; item: OfflineQueueItem }
  | { ok: false; kind: "network"; item: OfflineQueueItem }
  | { ok: false; kind: "rejected"; item: OfflineQueueItem; error: string; code: string };

function offlineHeaders(item: OfflineQueueItem): Record<string, string> {
  const headers: Record<string, string> = {
    [OFFLINE_RECORDED_AT_HEADER]: item.recordedAt,
    [OFFLINE_AUTH_HEADER]: item.auth,
  };
  if (item.pinFp) headers[OFFLINE_PIN_FP_HEADER] = item.pinFp;
  if (item.target.kind === "journal" && item.target.day) headers[OFFLINE_DAY_HEADER] = item.target.day;
  return headers;
}

/**
 * Photos go first: a record that points at a file which is not on the
 * server is worse than one more attempt later. Each uploaded link is saved
 * into the queue item at once, so a retry never uploads the same photo twice.
 */
async function uploadPhotos(item: OfflineQueueItem): Promise<PhotoOutcome> {
  const slots = photoSlotsOf(item.body);
  if (slots.length === 0) return { ok: true, item };
  let current = item;
  for (const slot of slots) {
    if (current.photoUrls?.[slot]) continue;
    const blob = current.photos?.[slot];
    if (!blob) return { ok: false, kind: "rejected", item: current, error: "Фото потеряно — запишите заново со снимком", code: "offline-photo-lost" };
    const form = new FormData();
    let url: string;
    if (slot === OFFLINE_READING_PHOTO_SLOT && current.target.kind !== "journal") {
      url = "/api/qr-fill/reading-photo";
      form.set("kind", current.target.kind);
      form.set("objectId", current.target.objectId);
      form.set("token", String(current.body.token ?? ""));
      form.set("employeeId", current.employeeId);
      form.set("photo", blob, "reading.jpg");
    } else {
      url = "/api/mini/attachments";
      form.set("file", blob, "photo.jpg");
    }
    let response: Response;
    try {
      response = await fetch(url, { method: "POST", headers: offlineHeaders(current), body: form, credentials: "same-origin" });
    } catch {
      return { ok: false, kind: "network", item: current };
    }
    const json = (await response.json().catch(() => null)) as { url?: unknown; error?: unknown; code?: unknown; errorCode?: unknown } | null;
    if (!response.ok || typeof json?.url !== "string") {
      const code = typeof json?.code === "string" ? json.code : typeof json?.errorCode === "string" ? json.errorCode : null;
      // Not signed in, busy or failing server — the photo is fine, try later.
      if (response.status === 401 || response.status === 429 || response.status >= 500 || code === "offline-login") return { ok: false, kind: "network", item: current };
      return { ok: false, kind: "rejected", item: current, error: typeof json?.error === "string" ? json.error : "Сервер не принял фото", code: code?.startsWith("offline-") ? code : "offline-photo-rejected" };
    }
    current = { ...current, photoUrls: { ...(current.photoUrls ?? {}), [slot]: json.url } };
    await putOfflineQueueItem(current);
  }
  return { ok: true, item: current };
}

async function deliver(queued: OfflineQueueItem): Promise<void> {
  const photos = await uploadPhotos(queued);
  if (!photos.ok) {
    // `photos.item` keeps the links of the photos that did get uploaded.
    const attempts = queued.attempts + 1;
    if (photos.kind === "rejected") {
      await putOfflineQueueItem({ ...photos.item, status: "rejected", attempts, lastError: photos.error, lastCode: photos.code });
    } else {
      await putOfflineQueueItem({ ...photos.item, status: "pending", attempts, nextAttemptAt: Date.now() + offlineRetryDelayMs(attempts), lastError: null, lastCode: null });
    }
    return;
  }
  // The record carries links instead of the photos themselves.
  const item: OfflineQueueItem = { ...photos.item, body: withPhotoLinks(photos.item.body, photos.item.photoUrls ?? {}) };
  const headers: Record<string, string> = { "Content-Type": "application/json", "Idempotency-Key": item.id, ...offlineHeaders(item) };

  let decision;
  // The server itself failed (5xx) — counted separately from "no network" and "sign in".
  let serverError = false;
  try {
    const response = await fetch(item.url, { method: "POST", headers, body: JSON.stringify(item.body), credentials: "same-origin" });
    const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    // Sticker endpoints name the reason `errorCode`, the journal endpoint — `code`.
    const code = body?.code ?? body?.errorCode;
    serverError = response.status >= 500;
    decision = decideOfflineDelivery({ kind: "http", status: response.status, body: body ? { ...body, code } : null }, item.serverFailures ?? 0);
  } catch {
    decision = decideOfflineDelivery({ kind: "network" });
  }

  if (decision.kind === "done") {
    await removeOfflineQueueItem(item.id);
    return;
  }
  // Keep the queue item with its photo markers: a retry substitutes the links again.
  const stored = photos.item;
  const attempts = item.attempts + 1;
  if (decision.kind === "conflict") {
    await putOfflineQueueItem({ ...stored, status: "conflict", attempts, conflicts: decision.conflicts, lastError: null, lastCode: null });
  } else if (decision.kind === "rejected") {
    await putOfflineQueueItem({ ...stored, status: "rejected", attempts, lastError: decision.error, lastCode: decision.code });
  } else {
    await putOfflineQueueItem({
      ...stored,
      status: "pending",
      attempts,
      // Server errors so far; a network failure in between neither resets nor adds to it.
      serverFailures: (item.serverFailures ?? 0) + (serverError ? 1 : 0),
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
  await putOfflineQueueItem({ ...item, ...patch, status: "pending", serverFailures: 0, nextAttemptAt: Date.now(), lastError: null, lastCode: null });
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
    serverFailures: 0,
    nextAttemptAt: Date.now(),
    conflicts: undefined,
    lastError: null,
    lastCode: null,
  });
}
