import assert from "node:assert/strict";
import test from "node:test";

import {
  defaultFryerOilDocumentConfig,
  normalizeFryerOilDocumentConfig,
  normalizeFryerOilEntryData,
  type FryerOilDocumentConfig,
} from "./fryer-oil-document";
import {
  buildFryerQrEntryData,
  nowInZone,
  fryersForDocument,
  fryerQrPhase,
  fryerSourceIdForName,
  isFryerEquipmentType,
  lastFryerValues,
  pickFryerQrRow,
  syncFryerOilEquipment,
  withFryerSource,
} from "./fryer-oil-equipment-link";

function config(equipmentTypes: string[], links: FryerOilDocumentConfig["equipmentLinks"] = []): FryerOilDocumentConfig {
  const base = defaultFryerOilDocumentConfig();
  return { ...base, lists: { ...base.lists, equipmentTypes }, equipmentLinks: links };
}

test("фритюр: фритюрница из «Оборудования» сама появляется в журнале, образцы уходят", () => {
  const { config: next, changed } = syncFryerOilEquipment(defaultFryerOilDocumentConfig(), [
    { id: "eq-1", name: "Фритюрница Hurakan HKN-FT" },
  ]);
  assert.equal(changed, true);
  assert.deepEqual(next.lists.equipmentTypes, ["Фритюрница Hurakan HKN-FT"]);
  assert.deepEqual(next.equipmentLinks, [{ sourceEquipmentId: "eq-1", name: "Фритюрница Hurakan HKN-FT" }]);
});

test("фритюр: образец, которым подписана строка, остаётся", () => {
  const { config: next } = syncFryerOilEquipment(
    defaultFryerOilDocumentConfig(),
    [{ id: "eq-1", name: "Фритюрница большая" }],
    ["Фритюрница №2"],
  );
  assert.deepEqual(next.lists.equipmentTypes, ["Фритюрница №2", "Фритюрница большая"]);
});

test("фритюр: без фритюрниц в справочнике список не трогаем", () => {
  const original = defaultFryerOilDocumentConfig();
  const result = syncFryerOilEquipment(original, []);
  assert.equal(result.changed, false);
  assert.equal(result.config, original);
});

test("фритюр: одноимённая позиция списка связывается, а не задваивается", () => {
  const { config: next } = syncFryerOilEquipment(config(["Фритюрница настольная", "Жарочный шкаф"]), [
    { id: "eq-1", name: "фритюрница  настольная" },
  ]);
  assert.deepEqual(next.lists.equipmentTypes, ["Фритюрница настольная", "Жарочный шкаф"]);
  assert.deepEqual(next.equipmentLinks, [{ sourceEquipmentId: "eq-1", name: "Фритюрница настольная" }]);
});

test("фритюр: переименование в справочнике доходит до списка, повторная синхронизация без изменений", () => {
  const start = config(["Жарочный шкаф", "Фритюрница 1"], [{ sourceEquipmentId: "eq-1", name: "Фритюрница 1" }]);
  const first = syncFryerOilEquipment(start, [{ id: "eq-1", name: "Фритюрница у окна" }]);
  assert.deepEqual(first.config.lists.equipmentTypes, ["Жарочный шкаф", "Фритюрница у окна"]);
  assert.deepEqual(first.config.equipmentLinks, [{ sourceEquipmentId: "eq-1", name: "Фритюрница у окна" }]);
  const second = syncFryerOilEquipment(first.config, [{ id: "eq-1", name: "Фритюрница у окна" }]);
  assert.equal(second.changed, false);
});

test("фритюр: удалённая из справочника фритюрница — связь снята, имя осталось", () => {
  const start = config(["Фритюрница 1"], [{ sourceEquipmentId: "eq-1", name: "Фритюрница 1" }]);
  const { config: next, changed } = syncFryerOilEquipment(start, []);
  assert.equal(changed, true);
  assert.deepEqual(next.lists.equipmentTypes, ["Фритюрница 1"]);
  assert.deepEqual(next.equipmentLinks, []);
});

