/**
 * On-device storage of offline work: the offline pack of the signed-in
 * account, the queue of records made without network and small per-device
 * state (PIN locks, the remembered employee). IndexedDB, client only.
 *
 * Personal data lives here and nowhere else on the device: the cached
 * offline screen itself is the same for everyone. Signing out wipes the
 * pack; queued records stay — they are somebody's work and are delivered
 * only under the account that was signed in when they were made.
 */
import type { OfflinePack, OfflineQueueItem } from "./types";

const DB_NAME = "wesetup-offline-app";
const DB_VERSION = 1;
const KV = "kv";
const QUEUE = "queue";
const CHANGE_EVENT = "wesetup-offline-app-change";

const PACK_KEY = "pack";

export type StoredPack = { userId: string; savedAt: number; pack: OfflinePack };

export function isOfflineStoreAvailable(): boolean {
  return typeof indexedDB !== "undefined";
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(KV)) db.createObjectStore(KV);
      if (!db.objectStoreNames.contains(QUEUE)) db.createObjectStore(QUEUE, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("indexeddb blocked"));
  });
}

async function run<T>(store: string, mode: IDBTransactionMode, work: (target: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(store, mode);
    const request = work(transaction.objectStore(store));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => db.close();
    transaction.onabort = () => {
      db.close();
      reject(transaction.error);
    };
  });
}

function notify(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

export function subscribeOfflineStore(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(CHANGE_EVENT, callback);
  return () => window.removeEventListener(CHANGE_EVENT, callback);
}

// --- key/value ---------------------------------------------------------------

export async function getOfflineValue<T>(key: string): Promise<T | null> {
  if (!isOfflineStoreAvailable()) return null;
  try {
    return ((await run<T | undefined>(KV, "readonly", (store) => store.get(key) as IDBRequest<T | undefined>)) ?? null) as T | null;
  } catch {
    return null;
  }
}

export async function setOfflineValue(key: string, value: unknown): Promise<void> {
  await run(KV, "readwrite", (store) => store.put(value, key));
}

export async function deleteOfflineValue(key: string): Promise<void> {
  await run(KV, "readwrite", (store) => store.delete(key)).catch(() => undefined);
}

// --- pack ----------------------------------------------------------------------

export async function readStoredPack(): Promise<StoredPack | null> {
  return getOfflineValue<StoredPack>(PACK_KEY);
}

export async function saveOfflinePack(pack: OfflinePack): Promise<void> {
  await setOfflineValue(PACK_KEY, { userId: pack.user.id, savedAt: Date.now(), pack } satisfies StoredPack);
  notify();
}

/** Sign-out: personal data leaves the device. Queued records are kept on purpose. */
export async function clearOfflinePack(): Promise<void> {
  if (!isOfflineStoreAvailable()) return;
  await deleteOfflineValue(PACK_KEY);
  notify();
}

// --- queue ---------------------------------------------------------------------

export async function listOfflineQueue(): Promise<OfflineQueueItem[]> {
  if (!isOfflineStoreAvailable()) return [];
  try {
    const rows = await run<OfflineQueueItem[]>(QUEUE, "readonly", (store) => store.getAll() as IDBRequest<OfflineQueueItem[]>);
    return rows.sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
  } catch {
    return [];
  }
}

export async function putOfflineQueueItem(item: OfflineQueueItem): Promise<void> {
  await run(QUEUE, "readwrite", (store) => store.put(item));
  notify();
}

export async function removeOfflineQueueItem(id: string): Promise<void> {
  await run(QUEUE, "readwrite", (store) => store.delete(id)).catch(() => undefined);
  notify();
}

export function newOfflineId(): string {
  const c = typeof globalThis !== "undefined" ? globalThis.crypto : undefined;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `o-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}${Math.random().toString(36).slice(2, 12)}`;
}
