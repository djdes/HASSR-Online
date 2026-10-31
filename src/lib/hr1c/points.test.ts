import assert from "node:assert/strict";
import test from "node:test";

import { readHrEmployeesBody } from "./api-body";
import { mergeZupEmployees } from "./odata";
import type { HrEmployee } from "./plan";
import {
  ALL_POINTS,
  collectDepartments,
  departmentKey,
  planHrPoints,
  pointsForEmployee,
  readDepartmentPointMap,
  readDepartments,
} from "./points";

// Владелец, 2026-10-31: «1С: подразделения → точки — да». Раньше принятые
// из 1С получали «все точки» и были видны в журналах и QR каждой точки.
const TODAY = "2026-10-31";
const LIVE = new Set(["A", "B"]);
const emp = (externalId: string, extra: Partial<HrEmployee> = {}): HrEmployee => ({
  externalId,
  fullName: `Сотрудник ${externalId}`,
  position: "Повар",
  hiredAt: "2026-01-10",
  dismissedAt: null,
  archived: false,
  phone: null,
  departmentId: "dep-kitchen-a",
  departmentName: "Кухня А",
  ...extra,
});

test("ключ подразделения: id из 1С, иначе нормализованное название; пустой id 1С — не подразделение", () => {
  assert.equal(departmentKey({ departmentId: "dep-1", departmentName: "Кухня" }), "dep-1");
  assert.equal(departmentKey({ departmentId: null, departmentName: "  Кухня   Ёлки " }), "name:кухня елки");
  assert.equal(departmentKey({ departmentId: "00000000-0000-0000-0000-000000000000", departmentName: null }), null);
  assert.equal(departmentKey({}), null);
});

test("карта: чужие и удалённые точки отбрасываются, «все точки» остаются", () => {
  assert.deepEqual(readDepartmentPointMap({ a: "A", b: "gone", c: ALL_POINTS, d: 5 }, LIVE), { a: "A", c: ALL_POINTS });
  assert.deepEqual(readDepartmentPointMap(null, LIVE), {});
  assert.deepEqual(pointsForEmployee(emp("1"), { "dep-kitchen-a": "A" }), ["A"]);
  assert.deepEqual(pointsForEmployee(emp("1"), { "dep-kitchen-a": ALL_POINTS }), []);
  assert.equal(pointsForEmployee(emp("1"), {}), undefined);
});

test("подразделения для экрана: только работающие, со счётчиком, по алфавиту", () => {
  const list = collectDepartments(
    [emp("1"), emp("2"), emp("3", { departmentId: "dep-b", departmentName: "Бар" }), emp("4", { dismissedAt: "2026-10-01" })],
    TODAY,
  );
  assert.deepEqual(list, [
    { key: "dep-b", name: "Бар", count: 1 },
    { key: "dep-kitchen-a", name: "Кухня А", count: 2 },
  ]);
  assert.deepEqual(readDepartments(list), list);
  assert.deepEqual(readDepartments("x"), []);
});

test("точки связанных: 1С меняет только свои точки; ручные не трогает; без сопоставления — проблема", () => {
  const employees = [
    emp("fresh"), // связан, точек нет, 1С не ставила → поставить A
    emp("own", { departmentId: "dep-b", departmentName: "Бар" }), // 1С ставила A, теперь подразделение B → B
    emp("manual"), // руководитель поставил B вручную → не трогаем
    emp("same"), // уже A и 1С ставила A → ничего
    emp("adopt"), // уже A, 1С не ставила → запомнить, без изменения
    emp("unmapped", { departmentId: "dep-x", departmentName: "Склад" }),
    emp("gone", { dismissedAt: "2026-10-30" }),
  ];
  const users = new Map(
    [
      ["u-fresh", []],
      ["u-own", ["A"]],
      ["u-manual", ["B"]],
      ["u-same", ["A"]],
      ["u-adopt", []],
      ["u-unmapped", []],
      ["u-gone", []],
    ].map(([id, buildingIds]) => [id as string, { buildingIds: buildingIds as string[], working: true }]),
  );
  // «adopt»: точки пустые, но в карте — «все точки» → уже верно, только запомнить.
  const plan = planHrPoints({
    employees: employees.map((item) => (item.externalId === "adopt" ? { ...item, departmentId: "dep-all", departmentName: "Офис" } : item)),
    userByExternal: new Map(employees.map((item) => [item.externalId, `u-${item.externalId}`])),
    users,
    setBy1c: new Map([
      ["own", ["A"]],
      ["same", ["A"]],
    ]),
    map: { "dep-kitchen-a": "A", "dep-b": "B", "dep-all": ALL_POINTS },
    livePointIds: LIVE,
    today: TODAY,
  });
  assert.deepEqual(
    plan.updates.map((update) => [update.externalId, update.buildingIds, update.changed]),
    [
      ["fresh", ["A"], true],
      ["own", ["B"], true],
      ["adopt", [], false],
    ],
  );
  assert.deepEqual(plan.problems.map((problem) => [problem.employee.externalId, problem.departmentName]), [["unmapped", "Склад"]]);
});

test("удалённая точка у сотрудника не считается: 1С ставила только её — снова управляет", () => {
  const plan = planHrPoints({
    employees: [emp("x")],
    userByExternal: new Map([["x", "u-x"]]),
    users: new Map([["u-x", { buildingIds: ["deleted"], working: true }]]),
    setBy1c: new Map(),
    map: { "dep-kitchen-a": "A" },
    livePointIds: LIVE,
    today: TODAY,
  });
  assert.deepEqual(plan.updates.map((update) => update.buildingIds), [["A"]]);
});

test("OData: подразделение из кадровых данных и его название; без справочника — только id", () => {
  const employees = [{ Ref_Key: "e1", Description: "Иванова Мария", DeletionMark: false, ВАрхиве: false }];
  const hr = [{ Сотрудник_Key: "e1", ДатаПриема: "2026-01-01T00:00:00", ДатаУвольнения: "0001-01-01T00:00:00", ТекущаяДолжность_Key: "p1", ТекущееПодразделение_Key: "d1" }];
  const [withNames] = mergeZupEmployees(employees, hr, [{ Ref_Key: "p1", Description: "Повар" }], [{ Ref_Key: "d1", Description: "Кухня №4" }]);
  assert.equal(withNames.departmentId, "d1");
  assert.equal(withNames.departmentName, "Кухня №4");
  const [noCatalog] = mergeZupEmployees(employees, hr, []);
  assert.equal(noCatalog.departmentId, "d1");
  assert.equal(noCatalog.departmentName, null);
});

test("API обработки 1С: подразделение необязательно", () => {
  const body = readHrEmployeesBody({ employees: [{ id: "1", fullName: "Петров Пётр", department: "Бар" }, { id: "2", fullName: "Сидорова Анна" }] });
  assert.equal(body?.employees[0].departmentName, "Бар");
  assert.equal(body?.employees[1].departmentName, null);
});