test("фритюр: связи переживают нормализацию конфига, мусор отбрасывается", () => {
  const normalized = normalizeFryerOilDocumentConfig({
    lists: { equipmentTypes: ["A"] },
    equipmentLinks: [
      { sourceEquipmentId: "eq-1", name: "A" },
      { sourceEquipmentId: "eq-1", name: "дубль" },
      { sourceEquipmentId: "", name: "B" },
      "мусор",
    ],
  });
  assert.deepEqual(normalized.equipmentLinks, [{ sourceEquipmentId: "eq-1", name: "A" }]);
  assert.deepEqual(normalizeFryerOilDocumentConfig({}).equipmentLinks, []);
});

test("фритюр: строка получает ссылку по имени, несвязанное имя ссылку снимает", () => {
  const links = [{ sourceEquipmentId: "eq-1", name: "Фритюрница 1" }];
  assert.equal(fryerSourceIdForName(links, "фритюрница 1"), "eq-1");
  const data = normalizeFryerOilEntryData({ equipmentType: "Фритюрница 1" });
  assert.equal(withFryerSource(data, links).sourceEquipmentId, "eq-1");
  const renamed = withFryerSource({ ...data, equipmentType: "Сковорода", sourceEquipmentId: "eq-1" }, links);
  assert.equal("sourceEquipmentId" in renamed, false);
  // Нормализация строки сохраняет ссылку и оценку словами.
  const kept = normalizeFryerOilEntryData({ sourceEquipmentId: "eq-1", qualityStartNote: "Доброкачественное" });
  assert.equal(kept.sourceEquipmentId, "eq-1");
  assert.equal(kept.qualityStartNote, "Доброкачественное");
});

test("фритюр QR: строка фритюрницы за сегодня — по ссылке, по имени, заготовка, новая", () => {
  const day = "2026-10-17";
  const entry = (id: string, data: Record<string, unknown>, date = `${day}T07:00:00.000Z`) => ({
    id,
    date,
    data: normalizeFryerOilEntryData(data),
  });
  const target = { equipmentId: "eq-1", equipmentName: "Фритюрница 1", dayKey: day };
  const linked = entry("e1", { startDate: day, equipmentType: "Старое имя", sourceEquipmentId: "eq-1", qualityStart: 5 });
  const byName = entry("e2", { startDate: day, equipmentType: "фритюрница 1" });
  const otherDay = entry("e3", { startDate: "2026-10-16", sourceEquipmentId: "eq-1" }, "2026-10-16T07:00:00.000Z");
  const seeded = entry("e4", { _autoSeeded: true });
  const otherFryer = entry("e5", { startDate: day, equipmentType: "Фритюрница 2", sourceEquipmentId: "eq-2" });

  const first = pickFryerQrRow([otherDay, byName, linked, seeded], target);
  assert.equal(first.kind === "existing" && first.entry.id, "e1");
  assert.equal(fryerQrPhase(first), "end");

  const second = pickFryerQrRow([otherDay, byName, seeded], target);
  assert.equal(second.kind === "existing" && second.entry.id, "e2");
  assert.equal(fryerQrPhase(second), "start");

  const third = pickFryerQrRow([otherDay, otherFryer, seeded], target);
  assert.equal(third.kind, "seeded");
  assert.equal(fryerQrPhase(third), "start");

  assert.deepEqual(pickFryerQrRow([otherDay, otherFryer], target), { kind: "new" });
});

test("фритюр: тип оборудования «Фритюрница»", () => {
  assert.equal(isFryerEquipmentType("fryer"), true);
  assert.equal(isFryerEquipmentType(" Фритюрница "), true);
  assert.equal(isFryerEquipmentType("oven"), false);
  assert.equal(isFryerEquipmentType(null), false);
});

