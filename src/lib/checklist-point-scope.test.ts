import assert from "node:assert/strict";
import test from "node:test";

import {
  assignmentChangeRefusal,
  assignmentFormInArea,
  assignmentInArea,
  assignmentRowsInArea,
  assignmentTargetRefusal,
  CHECKLIST_ASSIGNMENT_NOT_FOUND,
  CHECKLIST_POSITION_TARGET_ERROR,
  checklistPointArea,
  inspectionInArea,
  inspectionVisitAreaWhere,
  inspectionVisitInArea,
  personInArea,
} from "./checklist-point-scope";
import { BUILDING_OUT_OF_SCOPE_ERROR, COMPANY_ONLY_API_ERROR, STAFF_OUT_OF_SCOPE_ERROR } from "./point-scope";

/**
 * Чек-листы и посещения по точкам (2026-11-01): руководитель точки A не
 * видит и не меняет назначения, проверки и посещения точки B.
 */

const buildings = [{ id: "A" }, { id: "B" }, { id: "C" }, { id: "office" }];
const people = [
  { id: "anna", buildingIds: ["A"] },
  { id: "boris", buildingIds: ["B"] },
  { id: "vera", buildingIds: [] },
  { id: "olga", buildingIds: ["office"] },
  { id: "dima", buildingIds: ["A", "B"] },
  { id: "old", buildingIds: ["deleted"] },
];
// Руководитель точки A, руководство с точкой A в шапке, «Вся организация».
const pointManager = checklistPointArea({ points: ["A"], pointScoped: true, buildings, people });
const managementAtA = checklistPointArea({ points: ["A"], pointScoped: false, buildings, people });
const organization = checklistPointArea({ points: null, buildings, people });

test("назначение видно на точке: её люди, её сотрудник и общий, должность; другая точка и офис — нет", () => {
  const at = (targetKind: string, targetId: string) => assignmentInArea(pointManager, { targetKind, targetId });
  assert.equal(at("building", "A"), true);
  assert.equal(at("building", "B"), false);
  assert.equal(at("building", "office"), false);
  assert.equal(at("user", "anna"), true);
  assert.equal(at("user", "boris"), false);
  assert.equal(at("user", "vera"), true, "работает на всех точках");
  assert.equal(at("user", "olga"), false, "офис — не точка");
  assert.equal(at("user", "dima"), true);
  assert.equal(at("user", "old"), true, "только удалённые точки — везде");
  assert.equal(at("position", "cooks"), true);
  assert.equal(assignmentInArea(organization, { targetKind: "building", targetId: "B" }), true);
  // Несколько точек — хватает одной.
  const twoPoints = checklistPointArea({ points: ["A", "C"], pointScoped: true, buildings, people });
  assert.equal(assignmentInArea(twoPoints, { targetKind: "building", targetId: "C" }), true);
  assert.equal(assignmentInArea(twoPoints, { targetKind: "building", targetId: "B" }), false);
  assert.equal(personInArea(pointManager, "boris"), false);
  assert.equal(personInArea(pointManager, "anna"), true);
});

test("новая цель: чужая точка, чужой сотрудник и проверяющий — 403; должность — не руководителю точки", () => {
  const input = (targetKind: string, targetId: string, verifierUserId: string | null = null) => ({ targetKind, targetId, verifierUserId });
  assert.deepEqual(assignmentTargetRefusal(pointManager, input("building", "B")), { status: 403, error: BUILDING_OUT_OF_SCOPE_ERROR });
  assert.deepEqual(assignmentTargetRefusal(pointManager, input("user", "boris")), { status: 403, error: STAFF_OUT_OF_SCOPE_ERROR });
  assert.deepEqual(assignmentTargetRefusal(pointManager, input("position", "cooks")), { status: 403, error: CHECKLIST_POSITION_TARGET_ERROR });
  assert.deepEqual(assignmentTargetRefusal(pointManager, input("building", "A", "boris")), { status: 403, error: STAFF_OUT_OF_SCOPE_ERROR });
  assert.equal(assignmentTargetRefusal(pointManager, input("building", "A", "anna")), null);
  assert.equal(assignmentTargetRefusal(pointManager, input("user", "vera", "vera")), null);
  // Прежний проверяющий при правке остаётся, даже если он не с точки.
  assert.equal(assignmentTargetRefusal(pointManager, input("building", "A", "olga"), "olga"), null);
  // Руководство с точкой в шапке назначает и на должность.
  assert.equal(assignmentTargetRefusal(managementAtA, input("position", "cooks")), null);
  assert.deepEqual(assignmentTargetRefusal(managementAtA, input("building", "B")), { status: 403, error: BUILDING_OUT_OF_SCOPE_ERROR });
  assert.equal(assignmentTargetRefusal(organization, input("building", "B", "boris")), null);
});

