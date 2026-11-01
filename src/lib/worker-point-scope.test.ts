import assert from "node:assert/strict";
import test from "node:test";

import {
  documentInWorkerScope,
  documentWorkerScopeWhere,
  lossWorkerScopeWhere,
  makeDocumentPointFilter,
  managerPointScope,
  personInWorkerScope,
  personWorkerScopeWhere,
  workerPointScope,
} from "./worker-point-scope";

// Аудит 2026-10-31: телефон «Сетап помощника» и бот Max сотрудника точки
// получали людей, блюда и документы всех точек.

test("область точек: выключены точки или человек на всех точках — без ограничения", () => {
  assert.equal(workerPointScope({ allTargets: [null], workTargets: [null] }), null);
  assert.equal(workerPointScope({ allTargets: ["A", "B"], workTargets: ["A", "B"] }), null);
  assert.equal(workerPointScope({ allTargets: ["A", "B"], workTargets: [] }), null);
  assert.deepEqual(workerPointScope({ allTargets: ["A", "B", "C"], workTargets: ["A"] }), {
    points: ["A"],
    orgBuildingIds: ["A", "B", "C"],
  });
});

test("документы области: свои точки и общие; чужая точка — нет", () => {
  const scope = workerPointScope({ allTargets: ["A", "B"], workTargets: ["A"] });
  assert.equal(documentInWorkerScope(scope, "A"), true);
  assert.equal(documentInWorkerScope(scope, null), true);
  assert.equal(documentInWorkerScope(scope, "B"), false);
  // id не из точек организации (удалённая точка) — не прячем.
  assert.equal(documentInWorkerScope(scope, "gone"), true);
  assert.equal(documentInWorkerScope(null, "B"), true);
  assert.deepEqual(documentWorkerScopeWhere(scope), { OR: [{ buildingId: null }, { buildingId: { in: ["A"] } }] });
  assert.deepEqual(documentWorkerScopeWhere(null), {});
});

test("люди области: своей точки, без точек и только с удалёнными точками; другой точки — нет", () => {
  const scope = workerPointScope({ allTargets: ["A", "B"], workTargets: ["A"] });
  assert.equal(personInWorkerScope(scope, ["A"]), true);
  assert.equal(personInWorkerScope(scope, []), true);
  assert.equal(personInWorkerScope(scope, ["gone"]), true);
  assert.equal(personInWorkerScope(scope, ["B"]), false);
  assert.equal(personInWorkerScope(scope, ["A", "B"]), true);
  assert.equal(personInWorkerScope(null, ["B"]), true);
});

test("документ точки: исполнители — сотрудники точки; общий документ и выключенные точки — все", () => {
  const buildingIdsByUser = new Map<string, string[]>([
    ["anna", ["A"]],
    ["boris", ["B"]],
    ["vera", []],
    ["dina", ["gone"]],
  ]);
  const atA = makeDocumentPointFilter({ targets: ["A", "B"], documentBuildingId: "A", buildingIdsByUser });
  assert.deepEqual(["anna", "boris", "vera", "dina", "unknown"].filter(atA), ["anna", "vera", "dina", "unknown"]);
  const shared = makeDocumentPointFilter({ targets: ["A", "B"], documentBuildingId: null, buildingIdsByUser });
  assert.equal(shared("boris"), true);
  const disabled = makeDocumentPointFilter({ targets: [null], documentBuildingId: "A", buildingIdsByUser });
  assert.equal(disabled("boris"), true);
});

test("область руководителя: офис и без точек — вся компания; руководитель точки — свои точки", () => {
  const buildings = [
    { id: "OFFICE", name: "Офис", address: null, kind: "office" },
    { id: "A", name: "Точка А", address: null },
    { id: "B", name: "Точка Б", address: null },
  ];
  // Руководитель офиса: workerPointScope сузил бы до офиса, здесь — все точки.
  assert.equal(managerPointScope({ enabled: true, buildings, userBuildingIds: ["OFFICE"] }), null);
  assert.equal(managerPointScope({ enabled: true, buildings, userBuildingIds: [] }), null);
  assert.equal(managerPointScope({ enabled: true, buildings, userBuildingIds: ["gone"] }), null);
  assert.deepEqual(managerPointScope({ enabled: true, buildings, userBuildingIds: ["A"] }), {
    points: ["A"],
    orgBuildingIds: ["OFFICE", "A", "B"],
  });
  // Организация без офиса: закреплённый за точкой видит только её.
  const noOffice = buildings.slice(1);
  assert.deepEqual(managerPointScope({ enabled: true, buildings: noOffice, userBuildingIds: ["B"] }), {
    points: ["B"],
    orgBuildingIds: ["A", "B"],
  });
  // Точки выключены или одна — без ограничения.
  assert.equal(managerPointScope({ enabled: false, buildings, userBuildingIds: ["A"] }), null);
  assert.equal(managerPointScope({ enabled: true, buildings: buildings.slice(1, 2), userBuildingIds: ["A"] }), null);
});

test("where людей и списаний области — то же правило, что в памяти", () => {
  const scope = workerPointScope({ allTargets: ["A", "B"], workTargets: ["A"] });
  assert.deepEqual(personWorkerScopeWhere(scope), {
    OR: [{ buildingIds: { hasSome: ["A"] } }, { NOT: { buildingIds: { hasSome: ["A", "B"] } } }],
  });
  assert.deepEqual(personWorkerScopeWhere(null), {});
  assert.deepEqual(lossWorkerScopeWhere(scope, ["areaA", "shared"]), {
    OR: [
      { buildingId: { in: ["A"] } },
      { buildingId: null, areaId: null },
      { buildingId: null, areaId: { in: ["areaA", "shared"] } },
    ],
  });
  assert.deepEqual(lossWorkerScopeWhere(null, []), {});
});
