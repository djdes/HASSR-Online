import assert from "node:assert/strict";
import test from "node:test";

import {
  documentInWorkerScope,
  documentWorkerScopeWhere,
  makeDocumentPointFilter,
  personInWorkerScope,
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
