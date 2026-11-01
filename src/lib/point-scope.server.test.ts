import assert from "node:assert/strict";
import test from "node:test";

import { staffInManagerScope } from "./point-scope.server";

/**
 * Люди точки (аудит точек, 2026-11-01): офис, люди без точки и закреплённые
 * за всеми точками — вся компания, их ведёт руководство компании; руководитель
 * точки им чужой, даже если среди их мест есть его точка.
 */
const withOffice = {
  enabled: true,
  buildings: [{ id: "office", kind: "office" }, { id: "A" }, { id: "B" }, { id: "C" }],
};
const withoutOffice = { enabled: true, buildings: [{ id: "A" }, { id: "B" }] };
const managerA = { pointScope: ["A"] };
const company = { pointScope: null };

test("руководитель точки: люди всей компании — чужие", () => {
  assert.equal(staffInManagerScope(managerA, withOffice, ["office", "A"]), false, "офис с точкой A — вся компания");
  assert.equal(staffInManagerScope(managerA, withOffice, []), false, "без точки — вся компания");
  assert.equal(staffInManagerScope(managerA, withOffice, ["gone"]), false, "только удалённые точки — везде");
  assert.equal(staffInManagerScope(managerA, withoutOffice, ["A", "B"]), false, "без офиса: все точки — вся компания");
});

test("руководитель точки: люди своих точек — свои, чужой точки — чужие", () => {
  assert.equal(staffInManagerScope(managerA, withOffice, ["A"]), true);
  assert.equal(staffInManagerScope(managerA, withOffice, ["A", "B"]), true, "часть точек, среди них A");
  assert.equal(staffInManagerScope(managerA, withOffice, ["B"]), false);
  assert.equal(staffInManagerScope(managerA, withoutOffice, ["A"]), true);
  assert.equal(staffInManagerScope(managerA, withoutOffice, ["B"]), false);
});

test("руководство компании ведёт любого", () => {
  for (const ids of [["office", "A"], [], ["A"], ["B"], ["A", "B"]]) {
    assert.equal(staffInManagerScope(company, withOffice, ids), true);
    assert.equal(staffInManagerScope(null, withoutOffice, ids), true);
  }
});
