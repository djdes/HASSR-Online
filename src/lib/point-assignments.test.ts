import assert from "node:assert/strict";
import test from "node:test";

import {
  ASSIGNMENT_MAX_DAYS,
  addDaysToKey,
  assignmentBlocker,
  assignmentEndsAt,
  assignmentSurvivesEdit,
  dateKeyInTimeZone,
  keepPrimaryBuilding,
  placeBuildingOfUser,
  qrRosterPosition,
  planAssignment,
  restoreBuildingIds,
  shortDateLabel,
  startOfDayInTimeZone,
} from "./point-assignments";

const BUILDINGS = [
  { id: "office", kind: "office" },
  { id: "a", kind: "point" },
  { id: "b", kind: "point" },
  { id: "c", kind: "point" },
];

function plan(userBuildingIds: string[], target: string, mode: string, days = 3, hasActiveAssignment = false) {
  return planAssignment({ userBuildingIds, buildings: BUILDINGS, targetBuildingId: target, mode, days, hasActiveAssignment });
}

test("transfer: only the new point for the period, old points are kept for the return", () => {
  const result = plan(["a"], "b", "transfer");
  assert.deepEqual(result, {
    ok: true,
    plan: { nextBuildingIds: ["b"], removedBuildingIds: ["a"], addedBuilding: true },
  });
});

test("transfer to a point the person already has: the point stays permanent", () => {
  const result = plan(["a", "b"], "b", "transfer");
  assert.deepEqual(result, {
    ok: true,
    plan: { nextBuildingIds: ["b"], removedBuildingIds: ["a"], addedBuilding: false },
  });
  assert.deepEqual(restoreBuildingIds(["b"], { buildingId: "b", removedBuildingIds: ["a"], addedBuilding: false }), ["a", "b"]);
});

test("extra: both points for the period", () => {
  assert.deepEqual(plan(["a"], "b", "extra"), {
    ok: true,
    plan: { nextBuildingIds: ["a", "b"], removedBuildingIds: [], addedBuilding: true },
  });
});

test("restore after transfer and after extra returns exactly what was", () => {
  const transfer = plan(["a", "c"], "b", "transfer");
  assert.ok(transfer.ok);
  const afterTransfer = restoreBuildingIds(transfer.plan.nextBuildingIds, { buildingId: "b", ...transfer.plan });
  assert.deepEqual([...afterTransfer].sort(), ["a", "c"]);

  const extra = plan(["a"], "b", "extra");
  assert.ok(extra.ok);
  assert.deepEqual(restoreBuildingIds(extra.plan.nextBuildingIds, { buildingId: "b", ...extra.plan }), ["a"]);
});

test("restore is idempotent", () => {
  const ref = { buildingId: "b", removedBuildingIds: ["a"], addedBuilding: true };
  const once = restoreBuildingIds(["b"], ref);
  assert.deepEqual(once, ["a"]);
  assert.deepEqual(restoreBuildingIds(once, ref), once);
});

test("edits during the period are kept on return", () => {
  // Перевели a → b, за время замены отметили постоянную точку c.
  const ref = { buildingId: "b", removedBuildingIds: ["a"], addedBuilding: true };
  assert.deepEqual(restoreBuildingIds(["b", "c"], ref), ["a", "c"]);
  // Руководитель сам вернул a раньше срока — без дублей.
  assert.deepEqual(restoreBuildingIds(["b", "a"], ref), ["a"]);
});

test("removing the temporary point in a wholesale edit ends the assignment", () => {
  assert.equal(assignmentSurvivesEdit(["b", "c"], { buildingId: "b" }), true);
  assert.equal(assignmentSurvivesEdit(["a"], { buildingId: "b" }), false);
  assert.equal(assignmentSurvivesEdit([], { buildingId: "b" }), false);
});

test("an 'everywhere' employee and an office employee are rejected with clear reasons", () => {
  assert.deepEqual(plan([], "b", "transfer"), { ok: false, error: "everywhere" });
  // Остались только id удалённых точек — тоже «везде».
  assert.deepEqual(plan(["deleted"], "b", "extra"), { ok: false, error: "everywhere" });
  assert.deepEqual(plan(["office"], "b", "transfer"), { ok: false, error: "office_user" });
  assert.deepEqual(plan(["a"], "office", "extra"), { ok: false, error: "office_target" });
  assert.deepEqual(plan(["a"], "zzz", "extra"), { ok: false, error: "unknown_building" });
});

