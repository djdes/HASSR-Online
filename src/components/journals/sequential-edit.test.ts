import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  openNextEditable,
  selectionEditLabel,
  sequentialEditProgress,
  sequentialEditSummary,
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

  it("labels the button and the dialog title", () => {
    assert.equal(selectionEditLabel(1), "Изменить");
    assert.equal(selectionEditLabel(3), "Изменить по очереди · 3");
    assert.equal(sequentialEditProgress(null), null);
    assert.equal(sequentialEditProgress({ ids: ["a"], index: 0, done: 0 }), null);
    assert.equal(sequentialEditProgress({ ids: ["a", "b", "c"], index: 2, done: 1 }), "(2 из 3)");
    assert.equal(sequentialEditSummary(2, 3), "Изменено 2 из 3");
  });
});
