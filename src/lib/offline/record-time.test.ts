import assert from "node:assert/strict";
import { test } from "node:test";

import { decideOfflineTime, recentDateKeys } from "./record-time";

const now = new Date("2026-11-10T12:00:00.000Z");

test("record lands on the day it was made in the organization time zone, not the sync day", () => {
  // 21:30 UTC on the 8th is 00:30 on the 9th in Moscow.
  const moscow = decideOfflineTime({ recordedAtRaw: "2026-11-08T21:30:00.000Z", timeZone: "Europe/Moscow", now });
  assert.equal(moscow.ok && moscow.dateKey, "2026-11-09");
  const utc = decideOfflineTime({ recordedAtRaw: "2026-11-08T21:30:00.000Z", timeZone: "UTC", now });
  assert.equal(utc.ok && utc.dateKey, "2026-11-08");
  // Device offset in the ISO string does not matter — the instant does.
  const offset = decideOfflineTime({ recordedAtRaw: "2026-11-09T02:30:00+05:00", timeZone: "Europe/Moscow", now });
  assert.equal(offset.ok && offset.dateKey, "2026-11-09");
});

test("future beyond 10 minutes is refused, a small clock drift is fine", () => {
  assert.equal(decideOfflineTime({ recordedAtRaw: "2026-11-10T12:09:00.000Z", timeZone: "UTC", now }).ok, true);
  assert.deepEqual(decideOfflineTime({ recordedAtRaw: "2026-11-10T12:11:00.000Z", timeZone: "UTC", now }), { ok: false, code: "future" });
});

test("31 days are accepted, older is refused", () => {
  assert.equal(decideOfflineTime({ recordedAtRaw: "2026-10-10T12:00:01.000Z", timeZone: "UTC", now }).ok, true);
  assert.deepEqual(decideOfflineTime({ recordedAtRaw: "2026-10-10T11:59:00.000Z", timeZone: "UTC", now }), { ok: false, code: "too-old" });
});

test("missing or broken time", () => {
  assert.deepEqual(decideOfflineTime({ recordedAtRaw: "", timeZone: "UTC", now }), { ok: false, code: "bad-time" });
  assert.deepEqual(decideOfflineTime({ recordedAtRaw: "вчера", timeZone: "UTC", now }), { ok: false, code: "bad-time" });
});

test("past-day edit keeps the edited day", () => {
  const edit = decideOfflineTime({ recordedAtRaw: "2026-11-10T09:00:00.000Z", targetDay: "2026-11-03", timeZone: "UTC", now });
  assert.equal(edit.ok && edit.dateKey, "2026-11-03");
  assert.deepEqual(decideOfflineTime({ recordedAtRaw: "2026-11-10T09:00:00.000Z", targetDay: "2026-11-11", timeZone: "UTC", now }), { ok: false, code: "bad-day" });
  assert.deepEqual(decideOfflineTime({ recordedAtRaw: "2026-11-10T09:00:00.000Z", targetDay: "2026-02-30", timeZone: "UTC", now }), { ok: false, code: "bad-day" });
  assert.deepEqual(decideOfflineTime({ recordedAtRaw: "2026-11-10T09:00:00.000Z", targetDay: "2026-10-01", timeZone: "UTC", now }), { ok: false, code: "too-old" });
});

test("recent days list", () => {
  const days = recentDateKeys("2026-11-02", 3);
  assert.deepEqual(days, ["2026-11-02", "2026-11-01", "2026-10-31", "2026-10-30"]);
});
