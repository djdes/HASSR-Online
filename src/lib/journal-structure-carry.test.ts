import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { copyDocumentStructure } from "@/lib/journal-document-copy";
import { carryStructureFromPrevious, structureCarryNeeds } from "@/lib/journal-structure-carry";

const PERIOD = "2026-10-01";
const live = (...ids: string[]) => new Set(ids);

describe("structureCarryNeeds — кому что нужно из справочника", () => {
  it("холодильники и УФ — оборудование, климат — помещения", () => {
    assert.deepEqual(structureCarryNeeds("cold_equipment_control"), { equipment: true, rooms: false });
    assert.deepEqual(structureCarryNeeds("uv_lamp_runtime"), { equipment: true, rooms: false });
    assert.deepEqual(structureCarryNeeds("climate_control"), { equipment: false, rooms: true });
  });

  it("журналы с копией — без справочника, журналы-факты — не переносятся", () => {
    assert.deepEqual(structureCarryNeeds("equipment_maintenance"), { equipment: false, rooms: false });
    assert.equal(structureCarryNeeds("finished_product"), null);
    assert.equal(structureCarryNeeds("accident_journal"), null);
    assert.equal(structureCarryNeeds("hygiene"), null);
  });
});

describe("carryStructureFromPrevious — холодильники", () => {
  const prev = {
    equipment: [
      { id: "row-1", sourceEquipmentId: "eq-1", name: "Камера", min: 2, max: 4, readingMode: "twice" },
      { id: "row-2", sourceEquipmentId: "eq-dead", name: "Списанный", min: 2, max: 6 },
      { id: "row-3", sourceEquipmentId: null, name: "Ручная строка", min: null, max: -18 },
    ],
    skipWeekends: true,
    // Факт прошлого периода в конфиг не переезжает.
    closedAt: "2026-09-30",
  };

  it("те же холодильники без удалённых, выходные — как было", () => {
    const got = carryStructureFromPrevious("cold_equipment_control", prev, {
      liveEquipmentIds: live("eq-1"),
      periodFrom: PERIOD,
    });
    assert.deepEqual(got, {
      equipment: [
        { id: "row-1", sourceEquipmentId: "eq-1", name: "Камера", min: 2, max: 4, readingMode: "twice" },
        { id: "row-3", sourceEquipmentId: null, name: "Ручная строка", min: null, max: -18 },
      ],
      skipWeekends: true,
    });
  });

  it("все холодильники удалены — null (новый документ соберётся из справочника)", () => {
    const got = carryStructureFromPrevious(
      "cold_equipment_control",
      { equipment: [{ id: "r", sourceEquipmentId: "eq-dead", name: "X" }] },
      { liveEquipmentIds: live(), periodFrom: PERIOD }
    );
    assert.equal(got, null);
  });

  it("исходный конфиг не меняется", () => {
    const before = JSON.stringify(prev);
    carryStructureFromPrevious("cold_equipment_control", prev, { liveEquipmentIds: live("eq-1"), periodFrom: PERIOD });
    assert.equal(JSON.stringify(prev), before);
  });
});

describe("carryStructureFromPrevious — климат", () => {
  it("помещения без удалённых, сроки контроля и выходные", () => {
    const got = carryStructureFromPrevious(
      "climate_control",
      {
        rooms: [
          { id: "room-r1", roomId: "r1", name: "Склад", temperature: { enabled: true, min: 18, max: 25 } },
          { id: "room-r2", roomId: "r2", name: "Удалённый" },
          { id: "room-0", name: "Без справочника" },
        ],
        controlTimes: ["09:00", "18:00"],
        skipWeekends: false,
      },
      { liveRoomIds: live("r1"), periodFrom: PERIOD }
    );
    assert.deepEqual(got, {
      rooms: [
        { id: "room-r1", roomId: "r1", name: "Склад", temperature: { enabled: true, min: 18, max: 25 } },
        { id: "room-0", name: "Без справочника" },
      ],
      controlTimes: ["09:00", "18:00"],
      skipWeekends: false,
    });
  });

  it("нет живых помещений — null", () => {
    assert.equal(
      carryStructureFromPrevious("climate_control", { rooms: [{ id: "x", roomId: "gone" }] }, { liveRoomIds: live(), periodFrom: PERIOD }),
      null
    );
  });
});

describe("carryStructureFromPrevious — УФ-лампа", () => {
  const prev = {
    lampNumber: "2",
    areaName: "Холодный цех",
    spec: { lampLifetimeHours: 8000, controlFrequency: "ежедневно" },
    equipmentId: "lamp-1",
  };

  it("конфиг целиком: номер, цех, паспорт и связь с лампой", () => {
    assert.deepEqual(
      carryStructureFromPrevious("uv_lamp_runtime", prev, { liveEquipmentIds: live("lamp-1"), periodFrom: PERIOD }),
      prev
    );
  });

  it("лампу удалили из «Оборудования» — связь снимается, остальное остаётся", () => {
    const got = carryStructureFromPrevious("uv_lamp_runtime", prev, { liveEquipmentIds: live(), periodFrom: PERIOD });
    assert.deepEqual(got, { lampNumber: "2", areaName: "Холодный цех", spec: prev.spec });
  });
});

describe("carryStructureFromPrevious — журналы с «Сделать копию»", () => {
  it("структура без факта — ровно как у копии", () => {
    const prev = { year: 2026, documentDate: "2026-01-01", rows: [{ id: "r1", plan: { jan: "+" }, fact: { jan: "05.01" } }] };
    assert.deepEqual(
      carryStructureFromPrevious("equipment_maintenance", prev, { periodFrom: "2027-01-01" }),
      copyDocumentStructure("equipment_maintenance", prev, "2027-01-01")
    );
  });

  it("название документа в конфиге — новое", () => {
    const got = carryStructureFromPrevious(
      "glass_items_list",
      { documentName: "Перечень — 2026", rows: [{ id: "g1", itemName: "Стакан" }] },
      { periodFrom: "2027-01-01", documentTitle: "Перечень — 2027" }
    );
    assert.equal(got?.documentName, "Перечень — 2027");
    assert.deepEqual(got?.rows, [{ id: "g1", itemName: "Стакан" }]);
  });

  it("пустой конфиг — null", () => {
    assert.equal(carryStructureFromPrevious("glass_items_list", {}, { periodFrom: PERIOD }), null);
  });
});

describe("carryStructureFromPrevious — что НЕ переносится", () => {
  it("журналы, где строки конфига — это факт (бракераж, аварии)", () => {
    const rows = { rows: [{ id: "r", productName: "Борщ", grade: "отлично" }] };
    assert.equal(carryStructureFromPrevious("finished_product", rows, { periodFrom: PERIOD }), null);
    assert.equal(carryStructureFromPrevious("perishable_rejection", rows, { periodFrom: PERIOD }), null);
    assert.equal(carryStructureFromPrevious("accident_journal", rows, { periodFrom: PERIOD }), null);
  });

  it("мусор вместо конфига", () => {
    assert.equal(carryStructureFromPrevious("cold_equipment_control", null, { periodFrom: PERIOD }), null);
    assert.equal(carryStructureFromPrevious("climate_control", "x", { periodFrom: PERIOD }), null);
    assert.equal(carryStructureFromPrevious("uv_lamp_runtime", [], { periodFrom: PERIOD }), null);
  });
});
