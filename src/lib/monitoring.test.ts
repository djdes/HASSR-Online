import test from "node:test";
import assert from "node:assert/strict";

import {
  checklistMetric,
  journalMetric,
  metricPercent,
  MONITORING_ALL_POINTS,
  resolveMonitoringPoint,
  sumMetrics,
  type ChecklistAssignmentState,
} from "./monitoring";

test("процент: целый, нечего считать — null, больше 100 не бывает", () => {
  assert.equal(metricPercent({ done: 3, total: 4 }), 75);
  assert.equal(metricPercent({ done: 1, total: 3 }), 33);
  assert.equal(metricPercent({ done: 0, total: 0 }), null);
  assert.equal(metricPercent({ done: 5, total: 4 }), 100);
});

test("«Все точки» — сумма по точкам, а не среднее процентов", () => {
  assert.deepEqual(sumMetrics([{ done: 1, total: 2 }, { done: 9, total: 10 }]), { done: 10, total: 12 });
  assert.deepEqual(sumMetrics([]), { done: 0, total: 0 });
});

test("журналы: только включённые в набор точки", () => {
  const templates = [
    { id: "a", code: "hygiene" },
    { id: "b", code: "cleaning" },
    { id: "c", code: "fryer" },
  ];
  assert.deepEqual(journalMetric(templates, new Set(["fryer"]), new Set(["a", "c"])), { done: 1, total: 2 });
});

test("чек-листы: текущий период, без выключенных и архивных; точка — только свои назначения", () => {
  const rows: ChecklistAssignmentState[] = [
    { active: true, templateArchived: false, targetKind: "building", targetId: "p1", status: "done" },
    { active: true, templateArchived: false, targetKind: "building", targetId: "p1", status: "overdue" },
    { active: true, templateArchived: false, targetKind: "building", targetId: "p2", status: "pending" },
    { active: true, templateArchived: false, targetKind: "position", targetId: "x", status: "done" },
    { active: true, templateArchived: false, targetKind: "building", targetId: "p1", status: "off" },
    { active: false, templateArchived: false, targetKind: "building", targetId: "p1", status: "done" },
    { active: true, templateArchived: true, targetKind: "building", targetId: "p1", status: "done" },
  ];
  assert.deepEqual(checklistMetric(rows, null), { done: 2, total: 4 });
  assert.deepEqual(checklistMetric(rows, "p1"), { done: 1, total: 2 });
  assert.deepEqual(checklistMetric(rows, "p3"), { done: 0, total: 0 });
});

test("точка мониторинга: без параметра — точка из шапки, «all» — все точки, чужая — все точки", () => {
  const points = [{ id: "p1" }, { id: "p2" }];
  assert.equal(resolveMonitoringPoint(null, points, "p2"), "p2");
  assert.equal(resolveMonitoringPoint(null, points, null), null);
  assert.equal(resolveMonitoringPoint(MONITORING_ALL_POINTS, points, "p2"), null);
  assert.equal(resolveMonitoringPoint("p1", points, "p2"), "p1");
  assert.equal(resolveMonitoringPoint("other", points, "p2"), null);
  assert.equal(resolveMonitoringPoint(null, points, "office"), null);
});
