import assert from "node:assert/strict";
import test from "node:test";
import { capList, clampRange, instantForDateKey, resolveDateKey } from "./dates";

test("resolveDateKey без даты — сегодня по часовому поясу организации", () => {
  const r = resolveDateKey(undefined, "Asia/Kamchatka", new Date("2026-10-16T12:45:00Z"));
  assert.deepEqual(r, { ok: true, dateKey: "2026-10-17" });
});

test("resolveDateKey отвергает несуществующую дату и чужой формат", () => {
  assert.equal(resolveDateKey("2026-02-30", null).ok, false);
  assert.equal(resolveDateKey("16.10.2026", null).ok, false);
  assert.deepEqual(resolveDateKey("2026-10-16", null), { ok: true, dateKey: "2026-10-16" });
});

test("instantForDateKey попадает в тот же календарный день для UTC+2 и UTC+12", () => {
  const i = instantForDateKey("2026-10-16");
  for (const tz of ["Europe/Kaliningrad", "Asia/Kamchatka"]) {
    assert.equal(new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(i), "2026-10-16");
  }
});

test("clampRange: по умолчанию 7 дней до сегодня; больше 31 дня — ошибка; обрезка периодом документа", () => {
  assert.deepEqual(
    clampRange({ todayKey: "2026-10-16", docFrom: "2026-10-01", docTo: "2026-10-31", defaultDays: 7, maxDays: 31 }),
    { ok: true, from: "2026-10-10", to: "2026-10-16" }
  );
  assert.equal(
    clampRange({ from: "2026-08-01", to: "2026-10-16", todayKey: "2026-10-16", docFrom: "2026-01-01", docTo: "2026-12-31", defaultDays: 7, maxDays: 31 }).ok,
    false
  );
  assert.deepEqual(
    clampRange({ from: "2026-09-25", to: "2026-10-05", todayKey: "2026-10-16", docFrom: "2026-10-01", docTo: "2026-10-31", defaultDays: 7, maxDays: 31 }),
    { ok: true, from: "2026-10-01", to: "2026-10-05" }
  );
});

test("capList: обрезает и ставит truncated", () => {
  assert.deepEqual(capList([1, 2, 3], 2), { items: [1, 2], truncated: true });
  assert.deepEqual(capList([1], 2), { items: [1], truncated: false });
});
