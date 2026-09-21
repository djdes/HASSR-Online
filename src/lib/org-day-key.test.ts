import test from "node:test";
import assert from "node:assert/strict";

import { orgTodayKey } from "./timezone";
import { resolveDayStart } from "./today-compliance";

/**
 * Граница суток.
 *
 * С 00:00 до 03:00 по Москве процесс на сервере (он живёт в UTC) ещё во
 * вчера. Из-за этого «Сегодня» в приложении показывало вчерашнюю дату,
 * взятые задачи сохранялись под вчерашним `dateKey`, а у заведующей одна
 * и та же задача висела сразу в «Ждут проверки» и в «Ещё не взято».
 *
 * Теперь все места — экран «Сегодня», пул задач, панель контроля,
 * подтверждения — считают день одним помощником: `resolveDayStart`
 * поверх `orgTodayKey`.
 */

/** 21 сентября 2026, 00:30 по Москве — в UTC это ещё 20 сентября 21:30. */
const NIGHT_IN_MOSCOW = new Date("2026-09-20T21:30:00.000Z");

test("ночью по Москве день организации — уже сегодняшний", () => {
  assert.equal(orgTodayKey("Europe/Moscow", NIGHT_IN_MOSCOW), "2026-09-21");
  // А «сырой» UTC-день отстаёт — ровно этот разрыв и ломал экраны.
  assert.equal(NIGHT_IN_MOSCOW.toISOString().slice(0, 10), "2026-09-20");
});

test("начало дня — полночь пояса организации, выраженная как UTC-якорь", () => {
  const start = resolveDayStart("Europe/Moscow", NIGHT_IN_MOSCOW);
  assert.equal(start.toISOString(), "2026-09-21T00:00:00.000Z");
});

test("ключ дня совпадает у всех экранов, считающих его этим помощником", () => {
  const start = resolveDayStart("Europe/Moscow", NIGHT_IN_MOSCOW);
  // `/api/mini/today` отдаёт dateKey отсюда, `/api/verifications` и
  // `/api/control-board` — тоже. Ключ обязан быть один.
  assert.equal(
    start.toISOString().slice(0, 10),
    orgTodayKey("Europe/Moscow", NIGHT_IN_MOSCOW)
  );
});

test("во Владивостоке день опережает UTC — и это учтено", () => {
  // 21 сентября 09:00 по Владивостоку = 20 сентября 23:00 UTC.
  const at = new Date("2026-09-20T23:00:00.000Z");
  assert.equal(orgTodayKey("Asia/Vladivostok", at), "2026-09-21");
  assert.equal(
    resolveDayStart("Asia/Vladivostok", at).toISOString(),
    "2026-09-21T00:00:00.000Z"
  );
});

test("днём по Москве день совпадает с UTC — поведение не изменилось", () => {
  const noon = new Date("2026-09-21T09:00:00.000Z");
  assert.equal(orgTodayKey("Europe/Moscow", noon), "2026-09-21");
  assert.equal(
    resolveDayStart("Europe/Moscow", noon).toISOString(),
    "2026-09-21T00:00:00.000Z"
  );
});

test("без пояса организации откатываемся на Москву, а не на UTC", () => {
  assert.equal(
    resolveDayStart(null, NIGHT_IN_MOSCOW).toISOString(),
    "2026-09-21T00:00:00.000Z"
  );
});
