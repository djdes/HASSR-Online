import assert from "node:assert/strict";
import test from "node:test";

import {
  extendedOrgTrialEnd,
  orgTrialAdminState,
  parseOrgTrialAdminAction,
  readTrialReuseSuspicion,
} from "./org-trial-admin";

const DAY = 86_400_000;

test("actions: extend by 1–60 whole days, clear, reset_grants; anything else is refused", () => {
  assert.deepEqual(parseOrgTrialAdminAction({ action: "extend", days: 7 }), { ok: true, value: { action: "extend", days: 7 } });
  assert.deepEqual(parseOrgTrialAdminAction({ action: "extend", days: "60" }), { ok: true, value: { action: "extend", days: 60 } });
  assert.deepEqual(parseOrgTrialAdminAction({ action: "clear" }), { ok: true, value: { action: "clear" } });
  assert.deepEqual(parseOrgTrialAdminAction({ action: "reset_grants", days: 5 }), { ok: true, value: { action: "reset_grants" } });
  for (const body of [null, {}, { action: "drop" }, { action: "extend" }, { action: "extend", days: 0 }, { action: "extend", days: 61 }, { action: "extend", days: 1.5 }, { action: "extend", days: "" }, { action: "extend", days: "x" }]) {
    assert.equal(parseOrgTrialAdminAction(body).ok, false, JSON.stringify(body));
  }
});

test("extension counts from the later of now and the current end, up to Moscow midnight", () => {
  const now = new Date("2026-11-20T10:00:00.000Z");
  // Current end in the future, already at Moscow midnight (21:00 UTC): moves exactly N days.
  const future = new Date("2026-11-25T21:00:00.000Z");
  assert.equal(extendedOrgTrialEnd(future, 7, now).toISOString(), new Date(future.getTime() + 7 * DAY).toISOString());
  // Current end in the past: from now, rounded up to the end of the Moscow day.
  const past = new Date("2026-11-10T21:00:00.000Z");
  assert.equal(extendedOrgTrialEnd(past, 1, now).toISOString(), "2026-11-21T21:00:00.000Z");
  // No mark: from now as well.
  assert.equal(extendedOrgTrialEnd(null, 3, now).toISOString(), "2026-11-23T21:00:00.000Z");
  // Always later than both now and the current end.
  for (const days of [1, 30, 60]) {
    const end = extendedOrgTrialEnd(past, days, now);
    assert.ok(end.getTime() >= now.getTime() + days * DAY);
  }
});

test("card state: no mark, own 14 days, locked, mark without effect", () => {
  const end = new Date("2026-11-25T21:00:00.000Z");
  assert.equal(orgTrialAdminState(null, null), "none");
  assert.equal(orgTrialAdminState(null, "locked"), "none");
  assert.equal(orgTrialAdminState(end, "trial"), "trial");
  assert.equal(orgTrialAdminState(end, "locked"), "locked");
  assert.equal(orgTrialAdminState(end, null), "inactive");
});

test("reuse suspicion rows read only the known detail fields", () => {
  const at = new Date("2026-11-19T08:00:00.000Z");
  assert.deepEqual(
    readTrialReuseSuspicion({
      id: "a1",
      action: "billing.trial.reuse_suspected",
      createdAt: at,
      details: { inn: "7707083893", phoneMatch: false, usedByOrganizationId: "org-x", usedByName: "Кафе", extra: "ignored" },
    }),
    { id: "a1", at: at.toISOString(), ended: false, inn: "7707083893", phoneMatch: false, usedByOrganizationId: "org-x", usedByName: "Кафе" },
  );
  assert.deepEqual(
    readTrialReuseSuspicion({ id: "a2", action: "billing.trial.reused", createdAt: at, details: null }),
    { id: "a2", at: at.toISOString(), ended: true, inn: null, phoneMatch: false, usedByOrganizationId: null, usedByName: null },
  );
  assert.equal(readTrialReuseSuspicion({ id: "a3", action: "billing.trial.reused", createdAt: at, details: { phoneMatch: "yes", inn: 123 } }).phoneMatch, false);
});
