import test from "node:test";
import assert from "node:assert/strict";

import { navSectionPath, visibleNav, type NavActor, type NavFacts } from "./app-nav";

const facts: NavFacts = { checklists: true, settingsPermissions: true };
const owner: NavActor = { role: "owner", permissionPreset: "admin" };
const headChef: NavActor = { role: "head_chef", permissionPreset: "head_chef" };

const keys = (actor: NavActor, key: Parameters<typeof navSectionPath>[1]) =>
  navSectionPath(visibleNav(actor, facts), key).map((section) => section.key);

test("путь к разделу — сверху вниз по вложенности меню", () => {
  assert.deepEqual(keys(owner, "company"), ["company"]);
  assert.deepEqual(keys(owner, "points"), ["company", "points"]);
  assert.deepEqual(keys(owner, "journals"), ["company", "points", "journals"]);
  assert.deepEqual(keys(owner, "checklists"), ["monitoring", "checklists"]);
});

test("закрытый человеку родитель в путь не попадает", () => {
  // У заведующей «Моей компании» нет — «Торговые точки» стоят в главном меню.
  assert.deepEqual(keys(headChef, "journals"), ["points", "journals"]);
});

test("невидимый раздел — пустой путь", () => {
  assert.deepEqual(navSectionPath([], "journals"), []);
});
