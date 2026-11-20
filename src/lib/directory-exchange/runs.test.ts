import assert from "node:assert/strict";
import test from "node:test";

import {
  EXCHANGE_TRIGGERS,
  HEALTHY_WINDOW_MS,
  STALE_RUN_MS,
  cabinetProblem,
  displayRunStatus,
  isExchangeRunStatus,
  isExchangeTrigger,
  runErrorText,
  runTotals,
} from "@/lib/directory-exchange/runs";
import { emptyKindCounters } from "@/lib/directory-exchange/summary";

const NOW = new Date("2026-11-20T12:00:00.000Z");

test("triggers and statuses: only the known values", () => {
  assert.deepEqual(EXCHANGE_TRIGGERS, ["manual", "save", "approval", "schedule"]);
  assert.equal(isExchangeTrigger("schedule"), true);
  assert.equal(isExchangeTrigger("cron"), false);
  assert.equal(isExchangeTrigger(null), false);
  assert.equal(isExchangeRunStatus("busy"), true);
  assert.equal(isExchangeRunStatus("done"), false);
});

test("error text: first line, no stack, trimmed and capped", () => {
  const error = new Error("Мастер-кабинет не найден");
  assert.equal(runErrorText(error), "Мастер-кабинет не найден");
  const prisma = new Error("\n  Invalid `db.room.create()` invocation in\n/app/src/lib/x.ts:12:3\n\n  Unique constraint failed");
  assert.equal(runErrorText(prisma), "Invalid `db.room.create()` invocation in");
  assert.equal(runErrorText("  boom \t again "), "boom again");
  assert.equal(runErrorText({ message: "plain object" }), "plain object");
  assert.equal(runErrorText(new Error("")), "Error");
  assert.equal(runErrorText(undefined), "Ошибка");
  const long = runErrorText(new Error("x".repeat(2_000)));
  assert.equal(long.length, 500);
  assert.ok(long.endsWith("…"));
});

test("totals: created, updated and both kinds of skips summed over organizations and lists", () => {
  const a = emptyKindCounters();
  a.products = { created: 2, updated: 1, skippedLimit: 1, skippedConflict: 0 };
  a.staff = { created: 1, updated: 0, skippedLimit: 0, skippedConflict: 2 };
  const b = emptyKindCounters();
  b.journals = { created: 0, updated: 1, skippedLimit: 0, skippedConflict: 0 };
  const summary = {
    organizations: [
      { organizationId: "a", name: "A", kinds: a },
      { organizationId: "b", name: "B", kinds: b },
    ],
    notes: [],
  };
  assert.deepEqual(runTotals(summary), { created: 3, updated: 2, skipped: 3 });
  assert.deepEqual(runTotals({ organizations: [], notes: [] }), { created: 0, updated: 0, skipped: 0 });
});

test("display status: a run still «running» after 15 minutes was cut off", () => {
  const recent = new Date(NOW.getTime() - 60_000);
  const old = new Date(NOW.getTime() - STALE_RUN_MS - 1);
  assert.equal(displayRunStatus({ status: "running", startedAt: recent }, NOW), "running");
  assert.equal(displayRunStatus({ status: "running", startedAt: old }, NOW), "stale");
  assert.equal(displayRunStatus({ status: "ok", startedAt: old }, NOW), "ok");
  assert.equal(displayRunStatus({ status: "weird", startedAt: recent }, NOW), "error");
});

test("cabinet problem: last run failed, or no success within a day; busy alone is fine", () => {
  const hourAgo = new Date(NOW.getTime() - 3_600_000);
  const dayAndMore = new Date(NOW.getTime() - HEALTHY_WINDOW_MS - 1);
  assert.equal(cabinetProblem({ lastStatus: "error", lastOkAt: hourAgo, now: NOW }), "error");
  assert.equal(cabinetProblem({ lastStatus: "ok", lastOkAt: hourAgo, now: NOW }), null);
  assert.equal(cabinetProblem({ lastStatus: "busy", lastOkAt: hourAgo, now: NOW }), null);
  assert.equal(cabinetProblem({ lastStatus: "busy", lastOkAt: dayAndMore, now: NOW }), "no_success");
  assert.equal(cabinetProblem({ lastStatus: null, lastOkAt: null, now: NOW }), "no_success");
  assert.equal(cabinetProblem({ lastStatus: "running", lastOkAt: null, now: NOW }), "no_success");
});
