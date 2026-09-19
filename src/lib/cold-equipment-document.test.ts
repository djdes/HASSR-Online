import assert from "node:assert/strict";
import test from "node:test";

import {
  coldEquipmentSlotKeys,
  coldReadingSlotKey,
  countColdEquipmentValues,
  collectColdEquipmentDeviations,
  createEmptyColdEquipmentEntryData,
  expandColdEquipmentReadingSlots,
  pickColdReadingSlotForWrite,
  setColdEquipmentCorrection,
  syncColdEquipmentEntryDataWithConfig,
  type ColdEquipmentDocumentConfig,
} from "@/lib/cold-equipment-document";

const config: ColdEquipmentDocumentConfig = {
  skipWeekends: false,
  equipment: [
    { id: "fridge", sourceEquipmentId: "eq-1", name: "Холодильник", min: 2, max: 6, readingMode: "twice" },
    { id: "freezer", sourceEquipmentId: null, name: "Морозилка", min: -24, max: -18 },
  ],
};

test("замеры: первый живёт под id оборудования, второй и третий — под id#2, id#3", () => {
  assert.equal(coldReadingSlotKey("fridge", 0), "fridge");
  assert.equal(coldReadingSlotKey("fridge", 1), "fridge#2");
  const slots = expandColdEquipmentReadingSlots(config);
  assert.deepEqual(slots.map((slot) => [slot.slotKey, slot.slotLabel]), [
    ["fridge", "1-й замер"],
    ["fridge#2", "2-й замер"],
    ["freezer", ""],
  ]);
});

test("замеры: пустая строка и синхронизация с конфигом держат все слоты", () => {
  assert.deepEqual(Object.keys(createEmptyColdEquipmentEntryData(config).temperatures), ["fridge", "fridge#2", "freezer"]);
  const synced = syncColdEquipmentEntryDataWithConfig(
    { responsibleTitle: null, temperatures: { fridge: 4, "fridge#2": 5, gone: 1 } },
    config
  );
  assert.deepEqual(synced.temperatures, { fridge: 4, "fridge#2": 5, freezer: null });
});

test("замеры: запись по QR идёт в первый пустой замер дня, потом в последний", () => {
  const fridge = config.equipment[0];
  assert.equal(pickColdReadingSlotForWrite(fridge, {}), "fridge");
  assert.equal(pickColdReadingSlotForWrite(fridge, { fridge: 4 }), "fridge#2");
  assert.equal(pickColdReadingSlotForWrite(fridge, { fridge: 4, "fridge#2": 5 }), "fridge#2");
  assert.equal(pickColdReadingSlotForWrite(config.equipment[1], { freezer: -19 }), "freezer");
});

test("замеры: отклонение считается по каждому замеру отдельно", () => {
  const deviations = collectColdEquipmentDeviations(config, [
    { id: "row", date: "2026-09-18", data: { responsibleTitle: null, temperatures: { fridge: 4, "fridge#2": 9, freezer: -20 } } },
  ]);
  assert.deepEqual(deviations.map((item) => [item.equipmentId, item.equipmentName, item.value]), [["fridge#2", "Холодильник · 2-й замер", 9]]);
});

test("замеры: считаем, сколько значений потеряет удаление слотов", () => {
  const entries = [
    { data: { temperatures: { fridge: 4, "fridge#2": 5, freezer: -20 } } },
    { data: { temperatures: { fridge: 3, "fridge#2": null, freezer: -21 } } },
    { data: {} },
  ];
  assert.deepEqual(coldEquipmentSlotKeys("fridge", "thrice"), ["fridge", "fridge#2", "fridge#3"]);
  assert.deepEqual(coldEquipmentSlotKeys("fridge", "once"), ["fridge"]);
  assert.equal(countColdEquipmentValues(entries, coldEquipmentSlotKeys("fridge", "twice")), 3);
  assert.equal(countColdEquipmentValues(entries, ["fridge#2"]), 1);
  assert.equal(countColdEquipmentValues(entries, ["freezer"]), 2);
  assert.equal(countColdEquipmentValues(entries, []), 0);
});

test("комментарий к отклонению: ложится в corrections своего замера", () => {
  const base = createEmptyColdEquipmentEntryData(config, "Повар");
  const withComment = setColdEquipmentCorrection(base, "fridge#2", "  Вызвал мастера  ");
  assert.deepEqual(withComment.corrections, { "fridge#2": "Вызвал мастера" });
  // Пустой текст ничего не стирает.
  assert.deepEqual(
    setColdEquipmentCorrection(withComment, "fridge#2", "   ").corrections,
    { "fridge#2": "Вызвал мастера" },
  );
  // Соседний замер получает свой комментарий, не затирая первый.
  const both = setColdEquipmentCorrection(withComment, "freezer", "Переложил продукты");
  assert.deepEqual(both.corrections, {
    "fridge#2": "Вызвал мастера",
    freezer: "Переложил продукты",
  });
  // Журнал читает комментарий из того же места, куда мы его положили.
  const deviations = collectColdEquipmentDeviations(config, [
    { id: "row", date: "2026-09-18", data: { ...both, temperatures: { "fridge#2": 9 } } },
  ]);
  assert.equal(deviations[0]?.comment, "Вызвал мастера");
  // Комментарий переживает синхронизацию строки с конфигом.
  assert.deepEqual(syncColdEquipmentEntryDataWithConfig(both, config).corrections, both.corrections);
});
