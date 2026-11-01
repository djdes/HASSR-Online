import assert from "node:assert/strict";
import test from "node:test";

import { agentMayTakeJob, canManageAgentPoint, pointsWithOwnAgent, printJobQueueWhere } from "./print-point-routing";

const A = "point-a";
const B = "point-b";

test("агент точки берёт задания своей точки и общие, чужой точки — нет", () => {
  const agentA = { buildingId: A };
  assert.equal(agentMayTakeJob(agentA, A, [A, B]), true);
  assert.equal(agentMayTakeJob(agentA, null, [A, B]), true);
  assert.equal(agentMayTakeJob(agentA, B, [A, B]), false);
  assert.equal(agentMayTakeJob(agentA, B, [A]), false, "даже если у точки Б принтера нет");
});

test("общий принтер организации берёт общие и задания точек без своего принтера", () => {
  const orgWide = { buildingId: null };
  assert.equal(agentMayTakeJob(orgWide, null, [A]), true);
  assert.equal(agentMayTakeJob(orgWide, B, [A]), true, "у точки Б своего принтера нет");
  assert.equal(agentMayTakeJob(orgWide, A, [A]), false, "у точки А свой принтер");
  assert.equal(agentMayTakeJob(orgWide, A, []), true, "организация с одним общим принтером печатает как раньше");
});

test("точки со своим принтером — только у подключённых агентов с точкой", () => {
  const points = pointsWithOwnAgent([
    { buildingId: A },
    { buildingId: A },
    { buildingId: null },
    { buildingId: B, revokedAt: new Date() },
  ]);
  assert.deepEqual(points, [A]);
});

test("условие очереди совпадает с правилом", () => {
  assert.deepEqual(printJobQueueWhere({ buildingId: A }, [A, B]), { OR: [{ buildingId: null }, { buildingId: A }] });
  assert.deepEqual(printJobQueueWhere({ buildingId: null }, []), {});
  assert.deepEqual(printJobQueueWhere({ buildingId: null }, [A]), { OR: [{ buildingId: null }, { buildingId: { notIn: [A] } }] });
});

test("руководитель точки ставит и отключает только принтеры своих точек", () => {
  assert.equal(canManageAgentPoint({ scope: null, current: B, target: null }), true, "руководство компании — любую точку и «Вся организация»");
  assert.equal(canManageAgentPoint({ scope: [A], current: A, target: A }), true);
  assert.equal(canManageAgentPoint({ scope: [A], current: B, target: A }), false, "чужой принтер");
  assert.equal(canManageAgentPoint({ scope: [A], current: null, target: A }), false, "общий принтер ведёт руководство компании");
  assert.equal(canManageAgentPoint({ scope: [A], current: A, target: null }), false, "на всю организацию — нельзя");
  assert.equal(canManageAgentPoint({ scope: [A], current: A, target: B }), false, "на чужую точку — нельзя");
  assert.equal(canManageAgentPoint({ scope: [A], current: A }), true, "отключить свой");
});
