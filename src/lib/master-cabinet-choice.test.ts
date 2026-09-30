import assert from "node:assert/strict";
import test from "node:test";

import {
  initialMasterCabinetSelection,
  mapObjectsToCabinets,
  normalizeObjectIds,
  poolCodeOf,
  summarizeMasterCabinetChoice,
  type MasterCabinetObject,
} from "@/lib/master-cabinet-choice";

test("код пула: чужой код важнее своего", () => {
  assert.equal(poolCodeOf({ serviceCode: "OWN", linkedServiceCode: "LINK" }), "LINK");
  assert.equal(poolCodeOf({ serviceCode: "OWN", linkedServiceCode: null }), "OWN");
  assert.equal(poolCodeOf({ serviceCode: null, linkedServiceCode: null }), null);
  assert.equal(poolCodeOf(null), null);
});

test("кабинет объекта — первый кабинет с тем же кодом пула", () => {
  const objects = [
    { id: "school-1", name: "Школа 1", serviceCode: "S", linkedServiceCode: null },
    { id: "school-2", name: "Школа 2", serviceCode: "X", linkedServiceCode: "S" },
    { id: "kg-1", name: "Сад 1", serviceCode: null, linkedServiceCode: "K" },
    { id: "cafe", name: "Кафе", serviceCode: null, linkedServiceCode: null },
  ];
  const cabinets = [
    // Старый кабинет привязан к коду школы (создан из настроек пищеблока).
    { id: "m-schools", name: "Школы", serviceCode: null, linkedServiceCode: "S" },
    // Новый кабинет — со своим кодом (создан из меню профиля).
    { id: "m-kg", name: "Сады", serviceCode: "K", linkedServiceCode: null },
    // Второй кабинет того же пула не выбирается — берётся первый.
    { id: "m-schools-late", name: "Поздний", serviceCode: null, linkedServiceCode: "S" },
  ];
  const mapped = mapObjectsToCabinets(objects, cabinets);
  assert.deepEqual(
    mapped.map((object) => [object.id, object.currentCabinet?.id ?? null]),
    [
      ["school-1", "m-schools"],
      ["school-2", "m-schools"],
      ["kg-1", "m-kg"],
      ["cafe", null],
    ]
  );
});

const objects: MasterCabinetObject[] = [
  { id: "a", name: "Школа 1", currentCabinet: { id: "m1", name: "Мастер-кабинет — Школа 1" } },
  { id: "b", name: "Сад 1", currentCabinet: { id: "m1", name: "Мастер-кабинет — Школа 1" } },
  { id: "c", name: "Сад 2", currentCabinet: null },
  { id: "d", name: "Сад 3", currentCabinet: { id: "m2", name: "Другой" } },
];

test("сразу отмечены объекты без кабинета; у нового аккаунта — все", () => {
  assert.deepEqual(initialMasterCabinetSelection(objects), ["c"]);
  const fresh = objects.map((object) => ({ ...object, currentCabinet: null }));
  assert.deepEqual(initialMasterCabinetSelection(fresh), ["a", "b", "c", "d"]);
});

test("итог выбора: сколько объектов и из каких кабинетов они уходят", () => {
  assert.deepEqual(summarizeMasterCabinetChoice(objects, []), { selected: 0, moving: [] });
  assert.deepEqual(summarizeMasterCabinetChoice(objects, ["b", "c", "d", "zzz"]), {
    selected: 3,
    moving: [
      { cabinetName: "Мастер-кабинет — Школа 1", count: 1 },
      { cabinetName: "Другой", count: 1 },
    ],
  });
  assert.deepEqual(summarizeMasterCabinetChoice(objects, ["a", "b"]).moving, [
    { cabinetName: "Мастер-кабинет — Школа 1", count: 2 },
  ]);
});

test("id объектов из запроса: строки без повторов и пустых", () => {
  assert.deepEqual(normalizeObjectIds(["a", "a", "", "  ", 5, null, "b"]), ["a", "b"]);
  assert.deepEqual(normalizeObjectIds("a"), []);
  assert.deepEqual(normalizeObjectIds(undefined), []);
});
