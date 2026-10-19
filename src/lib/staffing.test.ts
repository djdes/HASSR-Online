import assert from "node:assert/strict";
import test from "node:test";

import {
  computeStaffing,
  countOccupiedByPosition,
  parsePlannedHeadcount,
  planPositionOrder,
  positionStaffing,
  staffingTotals,
} from "@/lib/staffing";

const active = (jobPositionId: string | null) => ({ jobPositionId, isActive: true, archivedAt: null });

test("занято считает только активных и не в архиве", () => {
  const counts = countOccupiedByPosition([
    active("cook"),
    active("cook"),
    { jobPositionId: "cook", isActive: false, archivedAt: null },
    { jobPositionId: "cook", isActive: true, archivedAt: new Date("2026-10-01") },
    active(null),
    active("chef"),
  ]);
  assert.equal(counts.get("cook"), 2);
  assert.equal(counts.get("chef"), 1);
  assert.equal(counts.size, 2);
});

test("должность: вакансии, перебор и подпись", () => {
  assert.deepEqual(positionStaffing(5, 3), {
    plannedHeadcount: 5,
    occupied: 3,
    vacancies: 2,
    overstaffed: 0,
    staffingLabel: "занято 3 из 5",
  });
  assert.deepEqual(positionStaffing(2, 4), {
    plannedHeadcount: 2,
    occupied: 4,
    vacancies: 0,
    overstaffed: 2,
    staffingLabel: "занято 4 из 2",
  });
  assert.deepEqual(positionStaffing(null, 3), {
    plannedHeadcount: null,
    occupied: 3,
    vacancies: 0,
    overstaffed: 0,
    staffingLabel: "занято 3",
  });
  assert.equal(positionStaffing(0, 0).staffingLabel, "занято 0 из 0");
  // Мусор из базы — «не задано».
  assert.equal(positionStaffing(-1, 1).plannedHeadcount, null);
  assert.equal(positionStaffing(2.5, 1).plannedHeadcount, null);
});

test("итоги организации сравнивают план только с должностями, где он задан", () => {
  const totals = staffingTotals([positionStaffing(5, 3), positionStaffing(2, 4), positionStaffing(null, 7)]);
  assert.deepEqual(totals, {
    positions: 3,
    withPlan: 2,
    planned: 7,
    occupied: 14,
    occupiedPlanned: 7,
    vacancies: 2,
    overstaffed: 2,
    staffingLabel: "занято 7 из 7",
  });
  assert.equal(staffingTotals([positionStaffing(null, 2)]).staffingLabel, "занято 2");
  assert.equal(staffingTotals([]).staffingLabel, "занято 0");
});

test("computeStaffing дополняет должности и сохраняет их поля", () => {
  const result = computeStaffing(
    [
      { id: "cook", name: "Повар", plannedHeadcount: 3 },
      { id: "chef", name: "Шеф", plannedHeadcount: null },
    ],
    [active("cook"), active("chef"), active("chef")]
  );
  assert.equal(result.positions[0].name, "Повар");
  assert.equal(result.positions[0].vacancies, 2);
  assert.equal(result.positions[1].staffingLabel, "занято 2");
  assert.equal(result.totals.staffingLabel, "занято 1 из 3");
});

test("значение из запроса: целое 0…999 или null", () => {
  assert.deepEqual(parsePlannedHeadcount(undefined), { ok: true, value: undefined });
  assert.deepEqual(parsePlannedHeadcount(null), { ok: true, value: null });
  assert.deepEqual(parsePlannedHeadcount(0), { ok: true, value: 0 });
  assert.deepEqual(parsePlannedHeadcount(999), { ok: true, value: 999 });
  for (const bad of [-1, 1000, 1.5, "3", Number.NaN, true, {}]) {
    assert.equal(parsePlannedHeadcount(bad).ok, false, String(bad));
  }
});

test("порядок должностей: присланные первыми, остальные — следом в прежнем порядке", () => {
  const current = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
  assert.deepEqual([...planPositionOrder(current, ["c", "a"]).entries()], [
    ["c", 1],
    ["a", 2],
    ["b", 3],
    ["d", 4],
  ]);
  assert.deepEqual([...planPositionOrder(current, ["d", "c", "b", "a"]).values()], [1, 2, 3, 4]);
});
