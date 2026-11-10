import assert from "node:assert/strict";
import { test } from "node:test";

import { isOfflineDeviceStale, offlineDeviceLabel, offlineDeviceState, parseOfflineHeartbeat, shouldNotifyStuck } from "./devices";

const now = new Date("2026-11-10T12:00:00.000Z");
const hoursAgo = (hours: number) => new Date(now.getTime() - hours * 3600_000);

test("heartbeat is validated and clamped", () => {
  const ok = parseOfflineHeartbeat({ deviceKey: "abcdefghijklmnop1234", packAt: "2026-11-10T11:00:00.000Z", pending: 3.9, stuck: -2, delivered: 5 }, now);
  assert.deepEqual(ok, { deviceKey: "abcdefghijklmnop1234", packAt: new Date("2026-11-10T11:00:00.000Z"), pending: 3, stuck: 0, delivered: 5 });
  assert.equal(parseOfflineHeartbeat({ deviceKey: "short" }, now), null);
  assert.equal(parseOfflineHeartbeat({ deviceKey: "has spaces and <tags> in it!" }, now), null);
  assert.equal(parseOfflineHeartbeat(null, now), null);
  // A pack "from the future" is dropped, huge numbers are clamped.
  const odd = parseOfflineHeartbeat({ deviceKey: "abcdefghijklmnop1234", packAt: "2030-01-01T00:00:00Z", pending: 1e9, delivered: 1e9 }, now);
  assert.deepEqual(odd, { deviceKey: "abcdefghijklmnop1234", packAt: null, pending: 10_000, stuck: 0, delivered: 1000 });
});

test("device label", () => {
  const chrome = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36";
  assert.equal(offlineDeviceLabel(`${chrome} WeSetupApp/1.1.0 (android)`), "Приложение WeSetup 1.1.0 (Android)");
  assert.equal(offlineDeviceLabel(chrome), "Chrome (Android)");
  assert.equal(offlineDeviceLabel(null), "Браузер");
});

test("refused records: told once a day while there are any", () => {
  assert.equal(shouldNotifyStuck({ stuck: 0, stuckNotifiedAt: null, now }), false);
  assert.equal(shouldNotifyStuck({ stuck: 2, stuckNotifiedAt: null, now }), true);
  assert.equal(shouldNotifyStuck({ stuck: 2, stuckNotifiedAt: hoursAgo(3), now }), false);
  assert.equal(shouldNotifyStuck({ stuck: 2, stuckNotifiedAt: hoursAgo(25), now }), true);
});

test("silent device: only one that really works offline, once per silence, not forever", () => {
  const base = { deliveredCount: 4, staleNotifiedAt: null, now };
  assert.equal(isOfflineDeviceStale({ ...base, lastSeenAt: hoursAgo(5) }), false);
  assert.equal(isOfflineDeviceStale({ ...base, lastSeenAt: hoursAgo(30) }), true);
  // Never delivered an offline record — a personal phone, not a kitchen tablet.
  assert.equal(isOfflineDeviceStale({ ...base, deliveredCount: 0, lastSeenAt: hoursAgo(30) }), false);
  // Already told about this silence.
  assert.equal(isOfflineDeviceStale({ ...base, lastSeenAt: hoursAgo(30), staleNotifiedAt: hoursAgo(2) }), false);
  // Came back after the notification and went silent again — tell again.
  assert.equal(isOfflineDeviceStale({ ...base, lastSeenAt: hoursAgo(30), staleNotifiedAt: hoursAgo(80) }), true);
  // Two weeks of silence — the device is out of use.
  assert.equal(isOfflineDeviceStale({ ...base, lastSeenAt: hoursAgo(15 * 24) }), false);
});

test("device state for the manager's list", () => {
  assert.equal(offlineDeviceState({ lastSeenAt: hoursAgo(1), pendingCount: 0, stuckCount: 0, now }), "ok");
  assert.equal(offlineDeviceState({ lastSeenAt: hoursAgo(1), pendingCount: 2, stuckCount: 0, now }), "waiting");
  assert.equal(offlineDeviceState({ lastSeenAt: hoursAgo(1), pendingCount: 2, stuckCount: 1, now }), "stuck");
  assert.equal(offlineDeviceState({ lastSeenAt: hoursAgo(30), pendingCount: 0, stuckCount: 0, now }), "silent");
});
