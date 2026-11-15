import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_SBER_SCHEDULE, nextSberSync, parseSberSchedule, sberIntervalLabel, sberSyncDue } from "@/lib/sber/schedule";

test("настройки: по умолчанию включено, 10 минут; мусор не принимаем", () => {
  assert.deepEqual(parseSberSchedule(null), DEFAULT_SBER_SCHEDULE);
  assert.deepEqual(parseSberSchedule("{"), DEFAULT_SBER_SCHEDULE);
  assert.deepEqual(parseSberSchedule(JSON.stringify({ enabled: false, intervalMinutes: 7 })), { enabled: false, intervalMinutes: 10 });
  assert.deepEqual(parseSberSchedule(JSON.stringify({ enabled: true, intervalMinutes: 60 })), { enabled: true, intervalMinutes: 60 });
});

test("пора ли сверять", () => {
  const now = new Date("2026-11-15T10:13:05Z");
  const s = { enabled: true, intervalMinutes: 10 } as const;
  assert.equal(sberSyncDue(s, null, now), true);
  assert.equal(sberSyncDue(s, "2026-11-15T10:03:20Z", now), true, "крон :03 → :13 — интервал 10 выдерживается");
  assert.equal(sberSyncDue(s, "2026-11-15T10:08:00Z", now), false);
  assert.equal(sberSyncDue({ enabled: true, intervalMinutes: 60 }, "2026-11-15T09:13:10Z", now), true);
  assert.equal(sberSyncDue({ enabled: true, intervalMinutes: 60 }, "2026-11-15T09:30:00Z", now), false);
  assert.equal(sberSyncDue({ enabled: false, intervalMinutes: 10 }, null, now), false);
});

test("следующая сверка — на шаге крона", () => {
  const next = nextSberSync({ enabled: true, intervalMinutes: 30 }, "2026-11-15T10:03:10Z", new Date("2026-11-15T10:05:00Z"));
  assert.equal(next?.toISOString(), "2026-11-15T10:33:00.000Z");
  assert.equal(nextSberSync({ enabled: false, intervalMinutes: 30 }, null, new Date()), null);
  assert.equal(sberIntervalLabel(5), "каждые 5 мин");
  assert.equal(sberIntervalLabel(60), "каждый час");
  assert.equal(sberIntervalLabel(240), "каждые 4 ч");
});
