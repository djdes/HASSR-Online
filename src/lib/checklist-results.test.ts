import test from "node:test";
import assert from "node:assert/strict";

import {
  canReviewInspection,
  hasViolations,
  parseChecklistResultFilters,
  resultPeriodStart,
  summarizeChecklistResult,
} from "./checklist-results";

test("сводка результата проверки", () => {
  assert.deepEqual(
    summarizeChecklistResult({ score: { earned: 7.5, possible: 10 }, violations: [{}, {}], critical: [{}], stopped: true }),
    { earned: 7.5, possible: 10, percent: 75, violations: 2, critical: 1, stopped: true },
  );
  assert.deepEqual(summarizeChecklistResult({ score: { earned: 0, possible: 0 }, violations: [], critical: [], stopped: false })?.percent, null);
  assert.equal(summarizeChecklistResult(null), null);
  assert.equal(summarizeChecklistResult({ violations: [] }), null);
  assert.equal(summarizeChecklistResult("x"), null);
});

test("фильтры истории из адреса", () => {
  assert.deepEqual(parseChecklistResultFilters({}), { templateId: null, period: "30", violationsOnly: false });
  assert.deepEqual(parseChecklistResultFilters({ template: "t1", period: "all", violations: "1" }), { templateId: "t1", period: "all", violationsOnly: true });
  assert.deepEqual(parseChecklistResultFilters({ template: ["t2", "t3"], period: "5" }), { templateId: "t2", period: "30", violationsOnly: false });
  const now = new Date("2026-10-19T12:00:00Z");
  assert.equal(resultPeriodStart("all", now), null);
  assert.equal(resultPeriodStart("7", now)?.toISOString(), "2026-10-12T12:00:00.000Z");
});

test("«только с нарушениями» и «Принять результат»", () => {
  assert.equal(hasViolations(null), false);
  assert.equal(hasViolations({ earned: 1, possible: 1, percent: 100, violations: 0, critical: 0, stopped: false }), false);
  assert.equal(hasViolations({ earned: 1, possible: 2, percent: 50, violations: 1, critical: 0, stopped: false }), true);
  const base = { status: "completed", reviewedAt: null, verifierUserId: "chef", userId: "chef", isAdmin: false };
  assert.equal(canReviewInspection(base), true);
  assert.equal(canReviewInspection({ ...base, userId: "cook" }), false);
  assert.equal(canReviewInspection({ ...base, userId: "owner", isAdmin: true }), true);
  assert.equal(canReviewInspection({ ...base, verifierUserId: null, userId: "owner", isAdmin: true }), true);
  assert.equal(canReviewInspection({ ...base, status: "draft" }), false);
  assert.equal(canReviewInspection({ ...base, reviewedAt: new Date() }), false);
});
