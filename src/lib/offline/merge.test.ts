import assert from "node:assert/strict";
import { test } from "node:test";

import { mergeOfflineValues, sameOfflineValue } from "./merge";

test("changes that do not overlap are both kept", () => {
  const result = mergeOfflineValues({
    base: { temp: 4, note: null, ok: true },
    mine: { temp: 5, note: null, ok: true },
    theirs: { temp: 4, note: "проверено", ok: true },
  });
  assert.deepEqual(result.merged, { temp: 5, note: "проверено", ok: true });
  assert.deepEqual(result.conflicts, []);
  assert.deepEqual(result.taken, ["temp"]);
  assert.deepEqual(result.kept, ["note"]);
});

test("the same edit on both sides is not a conflict", () => {
  const result = mergeOfflineValues({ base: { temp: 4 }, mine: { temp: "6" }, theirs: { temp: 6 } });
  assert.deepEqual(result.merged, { temp: "6" });
  assert.deepEqual(result.conflicts, []);
});

test("different edits of one field: journal keeps the server value, the rest merges", () => {
  const result = mergeOfflineValues({
    base: { temp: 4, note: null },
    mine: { temp: 5, note: "дверь открыта" },
    theirs: { temp: 7, note: null },
  });
  assert.deepEqual(result.merged, { temp: 7, note: "дверь открыта" });
  assert.deepEqual(result.conflicts, [{ key: "temp", mine: 5, theirs: 7 }]);
});

test("a record appeared on the server while the device was offline", () => {
  // The device saw an empty row (no base values) and filled it; meanwhile someone filled it online.
  const result = mergeOfflineValues({ base: {}, mine: { temp: 5, ok: true }, theirs: { temp: 3, ok: true } });
  assert.deepEqual(result.conflicts, [{ key: "temp", mine: 5, theirs: 3 }]);
  assert.equal(result.merged.temp, 3);
  // Nothing on the server — the device record is simply written.
  const fresh = mergeOfflineValues({ base: {}, mine: { temp: 5 }, theirs: {} });
  assert.deepEqual(fresh.merged, { temp: 5 });
  assert.deepEqual(fresh.conflicts, []);
});

test("force writes the device values", () => {
  const result = mergeOfflineValues({ base: { temp: 4 }, mine: { temp: 5 }, theirs: { temp: 7 }, force: true });
  assert.deepEqual(result.merged, { temp: 5 });
  assert.deepEqual(result.conflicts, []);
});

test("empty values compare equal, numbers compare by value", () => {
  assert.equal(sameOfflineValue("", null), true);
  assert.equal(sameOfflineValue(undefined, "  "), true);
  assert.equal(sameOfflineValue("4.0", 4), true);
  assert.equal(sameOfflineValue(false, null), false);
  assert.equal(sameOfflineValue("да", "нет"), false);
});
