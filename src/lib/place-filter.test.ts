import test from "node:test";
import assert from "node:assert/strict";

import { PLACE_ALL, PLACE_NONE, matchesPlace, placeFilterParam, resolvePlaceFilter, scopePlaces } from "./place-filter";

const places = ["office", "p1", "p2"];

test("выбор из адреса важнее точки в шапке", () => {
  assert.equal(resolvePlaceFilter({ requested: "p2", places, hasNone: true, headerPointId: "p1" }), "p2");
  assert.equal(resolvePlaceFilter({ requested: PLACE_NONE, places, hasNone: true, headerPointId: "p1" }), PLACE_NONE);
  assert.equal(resolvePlaceFilter({ requested: PLACE_ALL, places, hasNone: true, headerPointId: "p1" }), null);
});

test("без выбора в адресе — точка из шапки, при «Вся организация» — все", () => {
  assert.equal(resolvePlaceFilter({ requested: null, places, hasNone: false, headerPointId: "p1" }), "p1");
  assert.equal(resolvePlaceFilter({ requested: null, places, hasNone: false, headerPointId: null }), null);
});

test("чужой id в адресе и точка из шапки вне списка — «Все»", () => {
  assert.equal(resolvePlaceFilter({ requested: "foreign", places, hasNone: false, headerPointId: null }), null);
  assert.equal(resolvePlaceFilter({ requested: null, places, hasNone: false, headerPointId: "elsewhere" }), null);
  assert.equal(resolvePlaceFilter({ requested: PLACE_NONE, places, hasNone: false, headerPointId: "p1" }), "p1");
});

test("объект подходит под место", () => {
  assert.equal(matchesPlace(null, "p1"), true);
  assert.equal(matchesPlace(null, null), true);
  assert.equal(matchesPlace("p1", "p1"), true);
  assert.equal(matchesPlace("p1", "p2"), false);
  assert.equal(matchesPlace("p1", null), false);
  assert.equal(matchesPlace(PLACE_NONE, null), true);
  assert.equal(matchesPlace(PLACE_NONE, "p1"), false);
});

test("места в пределах человека: свои точки, офис с объектами, общие без точки", () => {
  const buildings = [
    { id: "office", kind: "office" },
    { id: "p1", kind: "point" },
    { id: "p2", kind: "point" },
    { id: "p3", kind: "point" },
  ];
  const items = [
    { id: "a", b: "p1" },
    { id: "b", b: "p2" },
    { id: "c", b: null },
    { id: "d", b: "deleted" },
  ];
  const all = scopePlaces({ items, buildingIdOf: (item) => item.b, buildings, scopeIds: null });
  assert.deepEqual(all.items.map((item) => item.id), ["a", "b", "c", "d"]);
  assert.deepEqual(all.buildings.map((building) => building.id), ["p1", "p2", "p3"]);
  assert.deepEqual(all.loose.map((item) => item.id), ["c", "d"]);

  // Руководитель точки p1: чужая p2 не видна ни в местах, ни в «Без точки».
  const p1 = scopePlaces({ items, buildingIdOf: (item) => item.b, buildings, scopeIds: new Set(["p1"]) });
  assert.deepEqual(p1.items.map((item) => item.id), ["a", "c", "d"]);
  assert.deepEqual(p1.buildings.map((building) => building.id), ["p1"]);
  assert.deepEqual(p1.loose.map((item) => item.id), ["c", "d"]);

  // Офис — место, только когда у него есть объекты.
  const withOffice = scopePlaces({ items: [...items, { id: "e", b: "office" }], buildingIdOf: (item) => item.b, buildings, scopeIds: null });
  assert.deepEqual(withOffice.buildings.map((building) => building.id), ["office", "p1", "p2", "p3"]);
});

test("параметр адреса", () => {
  assert.equal(placeFilterParam(undefined), null);
  assert.equal(placeFilterParam("  "), null);
  assert.equal(placeFilterParam(["p1", "p2"]), "p1");
});
