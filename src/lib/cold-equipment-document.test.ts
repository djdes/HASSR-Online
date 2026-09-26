import assert from "node:assert/strict";
import test from "node:test";

import {
  applyEquipmentNormToColdConfig,
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

/* ── Норма из справочника доходит до уже созданного документа ─────── */

test("правка нормы оборудования обновляет min/max в конфиге документа", () => {
  const { config: next, changed } = applyEquipmentNormToColdConfig(config, {
    sourceEquipmentId: "eq-1",
    min: 0,
    max: 4,
  });
  assert.equal(changed, true);
  assert.equal(next.equipment[0].min, 0);
  assert.equal(next.equipment[0].max, 4);
  // Соседние строки не трогаем.
  assert.deepEqual(next.equipment[1], config.equipment[1]);
  // Исходный конфиг не мутируем.
  assert.equal(config.equipment[0].min, 2);
});

test("строка без ссылки на справочник остаётся как есть", () => {
  const { changed } = applyEquipmentNormToColdConfig(config, {
    sourceEquipmentId: "eq-неизвестный",
    min: 0,
    max: 4,
  });
  assert.equal(changed, false);
});

test("та же норма — записи в базу не требуется", () => {
  const { changed } = applyEquipmentNormToColdConfig(config, {
    sourceEquipmentId: "eq-1",
    min: 2,
    max: 6,
  });
  assert.equal(changed, false);
});

test("«обсл»/«рем»: разбор ячейки и подпись", async () => {
  const { parseColdEquipmentCellInput, parseColdEquipmentStatus, formatColdEquipmentCell } = await import("@/lib/cold-equipment-document");
  assert.deepEqual(parseColdEquipmentCellInput("обсл"), { temperature: null, status: "service" });
  assert.deepEqual(parseColdEquipmentCellInput(" Рем. "), { temperature: null, status: "repair" });
  assert.deepEqual(parseColdEquipmentCellInput("-18,5"), { temperature: -18.5, status: null });
  assert.deepEqual(parseColdEquipmentCellInput(""), { temperature: null, status: null });
  assert.equal(parseColdEquipmentStatus("Обслуживание"), "service");
  assert.equal(parseColdEquipmentStatus("ремонт"), "repair");
  assert.equal(parseColdEquipmentStatus("4"), null);
  assert.equal(formatColdEquipmentCell(null, "service"), "обсл");
  assert.equal(formatColdEquipmentCell(4, "repair"), "рем");
  assert.equal(formatColdEquipmentCell(3.5, null), "3.5");
});

test("«обсл»/«рем»: хранение, слоты, автозаполнение не подставляет число и не переносит отметку", async () => {
  const {
    normalizeColdEquipmentEntryData,
    setColdEquipmentSlotStatus,
    mergeColdEquipmentEntryData,
    buildColdEquipmentAutoFillEntryData,
    withoutColdEquipmentStatuses,
  } = await import("@/lib/cold-equipment-document");
  const base = createEmptyColdEquipmentEntryData(config);
  const firstKey = config.equipment[0].id;
  const marked = setColdEquipmentSlotStatus({ ...base, temperatures: { ...base.temperatures, [firstKey]: 5 } }, firstKey, "repair");
  assert.equal(marked.temperatures[firstKey], null);
  assert.equal(marked.statuses?.[firstKey], "repair");

  // Через JSON и normalize отметка доходит без потерь, число рядом стирается.
  const roundTrip = normalizeColdEquipmentEntryData(JSON.parse(JSON.stringify({ ...marked, temperatures: { [firstKey]: 7 } })));
  assert.equal(roundTrip.statuses?.[firstKey], "repair");
  assert.equal(roundTrip.temperatures[firstKey], null);
  assert.equal(syncColdEquipmentEntryDataWithConfig(roundTrip, config).statuses?.[firstKey], "repair");

  // Слот с отметкой занят: следующий скан ложится в следующий замер.
  const twice = { ...config.equipment[0], readingMode: "twice" as const };
  assert.equal(pickColdReadingSlotForWrite(twice, {}, { [twice.id]: "service" }), coldReadingSlotKey(twice.id, 1));

  const generated = buildColdEquipmentAutoFillEntryData({ config, dateKey: "2026-09-25", responsibleTitle: null });
  const merged = mergeColdEquipmentEntryData(marked, generated);
  assert.equal(merged.temperatures[firstKey], null);
  assert.equal(merged.statuses?.[firstKey], "repair");

  // «Как вчера»: без отметок — день заполняется числами.
  const carried = mergeColdEquipmentEntryData(withoutColdEquipmentStatuses(marked), generated);
  assert.equal(carried.statuses, undefined);
  assert.equal(typeof carried.temperatures[firstKey], "number");

  // Снятие отметки.
  const cleared = setColdEquipmentSlotStatus(marked, firstKey, null);
  assert.equal(cleared.statuses, undefined);
});

test("фото замера: хранится под ключом замера, переживает normalize/sync/merge, чужие ссылки отбрасываются", async () => {
  const {
    normalizeColdEquipmentEntryData,
    setColdEquipmentSlotPhoto,
    mergeColdEquipmentEntryData,
    buildColdEquipmentAutoFillEntryData,
  } = await import("@/lib/cold-equipment-document");
  const photo = `/uploads/readings/${"a1".repeat(16)}.jpg`;
  const retake = `/uploads/readings/${"b2".repeat(16)}.png`;
  const base = createEmptyColdEquipmentEntryData(config);

  const withPhoto = setColdEquipmentSlotPhoto({ ...base, temperatures: { ...base.temperatures, "fridge#2": 4.5 } }, "fridge#2", photo);
  assert.deepEqual(withPhoto.readingPhotos, { "fridge#2": photo });
  // Новое фото заменяет прежнее, запись без снимка прежний не стирает.
  assert.deepEqual(setColdEquipmentSlotPhoto(withPhoto, "fridge#2", retake).readingPhotos, { "fridge#2": retake });
  assert.equal(setColdEquipmentSlotPhoto(withPhoto, "fridge#2", null), withPhoto);

  const roundTrip = normalizeColdEquipmentEntryData(
    JSON.parse(JSON.stringify({ ...withPhoto, readingPhotos: { ...withPhoto.readingPhotos, freezer: "javascript:alert(1)" } }))
  );
  assert.deepEqual(roundTrip.readingPhotos, { "fridge#2": photo });
  assert.equal("readingPhotos" in normalizeColdEquipmentEntryData({ temperatures: {} }), false);
  assert.deepEqual(syncColdEquipmentEntryDataWithConfig(roundTrip, config).readingPhotos, { "fridge#2": photo });

  // Автозаполнение дописывает пустые замеры, фото остаётся только у своего.
  const generated = buildColdEquipmentAutoFillEntryData({ config, dateKey: "2026-09-26", responsibleTitle: null });
  const merged = mergeColdEquipmentEntryData(roundTrip, { ...generated, readingPhotos: { freezer: retake } });
  assert.deepEqual(merged.readingPhotos, { "fridge#2": photo });
  assert.equal(merged.temperatures["fridge#2"], 4.5);
});
