import assert from "node:assert/strict";
import test from "node:test";

import {
  REQUESTS_PER_DAY,
  REQUEST_MODES,
  REQUEST_STATUSES,
  REQUEST_TTL_DAYS,
  REQUEST_TTL_MS,
  decideRequestCreation,
  decideRequestDecision,
  exchangeKindsLabel,
  isRequestMode,
  isRequestStale,
  isRequestStatus,
  narrowAllowedKinds,
  requestExpiresAt,
} from "@/lib/directory-exchange/requests";
import type { AccountPhase } from "@/lib/org-trial";

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-11-19T10:00:00.000Z");
const days = (n: number) => new Date(NOW.getTime() + n * DAY);

const creation = (over: Partial<Parameters<typeof decideRequestCreation>[0]> = {}) =>
  decideRequestCreation({
    phase: "paid",
    sameAccount: false,
    hasOpenRequest: false,
    alreadyMember: false,
    requestsToday: 0,
    kinds: ["products", "staff"],
    ...over,
  });

const decision = (over: Partial<Parameters<typeof decideRequestDecision>[0]> = {}) =>
  decideRequestDecision({ status: "pending", expiresAt: days(3), now: NOW, isCabinetOwner: true, ...over });

test("constants: seven days to decide, five requests a day, two modes, five statuses", () => {
  assert.equal(REQUEST_TTL_DAYS, 7);
  assert.equal(REQUEST_TTL_MS, 7 * DAY);
  assert.equal(REQUESTS_PER_DAY, 5);
  assert.deepEqual([...REQUEST_MODES], ["link", "transfer"]);
  assert.deepEqual([...REQUEST_STATUSES], ["pending", "approved", "declined", "cancelled", "expired"]);
  assert.equal(requestExpiresAt(NOW).getTime(), days(7).getTime());
  assert.ok(isRequestMode("link") && isRequestMode("transfer") && !isRequestMode("sync") && !isRequestMode(null));
  assert.ok(isRequestStatus("expired") && !isRequestStatus("open"));
});

test("creation: a paid account with a foreign cabinet and at least one list may ask", () => {
  assert.deepEqual(creation(), { ok: true, kinds: ["products", "staff"] });
  // Lists come back clean: no repeats, no garbage, in the fixed order.
  assert.deepEqual(creation({ kinds: ["equipment", "nope", "products", "equipment"] }), { ok: true, kinds: ["products", "equipment"] });
});

test("creation, rule Р1: only a paid account — trial, free and tariff-less accounts are refused with 402", () => {
  for (const phase of ["trial", "free", "open"] as AccountPhase[]) {
    const refused = creation({ phase });
    assert.equal(refused.ok, false, phase);
    assert.ok(!refused.ok && refused.reason === "not_paid" && refused.status === 402, phase);
  }
});

test("creation: no list chosen — 400, whatever else is true", () => {
  for (const kinds of [[], ["nope"], "staff", null, undefined]) {
    const refused = creation({ kinds });
    assert.ok(!refused.ok && refused.reason === "no_kinds" && refused.status === 400, JSON.stringify(kinds));
  }
});

test("creation: own cabinet, an open request and an existing membership are 409", () => {
  const own = creation({ sameAccount: true });
  assert.ok(!own.ok && own.reason === "own_cabinet" && own.status === 409);
  const open = creation({ hasOpenRequest: true });
  assert.ok(!open.ok && open.reason === "open_request" && open.status === 409);
  const member = creation({ alreadyMember: true });
  assert.ok(!member.ok && member.reason === "already_member" && member.status === 409);
});

test("creation, rule Р2: the sixth request of the day is refused with 429", () => {
  assert.equal(creation({ requestsToday: REQUESTS_PER_DAY - 1 }).ok, true);
  for (const requestsToday of [REQUESTS_PER_DAY, REQUESTS_PER_DAY + 3]) {
    const refused = creation({ requestsToday });
    assert.ok(!refused.ok && refused.reason === "daily_limit" && refused.status === 429, String(requestsToday));
  }
  // A broken counter never opens the gate wider than an empty one.
  assert.equal(creation({ requestsToday: Number.NaN }).ok, true);
  assert.equal(creation({ requestsToday: -4 }).ok, true);
});

test("creation: what depends on the requester alone is refused before anything about the cabinet", () => {
  // A free account learns nothing about the code it typed: tariff first.
  const everything = { sameAccount: true, hasOpenRequest: true, alreadyMember: true, requestsToday: 99 };
  const free = creation({ ...everything, phase: "free" });
  assert.ok(!free.ok && free.reason === "not_paid");
  const noKinds = creation({ ...everything, phase: "free", kinds: [] });
  assert.ok(!noKinds.ok && noKinds.reason === "no_kinds");
  // Paid but over the daily limit: 429 before the cabinet is even looked at.
  const limited = creation(everything);
  assert.ok(!limited.ok && limited.reason === "daily_limit");
  // Then the cabinet: own → member → open request.
  const own = creation({ ...everything, requestsToday: 0 });
  assert.ok(!own.ok && own.reason === "own_cabinet");
  const member = creation({ ...everything, requestsToday: 0, sameAccount: false });
  assert.ok(!member.ok && member.reason === "already_member");
});

