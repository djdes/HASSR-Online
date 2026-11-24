import test from "node:test";
import assert from "node:assert/strict";

import {
  equipmentFieldProfile,
  fillersForObject,
  initialTemperatureToggles,
  keepFillersOfObject,
  sensorFieldVisible,
  visibleTemperatureFields,
} from "./equipment-type-fields";

const OFF = { min: false, max: false };

test("equipmentFieldProfile: холод — норма и датчик всегда, лампа — без них, прочее — по галочкам", () => {
  for (const type of ["refrigerator", "fridge", "freezer", "sensor"]) {
    const profile = equipmentFieldProfile(type);
    assert.equal(profile.temperature, "always", type);
    assert.equal(profile.sensor, "always", type);
    assert.equal(profile.lamp, false, type);
  }
  assert.deepEqual(equipmentFieldProfile("refrigerator").example, { min: "2", max: "6" });
  assert.deepEqual(equipmentFieldProfile("freezer").example, { min: "-25", max: "-18" });
  const lamp = equipmentFieldProfile("uv_lamp");
  assert.equal(lamp.temperature, "none");
  assert.equal(lamp.sensor, "never");
  assert.equal(lamp.lamp, true);
  for (const type of ["thermometer", "oven", "fryer", "dishwasher", "other", "Металлодетектор", ""]) {
    const profile = equipmentFieldProfile(type);
    assert.equal(profile.temperature, "optional", type);
    assert.equal(profile.sensor, "withTemperature", type);
    assert.equal(profile.lamp, false, type);
  }
  assert.equal(equipmentFieldProfile(" Freezer ").temperature, "always");
});

test("галочки нормы: стоят, если норма записана; поля видны по типу и галочкам", () => {
  assert.deepEqual(initialTemperatureToggles("", ""), OFF);
  assert.deepEqual(initialTemperatureToggles("2", " "), { min: true, max: false });
  assert.deepEqual(initialTemperatureToggles("", "180"), { min: false, max: true });
  const other = equipmentFieldProfile("other");
  assert.deepEqual(visibleTemperatureFields(other, OFF), OFF);
  assert.deepEqual(visibleTemperatureFields(other, { min: false, max: true }), { min: false, max: true });
  // Холодильник — всегда обе, галочки не важны; лампа — никогда.
  assert.deepEqual(visibleTemperatureFields(equipmentFieldProfile("refrigerator"), OFF), { min: true, max: true });
  assert.deepEqual(visibleTemperatureFields(equipmentFieldProfile("uv_lamp"), { min: true, max: true }), OFF);
});

test("поле Tuya: у холода всегда, у прочих — при норме или записанном номере, у лампы — только записанный", () => {
  assert.equal(sensorFieldVisible(equipmentFieldProfile("freezer"), OFF, ""), true);
  const other = equipmentFieldProfile("other");
  assert.equal(sensorFieldVisible(other, OFF, ""), false);
  assert.equal(sensorFieldVisible(other, { min: true, max: false }, ""), true);
  assert.equal(sensorFieldVisible(other, OFF, "bf3978"), true);
  assert.equal(sensorFieldVisible(equipmentFieldProfile("uv_lamp"), { min: true, max: true }, ""), false);
  assert.equal(sensorFieldVisible(equipmentFieldProfile("uv_lamp"), OFF, "bf3978"), true);
});

const ORG = ["office", "cafe", "plant"];
const people = [
  { id: "olga", buildingIds: ["office"] },
  { id: "hasan", buildingIds: ["cafe"] },
  { id: "jasur", buildingIds: ["cafe", "plant"] },
  { id: "anyone", buildingIds: [] },
  { id: "gone", buildingIds: ["deleted-point"] },
];

test("fillersForObject: офис — его сотрудники, точка — её, без объекта — все", () => {
  const ids = (buildingId: string | null, selectedIds: string[] = []) =>
    fillersForObject(people, { orgBuildingIds: ORG, buildingId, selectedIds }).map((p) => p.id);
  assert.deepEqual(ids("office"), ["olga", "anyone", "gone"]);
  assert.deepEqual(ids("cafe"), ["hasan", "jasur", "anyone", "gone"]);
  assert.deepEqual(ids("plant"), ["jasur", "anyone", "gone"]);
  assert.deepEqual(ids(null), people.map((p) => p.id));
  // Неизвестный объект (точки выключены) — все.
  assert.deepEqual(ids("missing"), people.map((p) => p.id));
  // Отмеченный человек с другого объекта виден, чтобы его можно было снять.
  assert.deepEqual(ids("office", ["hasan"]), ["olga", "hasan", "anyone", "gone"]);
});

test("keepFillersOfObject: при смене объекта остаются только его люди", () => {
  const keep = (selected: string[], buildingId: string | null) =>
    keepFillersOfObject(selected, people, { orgBuildingIds: ORG, buildingId });
  assert.deepEqual(keep(["olga", "hasan", "anyone"], "cafe"), ["hasan", "anyone"]);
  assert.deepEqual(keep(["olga", "hasan"], "office"), ["olga"]);
  assert.deepEqual(keep(["olga", "hasan"], null), ["olga", "hasan"]);
});
