import assert from "node:assert/strict";
import { test } from "node:test";

import { changedMatrixRows, matrixRowCodes, positionPresetMatches, setMatrixRow, toggleMatrixGrant, type AccessMatrix } from "./access-matrix-state";

test("matrix edits preserve row IDs and produce the intended dirty rows and save codes", () => {
  const original: AccessMatrix = new Map([
    ["employee-1", new Set(["hygiene"])],
    ["position-1", new Set(["cleaning", "temperature"])],
  ]);
  const afterCellToggle = toggleMatrixGrant(original, "employee-1", "climate_control");
  const afterPreset = setMatrixRow(afterCellToggle, "position-1", ["cleaning", "health_check"], true);

  assert.deepEqual([...original.get("employee-1")!], ["hygiene"], "editing keeps the initialized draft immutable");
  assert.deepEqual([...changedMatrixRows(original, afterPreset)], ["employee-1", "position-1"]);
  assert.deepEqual(matrixRowCodes(afterPreset, "employee-1"), ["hygiene", "climate_control"]);
  assert.deepEqual(matrixRowCodes(afterPreset, "position-1"), ["cleaning", "health_check"]);

  const cleared = setMatrixRow(afterPreset, "position-1", ["cleaning", "health_check"], false);
  assert.deepEqual(matrixRowCodes(cleared, "position-1"), []);
  assert.ok(changedMatrixRows(original, cleared).has("position-1"));
});

test("position presets match Russian position names using stable source keywords", () => {
  assert.equal(positionPresetMatches("cleaning", "Уборщица"), true);
  assert.equal(positionPresetMatches("cleaning", "Клинер"), true);
  assert.equal(positionPresetMatches("temperature", "Повар горячего цеха"), true);
  assert.equal(positionPresetMatches("temperature", "Шеф-повар"), true);
  assert.equal(positionPresetMatches("receiving", "Товаровед"), true);
  assert.equal(positionPresetMatches("receiving", "Кладовщик"), true);
  assert.equal(positionPresetMatches("health", "Повар"), true);
  assert.equal(positionPresetMatches("cleaning", "Повар"), false);
});
