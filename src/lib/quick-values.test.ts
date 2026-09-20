import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { quickValues } from "./quick-values";

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
