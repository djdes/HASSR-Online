import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPlaceOptions,
  groupByBuilding,
  pickMirrorArea,
  planAreaBuildingBackfill,
} from "./area-building";

test("заполнение: одноимённое помещение в одной точке → её точка (регистр и ё не важны)", () => {
  const plan = planAreaBuildingBackfill({
    buildings: [
      { id: "b1", organizationId: "o1" },
      { id: "b2", organizationId: "o1" },
    ],
    rooms: [
      { organizationId: "o1", buildingId: "b1", name: "Горячий цех" },
      { organizationId: "o1", buildingId: "b2", name: "Моечная тёмная" },
    ],
    areas: [
      { id: "a1", organizationId: "o1", name: "горячий  ЦЕХ", buildingId: null },
      { id: "a2", organizationId: "o1", name: "Моечная темная", buildingId: null },
    ],
  });
  assert.deepEqual(plan.assign, [
    { areaId: "a1", buildingId: "b1", reason: "room-name" },
    { areaId: "a2", buildingId: "b2", reason: "room-name" },
  ]);
  assert.deepEqual(plan.skipped, []);
});

test("заполнение: одноимённые помещения в двух точках — не угадываем", () => {
  const plan = planAreaBuildingBackfill({
    buildings: [
      { id: "b1", organizationId: "o1" },
      { id: "b2", organizationId: "o1" },
    ],
    rooms: [
      { organizationId: "o1", buildingId: "b1", name: "Кухня" },
      { organizationId: "o1", buildingId: "b2", name: "Кухня" },
    ],
    areas: [{ id: "a1", organizationId: "o1", name: "Кухня", buildingId: null }],
  });
  assert.deepEqual(plan.assign, []);
  assert.deepEqual(plan.skipped, [{ areaId: "a1", reason: "ambiguous" }]);
});

test("заполнение: точка одна — все цеха без точки уходят в неё, даже без помещения", () => {
  const plan = planAreaBuildingBackfill({
    buildings: [{ id: "b1", organizationId: "o1" }],
    rooms: [{ organizationId: "o1", buildingId: "b1", name: "Склад" }],
    areas: [
      { id: "a1", organizationId: "o1", name: "Склад", buildingId: null },
      { id: "a2", organizationId: "o1", name: "Основной цех", buildingId: null },
    ],
  });
  assert.deepEqual(plan.assign, [
    { areaId: "a1", buildingId: "b1", reason: "room-name" },
    { areaId: "a2", buildingId: "b1", reason: "single-building" },
  ]);
});

test("заполнение: уже заполненный цех не трогаем, повторный прогон пуст", () => {
  const buildings = [
    { id: "b1", organizationId: "o1" },
    { id: "b2", organizationId: "o1" },
  ];
  const rooms = [{ organizationId: "o1", buildingId: "b1", name: "Бар" }];
  const areas = [
    { id: "a1", organizationId: "o1", name: "Бар", buildingId: "b2" },
    { id: "a2", organizationId: "o1", name: "Бар", buildingId: null },
  ];
  const first = planAreaBuildingBackfill({ buildings, rooms, areas });
  assert.deepEqual(first.assign, [{ areaId: "a2", buildingId: "b1", reason: "room-name" }]);
  const applied = areas.map((area) => {
    const hit = first.assign.find((item) => item.areaId === area.id);
    return hit ? { ...area, buildingId: hit.buildingId } : area;
  });
  assert.deepEqual(planAreaBuildingBackfill({ buildings, rooms, areas: applied }), { assign: [], skipped: [] });
});

test("заполнение: точки и помещения чужой организации не учитываются", () => {
  const plan = planAreaBuildingBackfill({
    buildings: [
      { id: "b1", organizationId: "o1" },
      { id: "b2", organizationId: "o1" },
      { id: "x1", organizationId: "o2" },
    ],
    rooms: [{ organizationId: "o2", buildingId: "x1", name: "Цех" }],
    areas: [
      { id: "a1", organizationId: "o1", name: "Цех", buildingId: null },
      { id: "a2", organizationId: "o3", name: "Цех", buildingId: null },
    ],
  });
  assert.deepEqual(plan.assign, []);
  assert.deepEqual(plan.skipped, [
    { areaId: "a1", reason: "no-match" },
    { areaId: "a2", reason: "no-buildings" },
  ]);
});