test("creation: every refusal carries a text for the person", () => {
  const refusals = [
    creation({ kinds: [] }),
    creation({ phase: "trial" }),
    creation({ requestsToday: 5 }),
    creation({ sameAccount: true }),
    creation({ alreadyMember: true }),
    creation({ hasOpenRequest: true }),
  ];
  const reasons = new Set<string>();
  for (const refusal of refusals) {
    assert.ok(!refusal.ok && refusal.message.length > 10);
    if (!refusal.ok) reasons.add(refusal.reason);
  }
  assert.equal(reasons.size, refusals.length);
});

test("decision: the cabinet owner decides a pending request within its term", () => {
  assert.deepEqual(decision(), { ok: true });
  assert.deepEqual(decision({ expiresAt: new Date(NOW.getTime() + 1) }), { ok: true });
});

test("decision: anyone but the cabinet owner gets 403 and learns nothing about the request", () => {
  for (const status of ["pending", "approved", "declined", "cancelled", "expired"]) {
    const refused = decision({ status, isCabinetOwner: false, expiresAt: days(-1) });
    assert.ok(!refused.ok && refused.reason === "not_owner" && refused.status === 403, status);
  }
});

test("decision: an expired request cannot be decided — by status or by date", () => {
  const byStatus = decision({ status: "expired" });
  assert.ok(!byStatus.ok && byStatus.reason === "expired" && byStatus.status === 409);
  const byDate = decision({ expiresAt: days(-1) });
  assert.ok(!byDate.ok && byDate.reason === "expired" && byDate.status === 409);
  // The very last moment is already too late.
  const edge = decision({ expiresAt: NOW });
  assert.ok(!edge.ok && edge.reason === "expired");
});

test("decision: a second decision and a cancelled request are 409", () => {
  for (const status of ["approved", "declined"]) {
    const refused = decision({ status });
    assert.ok(!refused.ok && refused.reason === "decided" && refused.status === 409, status);
  }
  const cancelled = decision({ status: "cancelled" });
  assert.ok(!cancelled.ok && cancelled.reason === "cancelled" && cancelled.status === 409);
  // A decided request stays decided even after its date has passed.
  const late = decision({ status: "approved", expiresAt: days(-30) });
  assert.ok(!late.ok && late.reason === "decided");
  // An unknown status is never decidable.
  assert.equal(decision({ status: "whatever" }).ok, false);
});

test("stale: only a pending request past its date", () => {
  assert.equal(isRequestStale("pending", days(-1), NOW), true);
  assert.equal(isRequestStale("pending", NOW, NOW), true);
  assert.equal(isRequestStale("pending", days(1), NOW), false);
  assert.equal(isRequestStale("approved", days(-1), NOW), false);
  assert.equal(isRequestStale("cancelled", days(-1), NOW), false);
});

test("allowed lists, rule Р3: never wider than requested", () => {
  assert.deepEqual(narrowAllowedKinds(["products", "staff"], ["staff", "equipment", "objects"]), ["staff"]);
  assert.deepEqual(narrowAllowedKinds(["staff"], ["products", "staff", "objects", "equipment"]), ["staff"]);
  // Order and repeats of the owner's ticks do not matter.
  assert.deepEqual(narrowAllowedKinds(["equipment", "products", "staff"], ["staff", "products", "staff"]), ["products", "staff"]);
  assert.deepEqual(narrowAllowedKinds(["products", "staff"], ["products", "staff"]), ["products", "staff"]);
});

test("allowed lists: nothing passed means everything requested", () => {
  assert.deepEqual(narrowAllowedKinds(["staff", "products"], undefined), ["products", "staff"]);
  assert.deepEqual(narrowAllowedKinds(["objects"], null), ["objects"]);
});

test("allowed lists: an approval is never empty — null instead of an empty list", () => {
  assert.equal(narrowAllowedKinds(["products"], []), null);
  assert.equal(narrowAllowedKinds(["products"], ["staff"]), null);
  assert.equal(narrowAllowedKinds(["products"], ["nope"]), null);
  assert.equal(narrowAllowedKinds(["products"], "products"), null);
  assert.equal(narrowAllowedKinds([], ["products"]), null);
  assert.equal(narrowAllowedKinds([], undefined), null);
  assert.equal(narrowAllowedKinds("garbage", undefined), null);
});

test("list names for letters", () => {
  assert.equal(exchangeKindsLabel(["staff", "products"]), "Продукция, Сотрудники");
  assert.equal(exchangeKindsLabel(["equipment", "objects"]), "Объекты, Оборудование");
  assert.equal(exchangeKindsLabel(["nope"]), "");
});
