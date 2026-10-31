import assert from "node:assert/strict";
import test from "node:test";

import { mergePointPools, type PoolForDayResult } from "./journal-task-pool";

// 2026-10-31: «Сегодня» на точке A показывало холодильники и документ
// гигиены точки B. Подборка строится по точке; у руководства в режиме
// «Вся организация» — по каждой точке отдельно, с названием точки.
const pool = (scopes: PoolForDayResult["scopes"]): PoolForDayResult => ({
  journalCode: "cold_equipment_control",
  dateKey: "2026-10-31",
  pool: true,
  scopes,
});

test("одна точка — подборка как есть, без подписи точки", () => {
  const only = pool([{ scopeKey: "fridge:a:morning:2026-10-31", scopeLabel: "ШХ-1 — Утро", sublabel: "Горячий цех" }]);
  assert.equal(mergePointPools("cold_equipment_control", "2026-10-31", [{ point: { id: "A", name: "Точка 1" }, pool: only }]), only);
});

test("несколько точек — задачи каждой с названием точки, общий объект один раз", () => {
  const merged = mergePointPools("cold_equipment_control", "2026-10-31", [
    {
      point: { id: "A", name: "Точка 1" },
      pool: pool([
        { scopeKey: "fridge:a:morning:2026-10-31", scopeLabel: "ШХ-1 — Утро", sublabel: "Горячий цех" },
        { scopeKey: "fridge:shared:morning:2026-10-31", scopeLabel: "Общая камера — Утро" },
      ]),
    },
    {
      point: { id: "B", name: "Точка 2" },
      pool: pool([
        { scopeKey: "fridge:b:morning:2026-10-31", scopeLabel: "ШХ-2 — Утро", sublabel: "Холодный цех" },
        { scopeKey: "fridge:shared:morning:2026-10-31", scopeLabel: "Общая камера — Утро" },
      ]),
    },
  ]);
  assert.deepEqual(
    merged.scopes.map((scope) => [scope.scopeKey, scope.sublabel]),
    [
      ["fridge:a:morning:2026-10-31", "Точка 1 · Горячий цех"],
      ["fridge:shared:morning:2026-10-31", "Точка 1"],
      ["fridge:b:morning:2026-10-31", "Точка 2 · Холодный цех"],
    ],
  );
});

test("переведённая подпись задачи остаётся, переведённая подпись под ней — уступает точке", () => {
  const merged = mergePointPools("climate_control", "2026-10-31", [
    {
      point: { id: "A", name: "Точка 1" },
      pool: pool([
        {
          scopeKey: "room:r1:morning:2026-10-31",
          scopeLabel: "Склад — Утро",
          sublabel: "Климат-контроль",
          displayCopy: { version: 1, scopeLabel: { key: "climateShift", params: { name: "Склад", shift: "morning" } }, sublabel: { key: "climateHint" } },
        },
      ]),
    },
    { point: { id: "B", name: "Точка 2" }, pool: pool([]) },
  ]);
  assert.deepEqual(merged.scopes[0].displayCopy, { version: 1, scopeLabel: { key: "climateShift", params: { name: "Склад", shift: "morning" } } });
  assert.equal(merged.scopes[0].sublabel, "Точка 1 · Климат-контроль");
});
