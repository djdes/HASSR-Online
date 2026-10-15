import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  openNextEditable,
  sequentialEditProgress,
} from "./sequential-edit";

describe("sequential-edit", () => {
  it("opens the first row and skips rows that disappeared", () => {
    const opened: string[] = [];
    const open = (id: string) => {
      if (id === "b") return false;
      opened.push(id);
      return true;
    };
    assert.equal(openNextEditable(["a", "b", "c"], 0, open), 0);
    assert.equal(openNextEditable(["a", "b", "c"], 1, open), 2);
    assert.deepEqual(opened, ["a", "c"]);
  });

  it("returns -1 when nothing is left to open", () => {
    assert.equal(openNextEditable(["a", "b"], 2, () => true), -1);
    assert.equal(openNextEditable(["a", "b"], 0, () => false), -1);
    assert.equal(openNextEditable([], 0, () => true), -1);
  });

  it("returns numeric progress independent of display language", () => {
    assert.equal(sequentialEditProgress(null), null);
    assert.equal(sequentialEditProgress({ ids: ["a"], index: 0, done: 0 }), null);
    assert.deepEqual(sequentialEditProgress({ ids: ["a", "b", "c"], index: 2, done: 1 }), { current: 2, total: 3 });
  });
});
