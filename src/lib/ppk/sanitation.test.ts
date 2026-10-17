import test from "node:test";
import assert from "node:assert/strict";

import { dueState, labNextDate } from "./sanitation";

test("labNextDate: последняя дата плюс периодичность в месяцах; без последней даты — null", () => {
  assert.equal(labNextDate({ lastDate: "2026-10-01", everyMonths: 3 }), "2027-01-01");
  assert.equal(labNextDate({ lastDate: "2026-06-15", everyMonths: 6 }), "2026-12-15");
  assert.equal(labNextDate({ lastDate: null, everyMonths: 3 }), null);
});

test("labNextDate: конец месяца не выходит за его пределы", () => {
  assert.equal(labNextDate({ lastDate: "2026-01-31", everyMonths: 1 }), "2026-02-28");
  assert.equal(labNextDate({ lastDate: "2028-01-31", everyMonths: 1 }), "2028-02-29");
});

test("labNextDate: переход через год", () => {
  assert.equal(labNextDate({ lastDate: "2026-11-30", everyMonths: 24 }), "2028-11-30");
  assert.equal(labNextDate({ lastDate: "2026-12-10", everyMonths: 2 }), "2027-02-10");
});

test("dueState: без даты → none, дата раньше сегодня → overdue", () => {
  assert.equal(dueState(null, "2026-10-17"), "none");
  assert.equal(dueState("2026-10-16", "2026-10-17"), "overdue");
});

test("dueState: сегодня и ближайшие 14 дней → soon, дальше → ok", () => {
  assert.equal(dueState("2026-10-17", "2026-10-17"), "soon");
  assert.equal(dueState("2026-10-31", "2026-10-17"), "soon");
  assert.equal(dueState("2026-11-01", "2026-10-17"), "ok");
  assert.equal(dueState("2027-03-01", "2026-10-17"), "ok");
});
