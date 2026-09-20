import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { normFromLabel, quickValues, stampFor, stepNumber, stepTime } from "./quick-values";

describe("quickValues", () => {
  it("gives the norm bounds and the middle", () => {
    assert.deepEqual(quickValues(2, 6), ["2", "4", "6"]);
    assert.deepEqual(quickValues(40, 60), ["40", "50", "60"]);
    assert.deepEqual(quickValues(2, 5), ["2", "3.5", "5"]);
  });

  it("orders a reversed freezer norm and collapses a point norm", () => {
    assert.deepEqual(quickValues(-18, -20), ["-20", "-19", "-18"]);
    assert.deepEqual(quickValues(4, 4), ["4"]);
  });

  it("returns nothing without both bounds", () => {
    assert.deepEqual(quickValues(null, 6), []);
    assert.deepEqual(quickValues(2, undefined), []);
  });
});

describe("normFromLabel", () => {
  it("reads and orders the norm from the label", () => {
    assert.deepEqual(normFromLabel("Холодильник №1 · норма 2…6"), { min: 2, max: 6 });
    assert.deepEqual(normFromLabel("Морозильный ларь №4 · норма -18…-20"), { min: -20, max: -18 });
    assert.equal(normFromLabel("Температура"), null);
  });
});

describe("stepNumber", () => {
  it("lands in the middle of the norm from an empty field, then steps by one", () => {
    assert.equal(stepNumber("", -1, -20, -18), "-19");
    assert.equal(stepNumber("-19", -1, -20, -18), "-20");
    assert.equal(stepNumber("-19", 1), "-18");
    assert.equal(stepNumber("", 1), "0");
    assert.equal(stepNumber("3,5", 1), "4.5");
    assert.equal(stepNumber("-", 1, 2, 6), "4");
  });
});

describe("stepTime", () => {
  it("steps minutes and wraps around midnight", () => {
    assert.equal(stepTime("10:00", 5), "10:05");
    assert.equal(stepTime("00:02", -5), "23:57");
    assert.equal(stepTime("23:58", 5), "00:03");
    assert.equal(stepTime("", 5, new Date(2026, 8, 20, 18, 31)), "18:36");
  });
});

describe("stampFor", () => {
  it("formats date and time in the organization timezone", () => {
    assert.deepEqual(stampFor("Europe/Moscow", new Date(Date.UTC(2026, 8, 20, 15, 31))), { date: "20.09.2026", time: "18:31" });
  });
});
