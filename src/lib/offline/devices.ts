/**
 * Rules about devices that work without network: what a heartbeat may
 * contain, how a device is named and when somebody should be told about
 * it. Pure — the database part lives in `devices.server.ts`.
 */
import { parseMobileAppUserAgent } from "@/lib/mobile-app";

export const OFFLINE_HEARTBEAT_MIN_MS = 5 * 60 * 1000;
/** Refused records are reported to people at most once a day per device. */
export const OFFLINE_STUCK_NOTIFY_EVERY_MS = 24 * 60 * 60 * 1000;
/** A device that used to deliver offline records and went silent for this long is "not in touch". */
export const OFFLINE_DEVICE_STALE_MS = 24 * 60 * 60 * 1000;
/** …but a device silent for longer than this is simply not in use any more. */
export const OFFLINE_DEVICE_FORGET_MS = 14 * 24 * 60 * 60 * 1000;

export type OfflineHeartbeat = {
  deviceKey: string;
  packAt: Date | null;
  pending: number;
  stuck: number;
  delivered: number;
};

const count = (value: unknown, max: number): number => {
  const number = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : 0;
  return Math.min(Math.max(number, 0), max);
};

/** Validates what the device reports about itself; `null` — not a heartbeat. */
export function parseOfflineHeartbeat(raw: unknown, now: Date = new Date()): OfflineHeartbeat | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const body = raw as Record<string, unknown>;
  const deviceKey = typeof body.deviceKey === "string" ? body.deviceKey.trim() : "";
  if (!/^[A-Za-z0-9_-]{16,80}$/.test(deviceKey)) return null;
  let packAt: Date | null = null;
  if (typeof body.packAt === "string" || typeof body.packAt === "number") {
    const parsed = new Date(body.packAt);
    // A pack cannot be from the future; such a stamp is dropped, not trusted.
    if (!Number.isNaN(parsed.getTime()) && parsed.getTime() <= now.getTime() + 60_000) packAt = parsed;
  }
  return { deviceKey, packAt, pending: count(body.pending, 10_000), stuck: count(body.stuck, 10_000), delivered: count(body.delivered, 1000) };
}

/** Human name of the device from its User-Agent: the app with its version, or the browser family. */
export function offlineDeviceLabel(userAgent: string | null | undefined): string {
  const ua = userAgent ?? "";
  const app = parseMobileAppUserAgent(ua);
  const system = /Android/i.test(ua) ? "Android" : /iPhone|iPad|iPod/i.test(ua) ? "iOS" : /Windows/i.test(ua) ? "Windows" : /Mac OS X/i.test(ua) ? "macOS" : /Linux/i.test(ua) ? "Linux" : "";
  if (app) return `Приложение WeSetup ${app.version} (${app.platform === "ios" ? "iOS" : "Android"})`;
  const browser = /YaBrowser/i.test(ua) ? "Яндекс Браузер" : /Edg\//i.test(ua) ? "Edge" : /Firefox\//i.test(ua) ? "Firefox" : /Chrome\//i.test(ua) ? "Chrome" : /Safari\//i.test(ua) ? "Safari" : "Браузер";
  return system ? `${browser} (${system})` : browser;
}

/** Tell people that some records were not accepted? At most once a day per device, and only while there are any. */
export function shouldNotifyStuck(input: { stuck: number; stuckNotifiedAt: Date | null; now: Date }): boolean {
  if (input.stuck <= 0) return false;
  if (!input.stuckNotifiedAt) return true;
  return input.now.getTime() - input.stuckNotifiedAt.getTime() >= OFFLINE_STUCK_NOTIFY_EVERY_MS;
}

/**
 * Is the device "not in touch"? Only devices that really work offline count
 * (they delivered at least one offline record) — a phone that merely opened
 * the cabinet once must not page the manager on its owner's day off. One
 * notification per silence: after it the device has to come back first.
 */
export function isOfflineDeviceStale(input: { lastSeenAt: Date; deliveredCount: number; staleNotifiedAt: Date | null; now: Date }): boolean {
  if (input.deliveredCount <= 0) return false;
  const silent = input.now.getTime() - input.lastSeenAt.getTime();
  if (silent < OFFLINE_DEVICE_STALE_MS || silent > OFFLINE_DEVICE_FORGET_MS) return false;
  return !input.staleNotifiedAt || input.staleNotifiedAt.getTime() < input.lastSeenAt.getTime();
}

export type OfflineDeviceState = "ok" | "waiting" | "stuck" | "silent";

/** One word for the manager's list. */
export function offlineDeviceState(input: { lastSeenAt: Date; pendingCount: number; stuckCount: number; now: Date }): OfflineDeviceState {
  if (input.stuckCount > 0) return "stuck";
  if (input.now.getTime() - input.lastSeenAt.getTime() >= OFFLINE_DEVICE_STALE_MS) return "silent";
  return input.pendingCount > 0 ? "waiting" : "ok";
}
