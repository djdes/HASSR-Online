import assert from "node:assert/strict";
import test from "node:test";

import { isColdJournalEquipment, pointForRows, trimPointDocumentConfig, visiblePointStaffEntries } from "./point-document-rows-sync";

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

test("пустой журнал холодильников точки получает её холодильники (и общие), чужие — нет", () => {
  const withCold = {
    ...directory,
    coldEquipment: [
      { id: "fridge-a", name: "ШХ-А", pointId: "A", min: 2, max: 6 },
      { id: "fridge-b", name: "ШХ-Б", pointId: "B", min: 2, max: 6 },
      { id: "fridge-shared", name: "Общая камера", pointId: null, min: -18, max: null },
    ],
  };
  const empty = trimPointDocumentConfig("cold_equipment_control", { equipment: [], skipWeekends: true }, "A", withCold);
  assert.deepEqual(
    (empty?.config.equipment as Array<{ sourceEquipmentId: string }>).map((row) => row.sourceEquipmentId),
    ["fridge-a", "fridge-shared"],
  );
  assert.equal(empty?.config.skipWeekends, true);
  // Только чужие строки → убрать и поставить свои.
  const foreignOnly = trimPointDocumentConfig("cold_equipment_control", { equipment: [{ id: "x", sourceEquipmentId: "fridge-b" }] }, "A", withCold);
  assert.equal(foreignOnly?.removed, 1);
  assert.deepEqual((foreignOnly?.config.equipment as Array<{ name: string }>).map((row) => row.name), ["ШХ-А", "Общая камера"]);
  // Ручные строки — выбор человека, не дополняем.
  assert.equal(trimPointDocumentConfig("cold_equipment_control", { equipment: [{ id: "m", sourceEquipmentId: null, name: "Свой" }] }, "A", withCold), null);
  // У точки нет холодильников — пустой журнал остаётся пустым.
  assert.equal(trimPointDocumentConfig("cold_equipment_control", { equipment: [] }, "C", { ...withCold, coldEquipment: [withCold.coldEquipment[1]] }), null);
});

test("в журнал холодильников — холодильник, морозильник или оборудование с нормой; УФ-лампа — нет", () => {
  assert.equal(isColdJournalEquipment({ type: "refrigerator", name: "ШХ" }), true);
  assert.equal(isColdJournalEquipment({ type: "other", name: "Камера", tempMin: 0 }), true);
  assert.equal(isColdJournalEquipment({ type: "other", name: "Плита" }), false);
  assert.equal(isColdJournalEquipment({ type: "uv_lamp", name: "Гелиос", tempMin: 2 }), false);
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

test("график генуборок: помещения другой точки убраны, строки с отмеченной уборкой и ручные — остаются", () => {
  const config = {
    year: 2026,
    rows: [
      { id: "g1", roomId: "room-a", roomName: "Кухня А", cleanings: [] },
      { id: "g2", roomId: "room-b", roomName: "Кухня Б", cleanings: [{ id: "p:2026-03-06", planned: "2026-03-06", done: null }] },
      { id: "g3", roomId: "room-b", roomName: "Склад Б", cleanings: [{ id: "p:2026-02-06", planned: "2026-02-06", done: "2026-02-06" }] },
      { id: "g4", roomId: "room-b", roomName: "Зал Б", fact: { jan: "15" } },
      { id: "g5", roomName: "Ручная строка" },
      { id: "g6", roomId: "deleted-room", roomName: "Снесённое" },
    ],
  };
  const got = trimPointDocumentConfig("general_cleaning", config, "A", directory);
  assert.equal(got?.removed, 1);
  assert.deepEqual((got?.config.rows as Array<{ id: string }>).map((row) => row.id), ["g1", "g3", "g4", "g5", "g6"]);
  assert.equal(got?.config.year, 2026);
});

test("уборка: люди другой точки убраны из уборщиков, ответственных, пар и расписания; свои, без точек и уволенные — остаются", () => {
  const withStaff = {
    ...directory,
    staffPoints: new Map<string, string[]>([
      ["anna", ["A"]],
      ["boris", ["B"]],
      ["vera", []],
      ["dina", ["deleted-point"]],
    ]),
    livePointIds: new Set(["A", "B"]),
  };
  const config = {
    cleaningMode: "rooms",
    selectedRoomIds: ["room-a", "room-b"],
    selectedCleanerUserIds: ["anna", "boris", "vera", "fired"],
    cleanerByRoomId: { "room-a": ["anna", "boris"], "room-x": ["boris"] },
    cleaningResponsibles: [
      { id: "c1", userId: "anna", code: "С1" },
      { id: "c2", userId: "boris", code: "С2" },
    ],
    controlResponsibles: [{ id: "k1", userId: "boris", code: "К1" }],
    responsiblePersons: [{ userId: "boris", title: "Уборщица" }, { userId: "dina", title: "Уборщица" }],
    responsiblePairs: [{ id: "p1", cleaningUserId: "anna", cleaningUserName: "Анна", controlUserId: "boris", controlUserName: "Борис" }],
    controlUserId: "boris",
    schedule: { disinfection: { times: ["12:00"], responsibleUserId: "boris" }, ventilation: { times: [], responsibleUserId: "anna" } },
    cleanerCodeByUserId: { anna: 1, boris: 2 },
  };
  const got = trimPointDocumentConfig("cleaning", config, "A", withStaff);
  assert.ok(got);
  const next = got.config as typeof config;
  assert.deepEqual(next.selectedRoomIds, ["room-a"]);
  assert.deepEqual(next.selectedCleanerUserIds, ["anna", "vera", "fired"]);
  assert.deepEqual(next.cleanerByRoomId, { "room-a": ["anna"] });
  assert.deepEqual(next.cleaningResponsibles.map((item) => item.userId), ["anna"]);
  assert.deepEqual(next.controlResponsibles, []);
  assert.deepEqual(next.responsiblePersons.map((item) => item.userId), ["dina"]);
  assert.deepEqual(next.responsiblePairs[0], { id: "p1", cleaningUserId: "anna", cleaningUserName: "Анна", controlUserId: null, controlUserName: "" });
  assert.equal(next.controlUserId, null);
  assert.equal(next.schedule.disinfection.responsibleUserId, null);
  assert.equal(next.schedule.ventilation.responsibleUserId, "anna");
  // Коды подписей — история, не трогаем.
  assert.deepEqual(next.cleanerCodeByUserId, { anna: 1, boris: 2 });
  // Всё своё — менять нечего.
  assert.equal(trimPointDocumentConfig("cleaning", { selectedCleanerUserIds: ["anna", "vera"] }, "A", withStaff), null);
  // Без справочника сотрудников — люди не трогаются.
  assert.equal(trimPointDocumentConfig("cleaning", { selectedCleanerUserIds: ["boris"] }, "A", directory), null);
});
