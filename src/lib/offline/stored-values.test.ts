import assert from "node:assert/strict";
import { test } from "node:test";

import { employeeIdOfRowKey, storedRowValues } from "./stored-values";

test("hygiene, new form: the three signed statements", () => {
  const data = { status: "healthy", temperatureAbove37: false, confirmations: { temperature: true, infection: true, respiratorySkin: false }, source: "manual" };
  assert.deepEqual(storedRowValues("hygiene", data, ["temperature", "infection", "respiratorySkin"]), { temperature: true, infection: true, respiratorySkin: false });
});

test("hygiene, old form: status and temperature flag", () => {
  assert.deepEqual(storedRowValues("hygiene", { status: "day_off", temperatureAbove37: null }, ["status", "temperatureAbove37"]), { status: "day_off", temperatureAbove37: null });
  // An old-form entry read with the new form's keys shares nothing — unreadable, not "all empty".
  assert.equal(storedRowValues("hygiene", { status: "healthy" }, ["temperature", "infection", "respiratorySkin"]), null);
});

test("health check", () => {
  assert.deepEqual(storedRowValues("health_check", { signed: true, measures: " отстранён " }, ["signed", "measures"]), { signed: true, measures: "отстранён" });
  assert.deepEqual(storedRowValues("health_check", { signed: null, measures: null }, ["signed", "measures"]), { signed: null, measures: null });
});

test("cleaning and ventilation checklist: done procedures are the present ones", () => {
  const data = { procedures: { disinfection: ["14:00"], wet_cleaning: [] }, responsibleUserId: "u1" };
  assert.deepEqual(storedRowValues("cleaning_ventilation_checklist", data, ["proc_disinfection", "proc_ventilation", "proc_wet_cleaning"]), {
    proc_disinfection: true,
    proc_ventilation: false,
    proc_wet_cleaning: true,
  });
});

test("other journals and broken data are not read", () => {
  assert.equal(storedRowValues("cleaning", { anything: 1 }, ["a"]), null);
  assert.equal(storedRowValues("hygiene", null, ["temperature"]), null);
  assert.equal(storedRowValues("hygiene", ["x"], ["temperature"]), null);
});

test("row key of an employee", () => {
  assert.equal(employeeIdOfRowKey("employee-u1"), "u1");
  assert.equal(employeeIdOfRowKey("employee-"), null);
  assert.equal(employeeIdOfRowKey("row-area-1"), null);
});
