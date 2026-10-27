import test from "node:test";
import assert from "node:assert/strict";

import { disabledAfter, planPointJournalToggle, type PointJournalSets } from "./point-journals";

/** Набор точки, как его читает `getDisabledJournalCodes`: свой, иначе организации. */
function effective(sets: PointJournalSets, plan: ReturnType<typeof planPointJournalToggle>, id: string): string[] {
  const own = plan.buildings.find((building) => building.id === id)?.disabled;
  if (own) return [...own].sort();
  const before = sets.buildings.find((building) => building.id === id)?.disabled;
  return [...(before ?? plan.orgDisabled)].sort();
}

const sets: PointJournalSets = {
  orgDisabled: ["fryer", "ppe"],
  buildings: [
    { id: "a", disabled: null },
    { id: "b", disabled: null },
    { id: "office", disabled: ["fryer", "ppe", "cleaning"] },
  ],
};

test("включить журнал одной точке — другие точки не меняются", () => {
  const plan = planPointJournalToggle(sets, "a", "fryer", true);
  assert.deepEqual(effective(sets, plan, "a"), ["ppe"]);
  assert.deepEqual(effective(sets, plan, "b"), ["fryer", "ppe"]);
  assert.deepEqual(effective(sets, plan, "office"), ["cleaning", "fryer", "ppe"]);
  // У организации выключено только то, что выключено везде.
  assert.deepEqual(plan.orgDisabled, ["ppe"]);
  // Пишем точку и тех, кто жил набором организации; офис со своим набором — не трогаем.
  assert.deepEqual(plan.buildings.map((building) => building.id).sort(), ["a", "b"]);
});

test("убрать журнал одной точке — другие точки его сохраняют", () => {
  const plan = planPointJournalToggle(sets, "b", "hygiene", false);
  assert.deepEqual(effective(sets, plan, "b"), ["fryer", "hygiene", "ppe"]);
  assert.deepEqual(effective(sets, plan, "a"), ["fryer", "ppe"]);
  assert.deepEqual(disabledAfter(plan, sets, "b").sort(), ["fryer", "hygiene", "ppe"]);
  assert.deepEqual(plan.orgDisabled.sort(), ["fryer", "ppe"]);
});

test("повтор — без изменений и без дублей", () => {
  const plan = planPointJournalToggle(sets, "a", "ppe", false);
  assert.deepEqual(effective(sets, plan, "a"), ["fryer", "ppe"]);
});

test("без деления по точкам — меняется набор организации, точки не пишутся", () => {
  const plan = planPointJournalToggle(sets, null, "ppe", true);
  assert.deepEqual(plan.orgDisabled, ["fryer"]);
  assert.deepEqual(plan.buildings, []);
  assert.deepEqual(disabledAfter(plan, sets, null), ["fryer"]);
});

test("чужая точка — ошибка", () => {
  assert.throws(() => planPointJournalToggle(sets, "zzz", "ppe", true));
});