test("зеркальный цех: сначала своей точки, потом без точки, чужой точки — нет", () => {
  const areas = [
    { id: "other", name: "Кухня", buildingId: "b2" },
    { id: "loose", name: "кухня", buildingId: null },
    { id: "own", name: "Кухня ", buildingId: "b1" },
  ];
  assert.equal(pickMirrorArea(areas, "Кухня", "b1")?.id, "own");
  assert.equal(pickMirrorArea(areas.slice(0, 2), "Кухня", "b1")?.id, "loose");
  assert.equal(pickMirrorArea(areas.slice(0, 1), "Кухня", "b1"), null);
  assert.equal(pickMirrorArea(areas, "  ", "b1"), null);
});

const B1 = { id: "b1", name: "Точка 1", address: "ул. Ленина, 5" };
const B2 = { id: "b2", name: "Точка 2", address: null };

test("группировка: по точкам в их порядке, «без точки» в конце", () => {
  const items = [
    { id: "e1", buildingId: "b2" },
    { id: "e2", buildingId: null },
    { id: "e3", buildingId: "b1" },
    { id: "e4", buildingId: "deleted" },
  ];
  const groups = groupByBuilding(items, (item) => item.buildingId, [B1, B2]);
  assert.deepEqual(
    groups.map((group) => [group.building?.id ?? null, group.items.map((item) => item.id)]),
    [
      ["b1", ["e3"]],
      ["b2", ["e1"]],
      [null, ["e2", "e4"]],
    ],
  );
});

test("группировка: выбранная в шапке точка — только она и «без точки»", () => {
  const items = [
    { id: "e1", buildingId: "b2" },
    { id: "e2", buildingId: null },
    { id: "e3", buildingId: "b1" },
  ];
  const groups = groupByBuilding(items, (item) => item.buildingId, [B1, B2], { activeBuildingId: "b2" });
  assert.deepEqual(
    groups.map((group) => [group.building?.id ?? null, group.items.map((item) => item.id)]),
    [
      ["b2", ["e1"]],
      [null, ["e2"]],
    ],
  );
  // Неизвестная точка в куке — показываем все.
  assert.equal(groupByBuilding(items, (item) => item.buildingId, [B1, B2], { activeBuildingId: "zzz" }).length, 3);
});

test("группировка: пустые точки — только с keepEmpty, пустое «без точки» не показываем", () => {
  const items = [{ id: "e1", buildingId: "b1" }];
  assert.deepEqual(
    groupByBuilding(items, (item) => item.buildingId, [B1, B2]).map((group) => group.building?.id),
    ["b1"],
  );
  assert.deepEqual(
    groupByBuilding(items, (item) => item.buildingId, [B1, B2], { keepEmpty: true }).map((group) => group.building?.id),
    ["b1", "b2"],
  );
  assert.deepEqual(groupByBuilding([], (item: { buildingId: string | null }) => item.buildingId, []), []);
});

test("варианты помещений: цеха точки + помещения без цеха, цеха без точки отдельно", () => {
  const options = buildPlaceOptions({
    buildings: [B1, B2],
    areas: [
      { id: "a1", name: "Горячий цех", buildingId: "b1" },
      { id: "a2", name: "Склад", buildingId: null },
      { id: "a3", name: "Бар", buildingId: "b2" },
    ],
    rooms: [
      { id: "r1", name: "горячий цех", buildingId: "b1" },
      { id: "r2", name: "Основное производство", buildingId: "b1" },
      { id: "r3", name: "Зал", buildingId: "b2" },
    ],
  });
  assert.deepEqual(
    options.byBuilding.b1.map((option) => [option.key, option.areaId, option.roomId]),
    [
      ["area:a1", "a1", null],
      ["room:r2", null, "r2"],
    ],
  );
  assert.deepEqual(options.byBuilding.b2.map((option) => option.key), ["area:a3", "room:r3"]);
  assert.deepEqual(options.loose.map((option) => option.key), ["area:a2"]);
});
