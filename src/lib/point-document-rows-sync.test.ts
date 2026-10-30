import assert from "node:assert/strict";
import test from "node:test";

import { pointForRows, trimPointDocumentConfig, visiblePointStaffEntries } from "./point-document-rows-sync";

// Партнёр, 2026-10-30: «в журналах темп. режима — всё оборудование
// организации», «чтобы ТТ не своё просто не видела».
const directory = {
  equipmentPoint: new Map<string, string | null>([
    ["fridge-a", "A"],
    ["fridge-b", "B"],
    ["fridge-shared", null],
  ]),
  roomPoint: new Map<string, string>([
    ["room-a", "A"],
    ["room-b", "B"],
  ]),
};

test("холодильники: в документе точки A остаются её, общие, ручные и удалённые; холодильник точки B убран", () => {
  const config = {
    skipWeekends: true,
    equipment: [
      { id: "1", sourceEquipmentId: "fridge-a", name: "ШХ-1" },
      { id: "2", sourceEquipmentId: "fridge-b", name: "ШХ-2" },
      { id: "3", sourceEquipmentId: "fridge-shared", name: "Общая камера" },
      { id: "4", sourceEquipmentId: null, name: "Ручная строка" },
      { id: "5", sourceEquipmentId: "deleted", name: "Списанный" },
    ],
  };
  const got = trimPointDocumentConfig("cold_equipment_control", config, "A", directory);
  assert.equal(got?.removed, 1);
  assert.deepEqual(
    (got?.config.equipment as Array<{ id: string }>).map((row) => row.id),
    ["1", "3", "4", "5"],
  );
  assert.equal(got?.config.skipWeekends, true);
});

test("всё своё — менять нечего (null)", () => {
  const config = { equipment: [{ id: "1", sourceEquipmentId: "fridge-a" }] };
  assert.equal(trimPointDocumentConfig("cold_equipment_control", config, "A", directory), null);
});

test("поверка и обслуживание: строки оборудования другой точки убраны", () => {
  const config = { rows: [{ id: "r1", sourceEquipmentId: "fridge-a" }, { id: "r2", sourceEquipmentId: "fridge-b" }] };
  for (const code of ["equipment_calibration", "equipment_maintenance"]) {
    const got = trimPointDocumentConfig(code, config, "A", directory);
    assert.deepEqual((got?.config.rows as Array<{ id: string }>).map((row) => row.id), ["r1"], code);
  }
});

test("климат: помещения другой точки убраны, строки без помещения остаются", () => {
  const config = { rooms: [{ id: "c1", roomId: "room-a" }, { id: "c2", roomId: "room-b" }, { id: "c3" }] };
  const got = trimPointDocumentConfig("climate_control", config, "A", directory);
  assert.deepEqual((got?.config.rooms as Array<{ id: string }>).map((row) => row.id), ["c1", "c3"]);
});

test("уборка: выбранные помещения другой точки убраны", () => {
  const got = trimPointDocumentConfig("cleaning", { selectedRoomIds: ["room-a", "room-b", "gone"], matrix: {} }, "A", directory);
  assert.deepEqual(got?.config.selectedRoomIds, ["room-a", "gone"]);
});

test("другие журналы и мусор вместо конфига не трогаем", () => {
  assert.equal(trimPointDocumentConfig("hygiene", { equipment: [{ sourceEquipmentId: "fridge-b" }] }, "A", directory), null);
  assert.equal(trimPointDocumentConfig("cold_equipment_control", null, "A", directory), null);
});

test("гигиена: строки сотрудников другой точки скрыты; без точек, неизвестные и с отметкой человека — видны", () => {
  const staff = new Map<string, string[]>([
    ["anna", ["A"]],
    ["boris", ["B"]],
    ["vera", []],
    ["gleb", ["B"]],
    ["dina", ["deleted-point"]],
  ]);
  const entries = [
    { employeeId: "anna", data: { status: "healthy" } },
    { employeeId: "boris", data: { _autoSeeded: true } },
    { employeeId: "boris", data: { status: "healthy" } },
    { employeeId: "vera", data: {} },
    { employeeId: "gleb", data: { status: "healthy", source: "qr", confirmedAt: "2026-10-30T08:00:00Z" } },
    { employeeId: "dina", data: {} },
    { employeeId: "fired", data: { status: "healthy" } },
  ];
  const visible = visiblePointStaffEntries(entries, "A", staff, new Set(["A", "B"]));
  assert.deepEqual([...new Set(visible.map((entry) => entry.employeeId))], ["anna", "vera", "gleb", "dina", "fired"]);
});

test("точка для строк: только активный документ на живой точке", () => {
  assert.equal(pointForRows({ status: "active", buildingId: "A" }, ["A", "B"]), "A");
  assert.equal(pointForRows({ status: "closed", buildingId: "A" }, ["A", "B"]), null);
  assert.equal(pointForRows({ status: "active", buildingId: null }, ["A", "B"]), null);
  assert.equal(pointForRows({ status: "active", buildingId: "A" }, [null]), null);
});
