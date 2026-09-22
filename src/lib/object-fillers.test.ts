import assert from "node:assert/strict";
import test from "node:test";

import { canFillObject, filterAllowedFillers } from "./object-fillers";

test("пустой список «Кто заполняет» — может любой", () => {
  assert.equal(canFillObject([], { id: "u1", role: "cook" }), true);
  assert.equal(canFillObject(null, { id: "u1", role: "cook" }), true);
});

test("закреплённый — может; чужой — нет даже при верном PIN", () => {
  assert.equal(canFillObject(["u1"], { id: "u1", role: "cook" }), true);
  assert.equal(canFillObject(["u1"], { id: "u2", role: "cook" }), false);
});

test("руководство и «Разрешение менять настройки» — без ограничений", () => {
  assert.equal(canFillObject(["u1"], { id: "m", role: "manager" }), true);
  assert.equal(canFillObject(["u1"], { id: "h", role: "head_chef" }), true);
  assert.equal(canFillObject(["u1"], { id: "s", role: "cook", canManageSettings: true }), true);
});

test("список на наклейке — только закреплённые и руководство", () => {
  const people = [
    { id: "u1", role: "cook" },
    { id: "u2", role: "cook" },
    { id: "m", role: "manager" },
  ];
  assert.deepEqual(filterAllowedFillers(people, ["u1"]).map((p) => p.id), ["u1", "m"]);
  assert.deepEqual(filterAllowedFillers(people, []).map((p) => p.id), ["u1", "u2", "m"]);
});
