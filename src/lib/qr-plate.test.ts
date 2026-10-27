import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildEquipmentPlate, indexEquipmentInAreas, plateNumber, plateRegime, plateWord } from "@/lib/qr-plate";

const area = { name: "Горячий цех" };

describe("табличка на оборудование", () => {
  it("МОРОЗ при верхней границе не выше −5, иначе ХОЛОД", () => {
    assert.equal(plateWord(-20, -18), "МОРОЗ");
    assert.equal(plateWord(null, -5), "МОРОЗ");
    assert.equal(plateWord(null, -4), "ХОЛОД");
    assert.equal(plateWord(2, 6), "ХОЛОД");
  });

  it("режим с настоящим минусом", () => {
    assert.equal(plateRegime(2, 4), "+2…+4 °C");
    assert.equal(plateRegime(null, -18), "не выше −18 °C");
    assert.equal(plateRegime(-20, -18), "−20…−18 °C");
    assert.equal(plateRegime(null, null), null);
  });

  it("номер: число из конца названия или порядок в цехе", () => {
    assert.equal(plateNumber("Холодильник №3", 0), 3);
    assert.equal(plateNumber("Морозильник", 1), 2);
  });

  it("порядок по названию внутри цеха", () => {
    const index = indexEquipmentInAreas([
      { id: "b", name: "Б", area },
      { id: "a", name: "А", area },
      { id: "c", name: "В", area: { name: "Склад" } },
    ]);
    assert.equal(index.get("a"), 0);
    assert.equal(index.get("b"), 1);
    assert.equal(index.get("c"), 0);
  });

  it("лампа и оборудование без температуры без таблички", () => {
    assert.equal(buildEquipmentPlate({ name: "Лампа", tempMin: null, tempMax: null, area, equipmentKind: "uv" }, 0), null);
    assert.equal(buildEquipmentPlate({ name: "Стол", tempMin: null, tempMax: null, area }, 0), null);
    assert.deepEqual(buildEquipmentPlate({ name: "Морозильник", tempMin: null, tempMax: -18, area }, 2), {
      word: "МОРОЗ",
      regime: "не выше −18 °C",
      number: 3,
      area: "Горячий цех",
    });
  });
});