test("overlapping assignments for one person are rejected", () => {
  assert.deepEqual(plan(["a"], "c", "extra", 3, true), { ok: false, error: "overlap" });
});

test("already at the point", () => {
  assert.deepEqual(plan(["a", "b"], "b", "extra"), { ok: false, error: "already_there" });
  assert.deepEqual(plan(["b"], "b", "transfer"), { ok: false, error: "already_there" });
  assert.equal(
    assignmentBlocker({ userBuildingIds: ["a"], buildings: BUILDINGS, targetBuildingId: "b", mode: "transfer", hasActiveAssignment: false }),
    null,
  );
});

test("days and mode are validated", () => {
  assert.deepEqual(plan(["a"], "b", "transfer", 0), { ok: false, error: "bad_days" });
  assert.deepEqual(plan(["a"], "b", "transfer", ASSIGNMENT_MAX_DAYS + 1), { ok: false, error: "bad_days" });
  assert.deepEqual(plan(["a"], "b", "transfer", 2.5), { ok: false, error: "bad_days" });
  assert.equal(plan(["a"], "b", "transfer", ASSIGNMENT_MAX_DAYS).ok, true);
  assert.deepEqual(plan(["a"], "b", "move"), { ok: false, error: "bad_mode" });
});

test("main point: kept when still among the points or coming back after a transfer", () => {
  assert.equal(keepPrimaryBuilding("a", ["a", "b"]), "a");
  assert.equal(keepPrimaryBuilding("a", ["b"], ["a"]), "a");
  assert.equal(keepPrimaryBuilding("a", ["b", "c"]), null);
  assert.equal(keepPrimaryBuilding(null, ["a"]), null);
});

test("place of a person for notifications: one point, or the main one", () => {
  assert.equal(placeBuildingOfUser({ buildingIds: ["a"] }), "a");
  assert.equal(placeBuildingOfUser({ buildingIds: ["a", "b"], primaryBuildingId: "b" }), "b");
  assert.equal(placeBuildingOfUser({ buildingIds: ["a", "b"], primaryBuildingId: null }), null);
  assert.equal(placeBuildingOfUser({ buildingIds: ["a", "b"], primaryBuildingId: "c" }), null);
  assert.equal(placeBuildingOfUser({ buildingIds: [] }), null);
});

test("end of the period is midnight of today + N in the organization time zone", () => {
  // 27.10 22:30 по Москве = 19:30 UTC.
  const now = new Date("2026-10-27T19:30:00Z");
  const { endsAt, returnKey } = assignmentEndsAt(now, 1, "Europe/Moscow");
  assert.equal(returnKey, "2026-10-28");
  assert.equal(endsAt.toISOString(), "2026-10-27T21:00:00.000Z");
  // 28.10 01:00 по Москве — это уже 28-е.
  assert.equal(dateKeyInTimeZone(new Date("2026-10-27T22:00:00Z"), "Europe/Moscow"), "2026-10-28");
  assert.equal(startOfDayInTimeZone("2026-11-05", "Asia/Yekaterinburg").toISOString(), "2026-11-04T19:00:00.000Z");
  assert.equal(addDaysToKey("2026-10-27", 14), "2026-11-10");
  assert.equal(addDaysToKey("2026-12-31", 1), "2027-01-01");
  assert.equal(shortDateLabel("2026-11-05"), "05.11");
});

test("QR roster marks only substitutes of the point", () => {
  assert.equal(qrRosterPosition(["u1"], "u1", "Повар", "Замена"), "Повар · Замена");
  assert.equal(qrRosterPosition(["u1"], "u1", "", "Замена"), "Замена");
  assert.equal(qrRosterPosition(["u1"], "u2", "Повар", "Замена"), "Повар");
  assert.equal(qrRosterPosition(undefined, "u1", null, "Замена"), "");
});
