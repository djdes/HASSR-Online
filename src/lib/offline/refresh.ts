/**
 * Bringing the device up to date while it is online: the offline pack,
 * today's tasks of the signed-in employee and the report the device sends
 * about itself. Client only; shared by the cabinet agent, the profile line
 * and the offline screen.
 */
import { getOfflineValue, listOfflineQueue, readStoredPack, saveOfflinePack, setOfflineValue } from "./store";
import { canDeliverOfflineItem } from "./sync-policy";
import { OFFLINE_PACK_MIN_REFRESH_MS, OFFLINE_PACK_VERSION, type OfflinePack, type OfflineTasksSnapshot } from "./types";

export const OFFLINE_TASKS_KEY = "tasks";
const DEVICE_KEY = "device-key";
const HEARTBEAT_KEY = "heartbeat";
const UNREPORTED_KEY = "delivered-unreported";
const HEARTBEAT_MIN_MS = 5 * 60 * 1000;

export type OfflineRefreshResult = "fresh" | "updated" | "failed" | "other-account";

type TodayResponse = {
  dateKey?: string;
  groups?: Array<{ code?: string; label?: string; scopes?: Array<{ scopeKey?: string; scopeLabel?: string; sublabel?: string; availability?: string; claimUserName?: string | null }> }>;
};

/** Trims `/api/mini/today` to what the offline screen shows. Pure. */
export function tasksSnapshotFrom(userId: string, raw: TodayResponse, savedAt: number): OfflineTasksSnapshot {
  const states = new Set(["available", "mine", "taken", "completed"]);
  return {
    userId,
    savedAt,
    dateKey: typeof raw.dateKey === "string" ? raw.dateKey : "",
    groups: (raw.groups ?? [])
      .map((group) => ({
        code: String(group.code ?? ""),
        label: String(group.label ?? ""),
        tasks: (group.scopes ?? [])
          .filter((scope) => typeof scope.scopeKey === "string" && scope.scopeKey)
          .map((scope) => ({
            key: String(scope.scopeKey),
            label: String(scope.scopeLabel ?? ""),
            sublabel: scope.sublabel ? String(scope.sublabel) : null,
            state: (states.has(String(scope.availability)) ? scope.availability : "available") as OfflineTasksSnapshot["groups"][number]["tasks"][number]["state"],
            by: scope.claimUserName ? String(scope.claimUserName) : null,
          })),
      }))
      .filter((group) => group.code && group.tasks.length > 0),
  };
}

async function refreshTasks(userId: string): Promise<void> {
  const response = await fetch("/api/mini/today", { credentials: "same-origin", cache: "no-store" });
  if (!response.ok) return;
  const snapshot = tasksSnapshotFrom(userId, (await response.json()) as TodayResponse, Date.now());
  await setOfflineValue(OFFLINE_TASKS_KEY, snapshot);
}

/**
 * Downloads the pack (and today's tasks) when it is missing, stale or
 * `force` is set. The pack is saved only if it belongs to `userId` — the
 * account may have changed while the request was in flight.
 */
export async function refreshOfflineData(userId: string, options: { force?: boolean } = {}): Promise<OfflineRefreshResult> {
  const stored = await readStoredPack();
  const fresh =
    stored &&
    stored.userId === userId &&
    stored.pack.version === OFFLINE_PACK_VERSION &&
    Date.now() - stored.savedAt < OFFLINE_PACK_MIN_REFRESH_MS;
  if (fresh && !options.force) return "fresh";
  let response: Response;
  try {
    response = await fetch("/api/offline/pack", { credentials: "same-origin", cache: "no-store" });
  } catch {
    return "failed";
  }
  if (!response.ok) return "failed";
  const pack = (await response.json().catch(() => null)) as OfflinePack | null;
  if (!pack?.user?.id) return "failed";
  if (pack.user.id !== userId) return "other-account";
  await saveOfflinePack(pack);
  await refreshTasks(userId).catch(() => undefined);
  return "updated";
}

async function deviceKey(): Promise<string> {
  const existing = await getOfflineValue<string>(DEVICE_KEY);
  if (existing) return existing;
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(18));
  const key = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  await setOfflineValue(DEVICE_KEY, key);
  return key;
}

/** Remembers how many offline records were delivered since the last report. */
export async function noteDeliveredRecords(count: number): Promise<void> {
  if (count <= 0) return;
  const unreported = (await getOfflineValue<number>(UNREPORTED_KEY)) ?? 0;
  await setOfflineValue(UNREPORTED_KEY, unreported + count);
}

/**
 * Tells the server how this device is doing: data age, records waiting and
 * not accepted. Sent when something changed or every few minutes — the
 * manager's list and the "device is silent" notice are built from it.
 */
export async function sendOfflineHeartbeat(userId: string): Promise<void> {
  const [stored, queue, last, unreported] = await Promise.all([
    readStoredPack(),
    listOfflineQueue(),
    getOfflineValue<{ at: number; signature: string }>(HEARTBEAT_KEY),
    getOfflineValue<number>(UNREPORTED_KEY),
  ]);
  if (!stored || stored.userId !== userId) return;
  const mine = queue.filter((item) => canDeliverOfflineItem(item.ownerUserId, userId));
  const pending = mine.filter((item) => item.status === "pending").length;
  const stuck = mine.length - pending;
  const delivered = unreported ?? 0;
  const signature = `${stored.savedAt}|${pending}|${stuck}`;
  if (last && last.signature === signature && delivered === 0 && Date.now() - last.at < HEARTBEAT_MIN_MS) return;
  const response = await fetch("/api/offline/heartbeat", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ deviceKey: await deviceKey(), packAt: new Date(stored.savedAt).toISOString(), pending, stuck, delivered }),
  });
  if (!response.ok) return;
  await setOfflineValue(HEARTBEAT_KEY, { at: Date.now(), signature });
  if (delivered > 0) await setOfflineValue(UNREPORTED_KEY, 0);
}
