import assert from "node:assert/strict";
import test from "node:test";

import {
  IIKO_STORE_SKIP,
  iikoStoreDecision,
  iikoStoreViews,
  pointByKpp,
  readIikoStorePoints,
  resolveAcceptancePoint,
  supplyPointAccessFrom,
} from "./supply-points";

// Владелец, 2026-11-01: ЭДО — приёмка на выбранную точку, склады iiko — по точкам.
const BUILDINGS = [
  { id: "A", kpp: "500102001" },
  { id: "B", kpp: "500103001" },
  { id: "C", kpp: "500101001" },
  { id: "D", kpp: "500101001" },
];

test("точка по КПП: грузополучатель, затем покупатель; КПП у нескольких точек — нет точки", () => {
  assert.equal(pointByKpp([{ kpp: "500102001" }, { kpp: "500103001" }], BUILDINGS), "A");
  assert.equal(pointByKpp([null, { kpp: "500103001" }], BUILDINGS), "B");
  assert.equal(pointByKpp([{ kpp: " 5001-03-001 " }], BUILDINGS), "B", "КПП с пробелами и дефисами");
  // У двух точек одинаковый КПП (одно юрлицо) — не угадываем.
  assert.equal(pointByKpp([{ kpp: "500101001" }, { kpp: "500102001" }], BUILDINGS), null);
  assert.equal(pointByKpp([{ kpp: "770101001" }], BUILDINGS), null);
  assert.equal(pointByKpp([{ kpp: null }, undefined], BUILDINGS), null);
  assert.equal(pointByKpp([{ kpp: "123" }], BUILDINGS), null, "неполный КПП");
});

test("склады iiko: подразделение в подписи, сортировка; сохранённое — без мусора", () => {
  const views = iikoStoreViews(
    [
      { id: "s2", name: "Склад бара", parentId: "d1" },
      { id: "s1", name: "Склад кухни", parentId: "d2" },
      { id: "s3", name: "Общий склад", parentId: null },
    ],
    [
      { id: "d1", name: "Кафе на Ленина" },
      { id: "d2", name: "Гимназия № 4" },
    ],
  );
  assert.deepEqual(
    views.map((view) => [view.id, view.department]),
    [["s3", null], ["s1", "Гимназия № 4"], ["s2", "Кафе на Ленина"]],
  );
  assert.deepEqual(readIikoStorePoints(null), { stores: [], map: {} });
  assert.deepEqual(
    readIikoStorePoints({ stores: [{ id: "s1", name: "Кухня" }, { id: 5 }], map: { s1: "A", s2: "", s3: 7 } }),
    { stores: [{ id: "s1", name: "Кухня", department: null }], map: { s1: "A" } },
  );
});

test("склад → точка: своя точка, «не загружать», удалённая точка и склад без сопоставления — без точки", () => {
  const map = { s1: "A", s2: IIKO_STORE_SKIP, s3: "gone" };
  const live = new Set(["A", "B"]);
  assert.deepEqual(iikoStoreDecision("s1", map, live), { skip: false, buildingId: "A" });
  assert.deepEqual(iikoStoreDecision("s2", map, live), { skip: true, buildingId: null });
  assert.deepEqual(iikoStoreDecision("s3", map, live), { skip: false, buildingId: null });
  assert.deepEqual(iikoStoreDecision("s9", map, live), { skip: false, buildingId: null });
  assert.deepEqual(iikoStoreDecision(null, map, live), { skip: false, buildingId: null });
  // Точки выключены: «не загружать» действует, точек нет.
  assert.deepEqual(iikoStoreDecision("s1", map, new Set()), { skip: false, buildingId: null });
  assert.deepEqual(iikoStoreDecision("s2", map, new Set()), { skip: true, buildingId: null });
});

test("точка приёмки: обязательна при включённых точках, только доступная; без точек — null", () => {
  assert.deepEqual(resolveAcceptancePoint({ pointsEnabled: true, requested: "A", allowedPointIds: ["A", "B"] }), { ok: true, buildingId: "A" });
  assert.deepEqual(resolveAcceptancePoint({ pointsEnabled: true, requested: null, allowedPointIds: ["A"] }), { ok: false, error: "point_required" });
  assert.deepEqual(resolveAcceptancePoint({ pointsEnabled: true, requested: "B", allowedPointIds: ["A"] }), { ok: false, error: "point_forbidden" });
  assert.deepEqual(resolveAcceptancePoint({ pointsEnabled: false, requested: "A", allowedPointIds: [] }), { ok: true, buildingId: null });
});

test("входящие по точкам: точка — её и без точки; «Вся организация» — доступные и без точки; чужую не открыть", () => {
  const buildings = [
    { id: "A", name: "Точка 1" },
    { id: "B", name: "Точка 2" },
  ];
  const atPoint = supplyPointAccessFrom({ enabled: true, organizationView: false, activeBuildingId: "A", buildings });
  assert.equal(atPoint.viewedPointId, "A");
  assert.deepEqual(atPoint.listWhere, { OR: [{ buildingId: "A" }, { buildingId: null }] });
  const org = supplyPointAccessFrom({ enabled: true, organizationView: true, activeBuildingId: "A", buildings });
  assert.equal(org.viewedPointId, null);
  assert.deepEqual(org.listWhere, { OR: [{ buildingId: { in: ["A", "B"] } }, { buildingId: null }] });
  assert.deepEqual(atPoint.seeWhere, org.listWhere, "открыть можно накладную любой доступной точки");
  // Повар точки 1: точка 2 ему недоступна.
  const cook = supplyPointAccessFrom({ enabled: true, organizationView: false, activeBuildingId: "A", buildings: [buildings[0]] });
  assert.equal(cook.canSee("A"), true);
  assert.equal(cook.canSee(null), true);
  assert.equal(cook.canSee("B"), false);
  const off = supplyPointAccessFrom({ enabled: false, organizationView: true, activeBuildingId: null, buildings: [] });
  assert.deepEqual(off.listWhere, {});
  assert.deepEqual(off.seeWhere, {});
  assert.equal(off.canSee("B"), true);
  assert.deepEqual(off.points, []);
});
