import assert from "node:assert/strict";
import test from "node:test";

import { computeMonth, daysInMonth, normalizeValues, parseCell, parseMoney, remaining, shiftMonth, weekday } from "./staff-timesheet";

test("ячейка: часы с шагом 0,25, статусы, пусто — стереть, мусор — ошибка", () => {
  assert.equal(parseCell("8"), 8);
  assert.equal(parseCell("7,5"), 7.5);
  assert.equal(parseCell(" б "), "Б");
  assert.equal(parseCell(""), undefined);
  assert.equal(parseCell("25"), null);
  assert.equal(parseCell("abc"), null);
  assert.equal(parseMoney("-500"), -500);
  assert.equal(parseMoney(""), 0);
  assert.equal(parseMoney("x"), null);
});

test("расчёт: 1–15 — аванс, 16–конец — расчёт; ставка 600 ₽/ч, премия и штраф", () => {
  const values = normalizeValues({ "1": 8, "15": 4, "16": 8, "20": "Б", "31": 2, p1: 1000, p2: -300, junk: 5 });
  const t = computeMonth(values, 600, "2026-11");
  assert.equal(daysInMonth("2026-11"), 30);
  // 31 ноября нет — день не считается.
  assert.deepEqual(t.period1, { hours: 12, earned: 7200, bonus: 1000, due: 8200 });
  assert.deepEqual(t.period2, { hours: 8, earned: 4800, bonus: -300, due: 4500 });
  assert.equal(t.due, 12700);
  assert.equal(t.statuses.Б, 1);
  assert.equal(remaining(8200, 5000), 3200);
  assert.equal(remaining(8200, 9000), 0);
});

test("календарь месяца", () => {
  assert.equal(weekday("2026-11", 11), 3); // среда
  assert.equal(shiftMonth("2026-01", -1), "2025-12");
  assert.equal(shiftMonth("2026-12", 1), "2027-01");
});
