import assert from "node:assert/strict";
import test from "node:test";
import { hasRecordedMeasurements } from "./journal-measurement-attribution";

test("seeded rows, assignment metadata and empty normalized slots carry no attribution", () => {
  for (const data of [null, {}, { _autoSeeded: true }, { responsibleTitle: "Повар", employeeId: "employee" }, { measurements: { room: { "08:00": { temperature: null, humidity: null } } } }, { temperatures: { fridge: null }, statuses: {} }]) assert.equal(hasRecordedMeasurements(data), false);
});
test("zero, negative measurements, humidity and maintenance statuses are recorded values", () => {
  for (const data of [{ temperatures: { fridge: 0 } }, { temperatures: { fridge: -18 } }, { measurements: { room: { "08:00": { temperature: null, humidity: 40 } } } }, { statuses: { fridge: "repair" } }]) assert.equal(hasRecordedMeasurements(data), true);
});
test("nonfinite measurements and whitespace statuses do not attribute an empty row", () => {
  assert.equal(hasRecordedMeasurements({ temperatures: { fridge: NaN }, statuses: { fridge: " " } }), false);
});
