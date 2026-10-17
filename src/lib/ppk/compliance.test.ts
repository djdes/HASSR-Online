import assert from "node:assert/strict";
import test from "node:test";
import { productionControlChecks } from "./compliance";

const base = {
  hasProgramFile: false,
  progress: { done: 0, total: 10 },
  teamStatus: "empty" as const,
  controlPointsStatus: "empty" as const,
};

test("пустой раздел: три проверки, все провалены", () => {
  const checks = productionControlChecks(base);
  assert.deepEqual(checks.map((c) => c.id), ["ppk.program", "ppk.team", "ppk.ccp"]);
  assert.ok(checks.every((c) => c.status === "fail" && c.score === 0 && c.weight === 5));
});

test("программа: файл или прогресс от 60% — норма", () => {
  assert.equal(productionControlChecks({ ...base, hasProgramFile: true })[0].status, "ok");
  assert.equal(productionControlChecks({ ...base, progress: { done: 6, total: 10 } })[0].status, "ok");
  assert.equal(productionControlChecks({ ...base, progress: { done: 5, total: 10 } })[0].status, "warn");
  assert.equal(productionControlChecks({ ...base, progress: { done: 0, total: 0 } })[0].status, "fail");
});

test("группа и точки: done — норма, started — предупреждение; ссылки ведут на блоки", () => {
  const checks = productionControlChecks({ ...base, teamStatus: "done", controlPointsStatus: "started" });
  assert.equal(checks[1].status, "ok");
  assert.equal(checks[2].status, "warn");
  assert.equal(checks[1].fixUrl, "/production-control/haccp/team");
  assert.equal(checks[2].fixUrl, "/production-control/haccp/control-points");
});
