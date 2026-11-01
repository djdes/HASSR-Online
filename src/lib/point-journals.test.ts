import test from "node:test";
import assert from "node:assert/strict";

import { disabledAfter, planJournalSetWrite, planPointJournalToggle, type PointJournalSets } from "./point-journals";

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

/** Набор места после `planJournalSetWrite`: свой из плана, иначе прежний свой, иначе организации. */
function effectiveAfterWrite(sets: PointJournalSets, plan: ReturnType<typeof planJournalSetWrite>, id: string): string[] {
  const own = plan.buildings.find((building) => building.id === id)?.disabled;
  if (own) return [...own].sort();
  const before = sets.buildings.find((building) => building.id === id)?.disabled;
  return [...(before ?? plan.orgDisabled)].sort();
}

test("настройка журналов на точке — меняется только её набор", () => {
  const plan = planJournalSetWrite(sets, "a", ["ppe"]);
  assert.deepEqual(effectiveAfterWrite(sets, plan, "a"), ["ppe"]);
  assert.deepEqual(effectiveAfterWrite(sets, plan, "b"), ["fryer", "ppe"]);
  assert.deepEqual(effectiveAfterWrite(sets, plan, "office"), ["cleaning", "fryer", "ppe"]);
  assert.deepEqual(plan.orgDisabled, ["ppe"]);
});

test("«Вся организация» — изменение доходит до точек со своим набором", () => {
  const withOwn: PointJournalSets = {
    orgDisabled: ["fryer"],
    buildings: [
      { id: "a", disabled: ["fryer", "hygiene"] },
      { id: "b", disabled: ["fryer"] },
      { id: "office", disabled: ["fryer", "cleaning"] },
    ],
  };
  // Выключили «ppe», включили «fryer» для всей организации.
  const plan = planJournalSetWrite(withOwn, null, ["ppe"]);
  assert.deepEqual(effectiveAfterWrite(withOwn, plan, "a"), ["hygiene", "ppe"]);
  assert.deepEqual(effectiveAfterWrite(withOwn, plan, "b"), ["ppe"]);
  assert.deepEqual(effectiveAfterWrite(withOwn, plan, "office"), ["cleaning", "ppe"]);
  // Свои отличия точек (hygiene у А, cleaning у офиса) сохраняются.
  assert.deepEqual(plan.orgDisabled, ["ppe"]);
});

test("«Вся организация» без своих наборов — как раньше, только организация", () => {
  const plain: PointJournalSets = { orgDisabled: ["fryer"], buildings: [{ id: "a", disabled: null }, { id: "b", disabled: null }] };
  const plan = planJournalSetWrite(plain, null, ["ppe"]);
  assert.deepEqual(plan, { orgDisabled: ["ppe"], buildings: [] });
});

test("«Вся организация»: точка без своего набора не получает лишних журналов", () => {
  // У А свой набор, где «ppe» включён; Б живёт набором организации.
  const mixed: PointJournalSets = {
    orgDisabled: [],
    buildings: [
      { id: "a", disabled: [] },
      { id: "b", disabled: null },
    ],
  };
  // Выключаем «ppe» везде, «hygiene» у А включён — организация хочет выключить «hygiene» тоже.
  const plan = planJournalSetWrite(mixed, null, ["ppe", "hygiene"]);
  assert.deepEqual(effectiveAfterWrite(mixed, plan, "a"), ["hygiene", "ppe"]);
  assert.deepEqual(effectiveAfterWrite(mixed, plan, "b"), ["hygiene", "ppe"]);
});

test("«Вся организация»: точка без своего набора получает его, если набор организации станет уже", () => {
  const mixed: PointJournalSets = {
    orgDisabled: ["hygiene"],
    buildings: [
      { id: "a", disabled: [] },
      { id: "b", disabled: null },
    ],
  };
  // Ничего не меняем, кроме «ppe»: у А «hygiene» включён, Б должен сохранить его выключенным.
  const plan = planJournalSetWrite(mixed, null, ["hygiene", "ppe"]);
  assert.deepEqual(effectiveAfterWrite(mixed, plan, "a"), ["ppe"]);
  assert.deepEqual(effectiveAfterWrite(mixed, plan, "b"), ["hygiene", "ppe"]);
  assert.deepEqual(plan.orgDisabled, ["ppe"]);
});

test("запись набора чужой точки — ошибка", () => {
  assert.throws(() => planJournalSetWrite(sets, "zzz", []));
});
