import assert from "node:assert/strict";
import test from "node:test";

import { pointRowsWhere, rowsPointFromTargets } from "./document-point-rows";
import { admissionRoster, pickCompanionDocument } from "./health-qr-roster";

// Владелец, 2026-10-29: «в журналы конкретной точки выводятся все помещения /
// сотрудники / оборудование организации».

test("справочники документа точки: помещения точки, цеха и оборудование точки и общие, сотрудники точки и без точек", () => {
  const rows = pointRowsWhere("b1");
  assert.deepEqual(rows.room, { buildingId: "b1" });
  assert.deepEqual(rows.area, { OR: [{ buildingId: "b1" }, { buildingId: null }] });
  assert.deepEqual(rows.equipment, { OR: [{ area: { buildingId: "b1" } }, { area: { buildingId: null } }] });
  assert.deepEqual(rows.staff, { OR: [{ buildingIds: { isEmpty: true } }, { buildingIds: { has: "b1" } }] });
});

test("документ без точки — справочники всей организации", () => {
  assert.deepEqual(pointRowsWhere(null), { area: {}, room: {}, equipment: {}, staff: {} });
});

test("точка документа считается, только если точки включены и она своя", () => {
  assert.equal(rowsPointFromTargets(["b1", "b2"], "b1"), "b1");
  assert.equal(rowsPointFromTargets([null], "b1"), null, "точки выключены");
  assert.equal(rowsPointFromTargets(["b1", "b2"], "chuzhaya"), null, "чужая или удалённая точка");
  assert.equal(rowsPointFromTargets(["b1", "b2"], null), null);
});

test("парный журнал здоровья: своей точки, иначе общий, но не другой точки", () => {
  const docs = [
    { id: "other", buildingId: "b2" },
    { id: "shared", buildingId: null },
    { id: "own", buildingId: "b1" },
  ];
  assert.equal(pickCompanionDocument(docs, "b1")?.id, "own");
  assert.equal(pickCompanionDocument(docs.filter((doc) => doc.id !== "own"), "b1")?.id, "shared");
  assert.equal(pickCompanionDocument([{ id: "other", buildingId: "b2" }], "b1"), null);
  // Общий документ — общий парный, иначе первый найденный (как раньше).
  assert.equal(pickCompanionDocument(docs, null)?.id, "shared");
  assert.equal(pickCompanionDocument([{ id: "other", buildingId: "b2" }], null)?.id, "other");
});

test("«Допуск сотрудников»: сотрудники точки и уже отметившиеся здесь сегодня, порядок по общему списку", () => {
  const everyone = [
    { id: "a", positionTitle: "Повар" },
    { id: "b", positionTitle: "Повар" },
    { id: "c", positionTitle: "Кухонный рабочий" },
    { id: "d", positionTitle: "Буфетчик" },
  ];
  // На точке — a и c (c — на замене, с пометкой); d с другой точки уже отметился.
  const pointPeople = [
    { id: "a", positionTitle: "Повар" },
    { id: "c", positionTitle: "Замена · Кухонный рабочий" },
  ];
  const rows = admissionRoster(pointPeople, everyone, new Set(["d"]));
  assert.deepEqual(rows.map((row) => row.id), ["a", "c", "d"]);
  assert.equal(rows[1].positionTitle, "Замена · Кухонный рабочий");
  // Без точки (документ общий) — вся организация.
  assert.equal(admissionRoster(everyone, everyone, new Set()).length, 4);
});