test("фритюр: точка документа — свои фритюрницы и без точки, общий документ — все", () => {
  const fryers = [
    { id: "a", buildingId: "b1" },
    { id: "b", buildingId: "b2" },
    { id: "c", buildingId: null },
  ];
  assert.deepEqual(fryersForDocument(fryers, "b1").map((item) => item.id), ["a", "c"]);
  assert.deepEqual(fryersForDocument(fryers, null).map((item) => item.id), ["a", "b", "c"]);
});

test("фритюр QR: подсказка — жир и продукция последней жарки этой фритюрницы", () => {
  const entry = (id: string, date: string, data: Record<string, unknown>) => ({
    id,
    date: `${date}T07:00:00.000Z`,
    data: normalizeFryerOilEntryData({ startDate: date, ...data }),
  });
  const entries = [
    entry("e1", "2026-10-14", { sourceEquipmentId: "eq-1", fatType: "Пальмовое масло", productType: "Пирожки" }),
    entry("e2", "2026-10-15", { equipmentType: "Фритюрница 1", fatType: "Подсолнечное масло", productType: "Картофель фри" }),
    entry("e3", "2026-10-16", { sourceEquipmentId: "eq-2", fatType: "Рапсовое масло", productType: "Наггетсы" }),
  ];
  assert.deepEqual(lastFryerValues(entries, { equipmentId: "eq-1", equipmentName: "Фритюрница 1" }), {
    fatType: "Подсолнечное масло",
    productType: "Картофель фри",
  });
  assert.equal(lastFryerValues(entries.slice(2), { equipmentId: "eq-1", equipmentName: "Фритюрница 1" }), null);
});

test("фритюр QR: начало жарки, затем окончание — одна строка дня", () => {
  const equipment = { id: "eq-1", name: "Фритюрница 1" };
  const started = buildFryerQrEntryData({
    base: normalizeFryerOilEntryData({ _autoSeeded: true }),
    input: { phase: "start", fatType: "Подсолнечное масло", productType: "Картофель фри", quality: 5 },
    equipment,
    employeeName: "Иванова А.",
    dayKey: "2026-10-17",
    time: { hour: 9, minute: 5 },
  });
  assert.equal(started.startDate, "2026-10-17");
  assert.equal(started.startHour, 9);
  assert.equal(started.startMinute, 5);
  assert.equal(started.equipmentType, "Фритюрница 1");
  assert.equal(started.sourceEquipmentId, "eq-1");
  assert.equal(started.qualityStart, 5);
  assert.equal(started.qualityStartNote, "Доброкачественное, без постороннего запаха");
  assert.equal(started.controllerName, "Иванова А.");
  assert.equal(started.endHour, null);

  const ended = buildFryerQrEntryData({
    base: started,
    input: { phase: "end", quality: 2, carryoverKg: 1.5, disposedKg: 3 },
    equipment,
    employeeName: "Петров Б.",
    dayKey: "2026-10-17",
    time: { hour: 16, minute: 40 },
  });
  assert.equal(ended.startHour, 9);
  assert.equal(ended.endHour, 16);
  assert.equal(ended.endMinute, 40);
  assert.equal(ended.qualityEnd, 2);
  assert.match(ended.qualityEndNote ?? "", /утилизации/);
  assert.equal(ended.carryoverKg, 1.5);
  assert.equal(ended.disposedKg, 3);
  // Контролёр строки — кто начал; второй скан его не перетирает.
  assert.equal(ended.controllerName, "Иванова А.");
});

test("фритюр QR: время — в зоне организации", () => {
  const at = new Date("2026-10-17T21:30:00.000Z");
  assert.deepEqual(nowInZone("Europe/Moscow", at), { hour: 0, minute: 30, label: "00:30" });
  assert.deepEqual(nowInZone("Asia/Tashkent", at), { hour: 2, minute: 30, label: "02:30" });
});
