import assert from "node:assert/strict";
import test from "node:test";

import { orgDayStartInstant, orgTodayKey } from "@/lib/timezone";

/**
 * Регрессия: «сегодня» в лентах дашборда считали от UTC-полуночи, и в
 * Москве с 00:00 до 03:00 в выборку попадал вчерашний вечер, а свежие
 * отметки — нет.
 */
test("Москва: ночью граница дня — местная полночь, а не UTC", () => {
  // 01:30 МСК 20 сентября = 22:30 UTC 19 сентября.
  const now = new Date("2026-09-19T22:30:00.000Z");
  assert.equal(orgTodayKey("Europe/Moscow", now), "2026-09-20");
  assert.equal(
    orgDayStartInstant("Europe/Moscow", now).toISOString(),
    "2026-09-19T21:00:00.000Z"
  );
});

test("Владивосток (UTC+10): начало дня на 10 часов раньше UTC-полуночи", () => {
  const now = new Date("2026-09-19T22:30:00.000Z");
  assert.equal(orgTodayKey("Asia/Vladivostok", now), "2026-09-20");
  assert.equal(
    orgDayStartInstant("Asia/Vladivostok", now).toISOString(),
    "2026-09-19T14:00:00.000Z"
  );
});

test("UTC: начало дня совпадает с UTC-полуночью", () => {
  const now = new Date("2026-09-19T22:30:00.000Z");
  assert.equal(
    orgDayStartInstant("UTC", now).toISOString(),
    "2026-09-19T00:00:00.000Z"
  );
});

test("переход через полночь в Москве сдвигает границу дня на сутки", () => {
  const before = orgDayStartInstant(
    "Europe/Moscow",
    new Date("2026-09-19T20:59:59.000Z")
  );
  const after = orgDayStartInstant(
    "Europe/Moscow",
    new Date("2026-09-19T21:00:01.000Z")
  );
  assert.equal(before.toISOString(), "2026-09-18T21:00:00.000Z");
  assert.equal(after.toISOString(), "2026-09-19T21:00:00.000Z");
  assert.equal(after.getTime() - before.getTime(), 24 * 60 * 60 * 1000);
});

test("неизвестная зона не роняет расчёт — откат на UTC", () => {
  const now = new Date("2026-09-19T22:30:00.000Z");
  assert.equal(
    orgDayStartInstant("Not/AZone", now).toISOString(),
    "2026-09-19T00:00:00.000Z"
  );
});
