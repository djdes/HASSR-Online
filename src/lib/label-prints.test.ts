import assert from "node:assert/strict";
import test from "node:test";

import {
  labelPeriodStart,
  labelStatus,
  parseLabelPeriod,
  readLabelFields,
} from "./label-prints";

const NOW = new Date("2026-10-31T09:00:00.000Z");
const TODAY = new Date("2026-10-30T21:00:00.000Z"); // полночь 31.10 по Москве
const hours = (n: number) => new Date(NOW.getTime() + n * 60 * 60 * 1000);

test("status follows the date printed on the label", () => {
  assert.equal(labelStatus(null, NOW), "none");
  assert.equal(labelStatus(hours(30), NOW), "ok");
  assert.equal(labelStatus(hours(24), NOW), "soon");
  assert.equal(labelStatus(hours(0.5), NOW), "soon");
  assert.equal(labelStatus(NOW, NOW), "expired");
  assert.equal(labelStatus(hours(-3), NOW), "expired");
});

test("period starts at the organization's midnight", () => {
  assert.equal(parseLabelPeriod("7d"), "7d");
  assert.equal(parseLabelPeriod("year"), "today");
  assert.equal(parseLabelPeriod(undefined), "today");
  assert.equal(labelPeriodStart("today", TODAY).toISOString(), "2026-10-30T21:00:00.000Z");
  assert.equal(labelPeriodStart("7d", TODAY).toISOString(), "2026-10-24T21:00:00.000Z");
  assert.equal(labelPeriodStart("30d", TODAY).toISOString(), "2026-10-01T21:00:00.000Z");
});

test("label fields keep only label/value string pairs", () => {
  assert.deepEqual(
    readLabelFields([
      { label: "Условия хранения", value: "+2…+6 °C" },
      { label: "Масса", value: "" },
      { label: 5, value: "x" },
      null,
      "text",
    ]),
    [{ label: "Условия хранения", value: "+2…+6 °C" }],
  );
  assert.deepEqual(readLabelFields(null), []);
  assert.deepEqual(readLabelFields({ label: "a", value: "b" }), []);
});
