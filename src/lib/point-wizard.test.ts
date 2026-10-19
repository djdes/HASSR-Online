import test from "node:test";
import assert from "node:assert/strict";

import { isRoomKind } from "./room-kinds";
import {
  TYPICAL_EQUIPMENT,
  TYPICAL_ROOMS,
  WIZARD_MAX_QUANTITY,
  addCustomRoom,
  guessRoom,
  nextEquipmentNames,
  planEquipment,
  type WizardEquipmentType,
  type WizardRoom,
} from "./point-wizard";

const LABELS: Record<WizardEquipmentType, string> = {
  refrigerator: "Холодильник",
  freezer: "Морозильник",
  fryer: "Фритюрница",
  uv_lamp: "УФ-лампа",
  oven: "Печь",
  dishwasher: "Посудомоечная машина",
};

const ROOMS: WizardRoom[] = [
  { name: "Горячий цех", kind: "kitchen" },
  { name: "Холодный цех", kind: "kitchen" },
  { name: "Склад", kind: "storage" },
  { name: "Мойка", kind: "wash" },
];

test("типовой набор: виды помещений из room-kinds, в наборе есть «Основное производство»", () => {
  for (const room of TYPICAL_ROOMS) assert.ok(isRoomKind(room.kind), room.key);
  assert.ok(TYPICAL_ROOMS.some((room) => room.kind === "production"));
  assert.deepEqual(
    TYPICAL_EQUIPMENT.map((item) => item.type),
    ["refrigerator", "freezer", "fryer", "uv_lamp", "oven", "dishwasher"],
  );
});

test("помещение по умолчанию: по названию, затем по виду, иначе первое", () => {
  assert.equal(guessRoom("refrigerator", ROOMS), "Холодный цех");
  assert.equal(guessRoom("freezer", ROOMS), "Склад");
  assert.equal(guessRoom("fryer", ROOMS), "Горячий цех");
  assert.equal(guessRoom("dishwasher", ROOMS), "Мойка");
  assert.equal(guessRoom("dishwasher", [{ name: "Цех", kind: "production" }]), "Цех");
  assert.equal(guessRoom("refrigerator", []), null);
});

test("своё помещение: без пустых и повторов (регистр не важен)", () => {
  assert.equal(addCustomRoom(ROOMS, "  "), null);
  assert.equal(addCustomRoom(ROOMS, "склад"), null);
  assert.deepEqual(addCustomRoom(ROOMS, "  Кондитерский   цех ")?.at(-1), { name: "Кондитерский цех", kind: "other" });
});

test("названия оборудования — следующий свободный номер в организации", () => {
  assert.deepEqual(nextEquipmentNames("Холодильник", 2, []), ["Холодильник 1", "Холодильник 2"]);
  assert.deepEqual(nextEquipmentNames("Холодильник", 2, ["холодильник 1", "Холодильник 3"]), ["Холодильник 2", "Холодильник 4"]);
  assert.deepEqual(nextEquipmentNames("Печь", 0, []), []);
});

test("план оборудования: количество, помещение из списка, типовые нормы, порядок набора", () => {
  const plan = planEquipment({
    rows: [
      { type: "uv_lamp", quantity: 1, roomName: "Холодный цех" },
      { type: "refrigerator", quantity: 2, roomName: "холодный цех" },
      { type: "freezer", quantity: 1, roomName: "Склад" },
      { type: "fryer", quantity: 0, roomName: "Горячий цех" },
      { type: "oven", quantity: 1, roomName: "Нет такого" },
    ],
    rooms: ROOMS,
    labels: LABELS,
    takenNames: ["Холодильник 1"],
  });
  assert.deepEqual(plan, [
    { name: "Холодильник 2", type: "refrigerator", roomName: "Холодный цех", tempMin: 2, tempMax: 6 },
    { name: "Холодильник 3", type: "refrigerator", roomName: "Холодный цех", tempMin: 2, tempMax: 6 },
    { name: "Морозильник 1", type: "freezer", roomName: "Склад", tempMin: -24, tempMax: -18 },
    { name: "УФ-лампа 1", type: "uv_lamp", roomName: "Холодный цех" },
  ]);
  // Без помещений оборудование не ставится; количество ограничено.
  assert.deepEqual(planEquipment({ rows: [{ type: "refrigerator", quantity: 3, roomName: null }], rooms: [], labels: LABELS, takenNames: [] }), []);
  assert.equal(
    planEquipment({ rows: [{ type: "oven", quantity: 500, roomName: "Мойка" }], rooms: ROOMS, labels: LABELS, takenNames: [] }).length,
    WIZARD_MAX_QUANTITY,
  );
});