test("изменить назначение: чужое — «не найдено», должность — только руководству компании", () => {
  assert.deepEqual(assignmentChangeRefusal(pointManager, { targetKind: "building", targetId: "B" }), { status: 404, error: CHECKLIST_ASSIGNMENT_NOT_FOUND });
  assert.deepEqual(assignmentChangeRefusal(pointManager, { targetKind: "user", targetId: "boris" }), { status: 404, error: CHECKLIST_ASSIGNMENT_NOT_FOUND });
  assert.deepEqual(assignmentChangeRefusal(pointManager, { targetKind: "position", targetId: "cooks" }), { status: 403, error: COMPANY_ONLY_API_ERROR });
  assert.equal(assignmentChangeRefusal(pointManager, { targetKind: "building", targetId: "A" }), null);
  assert.equal(assignmentChangeRefusal(managementAtA, { targetKind: "position", targetId: "cooks" }), null);
  assert.deepEqual(assignmentChangeRefusal(managementAtA, { targetKind: "building", targetId: "B" }), { status: 404, error: CHECKLIST_ASSIGNMENT_NOT_FOUND });
  assert.equal(assignmentChangeRefusal(organization, { targetKind: "building", targetId: "B" }), null);
});

test("список назначений: только точки области, получатели — только её люди", () => {
  const rows = [
    { id: "a", targetKind: "building", targetId: "A", recipients: [{ id: "anna" }, { id: "vera" }, { id: "dima" }] },
    { id: "b", targetKind: "building", targetId: "B", recipients: [{ id: "boris" }, { id: "vera" }, { id: "dima" }] },
    { id: "p", targetKind: "position", targetId: "cooks", recipients: [{ id: "anna" }, { id: "boris" }, { id: "olga" }] },
    { id: "u", targetKind: "user", targetId: "boris", recipients: [{ id: "boris" }] },
  ];
  const scoped = assignmentRowsInArea(pointManager, rows);
  assert.deepEqual(scoped.map((row) => row.id), ["a", "p"]);
  assert.deepEqual(scoped[0].recipients.map((person) => person.id), ["anna", "vera", "dima"]);
  assert.deepEqual(scoped[1].recipients.map((person) => person.id), ["anna"]);
  assert.deepEqual(assignmentRowsInArea(organization, rows), rows);
});

test("форма: точки и люди области; должности руководителю точки не предлагаем", () => {
  const form = { buildings, positions: [{ id: "cooks" }], people };
  const mine = assignmentFormInArea(pointManager, form);
  assert.deepEqual(mine.buildings.map((building) => building.id), ["A"]);
  assert.deepEqual(mine.positions, []);
  assert.deepEqual(mine.people.map((person) => person.id), ["anna", "vera", "dima", "old"]);
  assert.deepEqual(assignmentFormInArea(managementAtA, form).positions, [{ id: "cooks" }]);
  assert.deepEqual(assignmentFormInArea(organization, form), form);
});

test("проверки: по точке назначения, без назначения и по должности — по автору; свои и «я проверяющий» — всегда", () => {
  const seen = (createdById: string, assignment: { targetKind: string; targetId: string; verifierUserId?: string | null } | null, area = pointManager) =>
    inspectionInArea(area, { createdById, assignment }, "manager-a");
  assert.equal(seen("boris", { targetKind: "building", targetId: "B" }), false);
  assert.equal(seen("anna", { targetKind: "building", targetId: "A" }), true);
  assert.equal(seen("boris", { targetKind: "user", targetId: "boris" }), false);
  assert.equal(seen("boris", null), false, "без назначения — по точкам автора");
  assert.equal(seen("anna", null), true);
  assert.equal(seen("vera", null), true, "автор на всех точках");
  assert.equal(seen("platform-root", null), true, "автор не из организации — общая");
  assert.equal(seen("boris", { targetKind: "position", targetId: "cooks" }), false);
  assert.equal(seen("anna", { targetKind: "position", targetId: "cooks" }), true);
  assert.equal(seen("manager-a", { targetKind: "building", targetId: "B" }), true, "своя проверка");
  assert.equal(seen("boris", { targetKind: "building", targetId: "B", verifierUserId: "manager-a" }), true, "я проверяющий");
  assert.equal(seen("boris", { targetKind: "building", targetId: "B" }, organization), true);
});

test("посещения проверяющих: без ссылки и по ссылке на организацию — общие, по ссылке другой точки — нет", () => {
  assert.deepEqual(inspectionVisitAreaWhere(null), {});
  assert.deepEqual(inspectionVisitAreaWhere(undefined), {});
  assert.deepEqual(inspectionVisitAreaWhere(["A"]), {
    OR: [{ tokenId: null }, { token: { buildingId: null } }, { token: { buildingId: { in: ["A"] } } }],
  });
  assert.equal(inspectionVisitInArea(["A"], "A"), true);
  assert.equal(inspectionVisitInArea(["A"], "B"), false);
  assert.equal(inspectionVisitInArea(["A"], null), true, "ссылка на всю организацию или запись из кабинета");
  assert.equal(inspectionVisitInArea(["A"], undefined), true);
  assert.equal(inspectionVisitInArea(null, "B"), true);
});
