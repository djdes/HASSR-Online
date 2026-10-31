import assert from "node:assert/strict";
import test from "node:test";

import { areaPointWhere, checklistAssignmentAtPoint, journalEntryPointWhere, lossPointWhere } from "./point-filters";

test("без точки — без фильтра", () => {
  assert.deepEqual(journalEntryPointWhere(null), {});
  assert.deepEqual(lossPointWhere(null, ["a"]), {});
  assert.deepEqual(areaPointWhere(undefined), {});
});

test("записи журнала точки: её цех, общий цех, без цеха — по оборудованию, без цеха и оборудования", () => {
  assert.deepEqual(journalEntryPointWhere("A"), {
    OR: [
      { areaId: null, equipmentId: null },
      { area: { OR: [{ buildingId: "A" }, { buildingId: null }] } },
      { areaId: null, equipment: { area: { OR: [{ buildingId: "A" }, { buildingId: null }] } } },
    ],
  });
});

test("потери точки: её цеха и без цеха", () => {
  // Своя точка записи (акт списания iiko) главнее цеха; без точки — по цеху.
  assert.deepEqual(lossPointWhere("A", ["area-a", "area-shared"]), {
    OR: [{ buildingId: "A" }, { buildingId: null, areaId: null }, { buildingId: null, areaId: { in: ["area-a", "area-shared"] } }],
  });
});

test("чек-листы: назначение на другую точку и на сотрудника другой точки не видно", () => {
  const people = new Map<string, string[]>([
    ["anna", ["A"]],
    ["boris", ["B"]],
    ["vera", []],
    ["old", ["deleted"]],
  ]);
  const live = new Set(["A", "B"]);
  const at = (targetKind: string, targetId: string) => checklistAssignmentAtPoint({ targetKind, targetId }, "A", people, live);
  assert.equal(at("building", "A"), true);
  assert.equal(at("building", "B"), false);
  assert.equal(at("user", "anna"), true);
  assert.equal(at("user", "boris"), false);
  assert.equal(at("user", "vera"), true);
  assert.equal(at("user", "old"), true);
  assert.equal(at("position", "cooks"), true);
  assert.equal(checklistAssignmentAtPoint(null, "A", people, live), true);
  assert.equal(checklistAssignmentAtPoint({ targetKind: "building", targetId: "B" }, null, people, live), true);
});
