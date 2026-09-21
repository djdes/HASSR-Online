import assert from "node:assert/strict";
import { test } from "node:test";
import {
  resolveDayStart,
  rollupConfigDocumentForDay,
  rollupStaffJournalDay,
} from "./today-compliance";

/**
 * Граница суток в статусе «заполнено сегодня».
 *
 * На проде процесс живёт в UTC. Повар, заполняющий журнал в час ночи по
 * Москве, попадает в UTC-вчера — и его запись, легшая в сегодняшнюю дату,
 * не засчитывалась. Ровно это и проверяем.
 */

test("час ночи по Москве — это уже сегодня, а не UTC-вчера", () => {
  // 29 августа 01:30 МСК = 28 августа 22:30 UTC.
  const now = new Date("2026-08-28T22:30:00.000Z");
  const day = resolveDayStart("Europe/Moscow", now);
  assert.equal(day.toISOString(), "2026-08-29T00:00:00.000Z");
});

test("дневное время в московской зоне даёт тот же день", () => {
  const now = new Date("2026-08-28T16:12:00.000Z"); // 19:12 МСК
  const day = resolveDayStart("Europe/Moscow", now);
  assert.equal(day.toISOString(), "2026-08-28T00:00:00.000Z");
});

test("камчатская зона: вечер UTC — уже завтра", () => {
  // 28 августа 20:00 UTC = 29 августа 08:00 на Камчатке (UTC+12).
  const now = new Date("2026-08-28T20:00:00.000Z");
  const day = resolveDayStart("Asia/Kamchatka", now);
  assert.equal(day.toISOString(), "2026-08-29T00:00:00.000Z");
});

test("UTC-полночь — это явно названный день, его не сдвигаем", () => {
  // Так отчёт за период и сертификат перебирают даты в цикле. Сдвиг
  // сломал бы им нумерацию дней.
  const explicit = new Date("2026-08-15T00:00:00.000Z");
  assert.equal(
    resolveDayStart("Asia/Kamchatka", explicit).toISOString(),
    "2026-08-15T00:00:00.000Z",
  );
});

test("пустая зона — откат на Москву, а не падение", () => {
  const now = new Date("2026-08-28T22:30:00.000Z");
  assert.equal(
    resolveDayStart(null, now).toISOString(),
    "2026-08-29T00:00:00.000Z",
  );
});

test("cleaning rooms-mode: помещения берутся из selectedRoomIds", () => {
  const config = {
    cleaningMode: "rooms",
    rooms: [],
    selectedRoomIds: ["r1", "r2"],
    matrix: { r1: { "2026-09-02": "T" }, r2: { "2026-09-02": "G" } },
  };
  assert.deepEqual(rollupConfigDocumentForDay("cleaning", config, "2026-09-02"), {
    todayCount: 2,
    expectedCount: 2,
    filled: true,
  });
  assert.equal(rollupConfigDocumentForDay("cleaning", config, "2026-09-03")?.filled, false);
});

/**
 * Журнал здоровья в выходной: сотрудник, у которого сегодня выходной,
 * отпуск или больничный, подпись не ставит. Раньше строгая проверка
 * требовала отметку от всех из ростера — при выходных Сб-Вс счётчик был
 * красным всю субботу и воскресенье.
 */
test("выходной сотрудника не держит журнал здоровья красным", () => {
  const entries = [
    { dayKey: "2026-09-18", employeeId: "u1" },
    { dayKey: "2026-09-18", employeeId: "u2" },
    { dayKey: "2026-09-18", employeeId: "u3" },
    { dayKey: "2026-09-19", employeeId: "u1" },
    { dayKey: "2026-09-19", employeeId: "u2" },
  ];
  const withoutSchedule = rollupStaffJournalDay({
    entries,
    todayKey: "2026-09-19",
    offTodayEmployeeIds: new Set(),
  });
  assert.equal(withoutSchedule.filled, false, "без графика — как раньше");

  const withDayOff = rollupStaffJournalDay({
    entries,
    todayKey: "2026-09-19",
    offTodayEmployeeIds: new Set(["u3"]),
  });
  assert.deepEqual(withDayOff, { todayCount: 2, expectedCount: 2, filled: true });
});

test("если сегодня не работает никто — день считается закрытым", () => {
  const rollup = rollupStaffJournalDay({
    entries: [
      { dayKey: "2026-09-18", employeeId: "u1" },
      { dayKey: "2026-09-18", employeeId: "u2" },
    ],
    todayKey: "2026-09-19",
    offTodayEmployeeIds: new Set(["u1", "u2"]),
  });
  assert.deepEqual(rollup, { todayCount: 0, expectedCount: 0, filled: true });
});

test("отметка работающего сотрудника не теряется среди выходных", () => {
  const rollup = rollupStaffJournalDay({
    entries: [
      { dayKey: "2026-09-18", employeeId: "u1" },
      { dayKey: "2026-09-18", employeeId: "u2" },
      { dayKey: "2026-09-19", employeeId: "u1" },
      // Пустая строка выходного сотрудника всё равно лежит в документе.
      { dayKey: "2026-09-19", employeeId: "u2" },
    ],
    todayKey: "2026-09-19",
    offTodayEmployeeIds: new Set(["u2"]),
  });
  assert.deepEqual(rollup, { todayCount: 1, expectedCount: 1, filled: true });
});

test("нет истории — достаточно одной записи за сегодня", () => {
  assert.equal(
    rollupStaffJournalDay({
      entries: [{ dayKey: "2026-09-19", employeeId: "u1" }],
      todayKey: "2026-09-19",
      offTodayEmployeeIds: new Set(),
    }).filled,
    true
  );
});

test("журналы с одной записью на день не сравнивают число строк со вчера", async () => {
  const { isStrictCompletenessJournal } = await import("./today-compliance");
  // Холодильники/климат: fillMode по умолчанию per-employee, но запись
  // одна на день — достаточно любой записи за сегодня.
  assert.equal(isStrictCompletenessJournal("cold_equipment_control", "per-employee"), false);
  assert.equal(isStrictCompletenessJournal("climate_control", undefined), false);
  // Кадровые журналы — по-прежнему строгие.
  assert.equal(isStrictCompletenessJournal("hygiene", "single"), true);
  assert.equal(isStrictCompletenessJournal("health_check", null), true);
  // Прочие — как настроено в fillMode.
  assert.equal(isStrictCompletenessJournal("incoming_control", "per-employee"), true);
  assert.equal(isStrictCompletenessJournal("incoming_control", "single"), false);
});
