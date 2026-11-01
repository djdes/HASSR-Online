import assert from "node:assert/strict";
import test from "node:test";

import {
  SHARED_OBJECT_OFFICE_ERROR,
  canEditObjectAt,
  objectInScope,
  objectPointError,
  objectScopeIds,
  objectSelectable,
  staffInObjectScope,
} from "./point-objects";
import { BUILDING_OUT_OF_SCOPE_ERROR } from "./point-scope";

const ORG = ["office", "A", "B"];
const pointManagerA = { pointScope: ["A"] };
const companyWide = { pointScope: null };

test("руководитель точки правит объекты только своей точки; общий объект — офис", () => {
  assert.equal(canEditObjectAt(pointManagerA, "A"), true);
  assert.equal(canEditObjectAt(pointManagerA, "B"), false);
  assert.equal(canEditObjectAt(pointManagerA, null), false);
  assert.equal(objectPointError(pointManagerA, "B"), BUILDING_OUT_OF_SCOPE_ERROR);
  assert.equal(objectPointError(pointManagerA, null), SHARED_OBJECT_OFFICE_ERROR);
  assert.equal(objectPointError(pointManagerA, "A"), null);
});

test("руководство на всю компанию правит любые объекты, как раньше", () => {
  for (const id of ["A", "B", null, undefined]) {
    assert.equal(canEditObjectAt(companyWide, id), true);
    assert.equal(objectPointError(companyWide, id), null);
    assert.equal(objectPointError(undefined, id), null);
  }
});

test("область окна: точки человека в пределах руководителя точки; точки выключены — без ограничения", () => {
  assert.equal(objectScopeIds({ enabled: false, personBuildingIds: ["A"], actor: pointManagerA }), null);
  assert.deepEqual([...objectScopeIds({ enabled: true, personBuildingIds: ["A", "B"], actor: pointManagerA })!], ["A"]);
  assert.deepEqual([...objectScopeIds({ enabled: true, personBuildingIds: ORG, actor: companyWide })!], ORG);
});

test("объект в области: своя точка — да, чужая — нет, общий и неизвестной точки — да", () => {
  const scope = new Set(["A"]);
  assert.equal(objectInScope(scope, ORG, "A"), true);
  assert.equal(objectInScope(scope, ORG, "B"), false);
  assert.equal(objectInScope(scope, ORG, null), true);
  assert.equal(objectInScope(scope, ORG, "deleted"), true);
  assert.equal(objectInScope(null, ORG, "B"), true);
});

test("выбор в окне: руководителю точки общие цеха не предлагаем, остальным — да", () => {
  const scope = new Set(["A"]);
  assert.equal(objectSelectable(pointManagerA, scope, ORG, "A"), true);
  assert.equal(objectSelectable(pointManagerA, scope, ORG, "B"), false);
  assert.equal(objectSelectable(pointManagerA, scope, ORG, null), false);
  assert.equal(objectSelectable(companyWide, new Set(ORG), ORG, null), true);
  assert.equal(objectSelectable(companyWide, null, ORG, "B"), true);
});

test("люди окна: работают на точке области; «на всех точках» и только удалённые точки — тоже", () => {
  const scope = new Set(["A"]);
  assert.equal(staffInObjectScope(scope, ORG, ["A"]), true);
  assert.equal(staffInObjectScope(scope, ORG, ["B"]), false);
  assert.equal(staffInObjectScope(scope, ORG, ["office"]), false);
  assert.equal(staffInObjectScope(scope, ORG, []), true);
  assert.equal(staffInObjectScope(scope, ORG, ["deleted"]), true);
  assert.equal(staffInObjectScope(null, ORG, ["B"]), true);
});
