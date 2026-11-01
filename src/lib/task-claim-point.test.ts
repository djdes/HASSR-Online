import assert from "node:assert/strict";
import test from "node:test";

import { pickScopePoint, placeRefFromScopeKey } from "./task-claim-point";

// Аудит 2026-11-01: ключ задачи с клиента — свободный текст.

test("задача из подборки своей точки — найдена с точкой; чужой ключ — нет", () => {
  const pools = [
    { pointId: "A", pool: true, scopeKeys: ["fridge:fA:2026-11-01"] },
    { pointId: "B", pool: true, scopeKeys: ["fridge:fB:2026-11-01"] },
  ];
  assert.deepEqual(pickScopePoint(pools, "fridge:fB:2026-11-01"), { pool: true, found: true, pointId: "B" });
  assert.deepEqual(pickScopePoint(pools.slice(0, 1), "fridge:fB:2026-11-01"), { pool: true, found: false });
});

test("журнал без подборки и точки выключены", () => {
  assert.deepEqual(pickScopePoint([{ pointId: null, pool: false, scopeKeys: [] }], "x"), { pool: false });
  assert.deepEqual(pickScopePoint([], "x"), { pool: false });
  assert.deepEqual(pickScopePoint([{ pointId: null, pool: true, scopeKeys: ["x"] }], "x"), {
    pool: true,
    found: true,
    pointId: null,
  });
});

test("объект задачи из ключа: оборудование и документ гигиены", () => {
  assert.deepEqual(placeRefFromScopeKey("fridge:eq1:morning:2026-11-01"), { equipmentId: "eq1" });
  assert.deepEqual(placeRefFromScopeKey("uv:lamp1:2026-11-01"), { equipmentId: "lamp1" });
  assert.deepEqual(placeRefFromScopeKey("fryer:default:2026-11-01:A"), {});
  assert.deepEqual(placeRefFromScopeKey("hygiene-shift:doc1:2026-11-01"), { documentId: "doc1" });
  assert.deepEqual(placeRefFromScopeKey("room:r1:2026-11-01"), {});
});
