import assert from "node:assert/strict";
import test from "node:test";

import { computeAccountBilling, DEFAULT_TRIAL_SETTINGS } from "@/lib/billing-period";
import {
  accountPhase,
  decideOrgCreation,
  ORG_TRIAL_DAYS,
  ORG_TRIAL_MAX_GRANTS,
  orgCreationRefusalMessage,
  orgTrialEnd,
  orgTrialInForce,
  orgTrialStatuses,
  phaseOfKind,
  trialReuseVerdict,
  type OrgTrialRow,
} from "@/lib/org-trial";

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-12-10T10:00:00.000Z");
const days = (n: number) => new Date(NOW.getTime() + n * DAY);
const SETTINGS = { ...DEFAULT_TRIAL_SETTINGS, transitionEnabled: true };

const org = (id: string, createdDaysAgo: number, trialInDays: number | null, points = 1): OrgTrialRow => ({
  id,
  createdAt: days(-createdDaysAgo),
  trialEndsAt: trialInDays === null ? null : days(trialInDays),
  points,
});

test("accountPhase: paid beats trial, expired trial is free, transition off is open", () => {
  const base = { plan: "free", subscriptionEnd: null, createdAt: days(-3), trialEndsAt: null, exempt: false };
  assert.equal(accountPhase(base, SETTINGS, NOW), "trial");
  assert.equal(accountPhase({ ...base, plan: "standard", subscriptionEnd: days(20) }, SETTINGS, NOW), "paid");
  assert.equal(accountPhase({ ...base, createdAt: days(-40) }, SETTINGS, NOW), "free");
  assert.equal(accountPhase({ ...base, createdAt: days(-40), plan: "standard", subscriptionEnd: days(-1) }, SETTINGS, NOW), "free");
  assert.equal(accountPhase({ ...base, createdAt: days(-40), trialEndsAt: days(2) }, SETTINGS, NOW), "trial");
  assert.equal(accountPhase({ ...base, createdAt: days(-40) }, { ...SETTINGS, transitionEnabled: false }, NOW), "open");
  assert.equal(accountPhase({ ...base, exempt: true }, SETTINGS, NOW), "open");
});

test("orgTrialInForce: only before the date and only on a paid or trial account", () => {
  assert.equal(orgTrialInForce(days(3), "paid", NOW), true);
  assert.equal(orgTrialInForce(days(3), "trial", NOW), true);
  assert.equal(orgTrialInForce(days(3), "free", NOW), false, "free account gives no second organization for free");
  assert.equal(orgTrialInForce(days(3), "open", NOW), false);
  assert.equal(orgTrialInForce(days(-1), "paid", NOW), false);
  assert.equal(orgTrialInForce(NOW, "paid", NOW), false, "the end moment itself is already over");
  assert.equal(orgTrialInForce(null, "paid", NOW), false);
});

test("orgTrialEnd: Moscow midnight after the fourteenth day — the promised last day is free in full", () => {
  assert.equal(ORG_TRIAL_DAYS, 14);
  // 10 Dec 13:00 MSK + 14 days = 24 Dec 13:00 MSK → free through 24 Dec, ends at 25 Dec 00:00 MSK.
  assert.equal(orgTrialEnd(NOW).toISOString(), "2026-12-24T21:00:00.000Z");
  // Created right at Moscow midnight: exactly 14 full days, nothing is added on top.
  assert.equal(orgTrialEnd(new Date("2026-12-09T21:00:00.000Z")).toISOString(), "2026-12-23T21:00:00.000Z");
  // One millisecond later the last promised day moves to the next date.
  assert.equal(orgTrialEnd(new Date("2026-12-09T21:00:00.001Z")).toISOString(), "2026-12-24T21:00:00.000Z");
});

test("orgTrialStatuses: unmarked organizations are never touched", () => {
  const statuses = orgTrialStatuses({
    phase: "paid",
    pointLimit: 1,
    orgs: [org("a", 300, null), org("b", 200, null), org("c", 100, null, 3)],
    now: NOW,
  });
  assert.equal(statuses.size, 0);
});

test("orgTrialStatuses: running trial is 'trial', expired without a point is 'locked'", () => {
  const statuses = orgTrialStatuses({
    phase: "paid",
    pointLimit: 1,
    orgs: [org("first", 300, null), org("second", 20, -6), org("third", 5, 9)],
    now: NOW,
  });
  assert.deepEqual([...statuses.entries()].sort(), [
    ["second", "locked"],
    ["third", "trial"],
  ]);
});

test("orgTrialStatuses: paid points go to older marked organizations first", () => {
  const orgs = [org("first", 300, null), org("old", 60, -46), org("new", 30, -16)];
  assert.deepEqual([...orgTrialStatuses({ phase: "paid", pointLimit: 2, orgs, now: NOW }).entries()], [["new", "locked"]]);
  assert.equal(orgTrialStatuses({ phase: "paid", pointLimit: 3, orgs, now: NOW }).size, 0, "a paid point opens it again");
});

test("orgTrialStatuses: an organization with several buildings needs all its points", () => {
  const orgs = [org("first", 300, null), org("big", 60, -46, 2), org("small", 30, -16)];
  const statuses = orgTrialStatuses({ phase: "paid", pointLimit: 2, orgs, now: NOW });
  assert.equal(statuses.get("big"), "locked");
  assert.equal(statuses.get("small"), undefined, "the smaller one still fits the remaining point");
});

test("orgTrialStatuses: unmarked organizations over the limit leave no points for marked ones", () => {
  const orgs = [org("a", 300, null), org("b", 200, null), org("marked", 30, -16)];
  assert.equal(orgTrialStatuses({ phase: "paid", pointLimit: 1, orgs, now: NOW }).get("marked"), "locked");
});

test("orgTrialStatuses: nothing is locked outside a paid account with a point limit", () => {
  const orgs = [org("first", 300, null), org("second", 20, -6), org("third", 5, 9)];
  // Account's own trial: a running organization trial is still set apart (so one point can be bought), nothing locks.
  assert.deepEqual([...orgTrialStatuses({ phase: "trial", pointLimit: null, orgs, now: NOW }).entries()], [["third", "trial"]]);
  assert.equal(orgTrialStatuses({ phase: "free", pointLimit: 1, orgs, now: NOW }).size, 0);
  assert.equal(orgTrialStatuses({ phase: "open", pointLimit: 1, orgs, now: NOW }).size, 0);
  // Paid plan without a point limit (the old subscription): expired organizations keep working.
  assert.deepEqual([...orgTrialStatuses({ phase: "paid", pointLimit: null, orgs, now: NOW }).entries()], [["third", "trial"]]);
});

const decide = (patch: Partial<Parameters<typeof decideOrgCreation>[0]>) =>
  decideOrgCreation({
    phase: "paid",
    pointLimit: 1,
    pointsInUse: 1,
    grantsUsed: 0,
    hasLockedOrg: false,
    accountTrialEndsAt: null,
    now: NOW,
    ...patch,
  });

test("decideOrgCreation: free account gets no second organization", () => {
  assert.deepEqual(decide({ phase: "free" }), { ok: false, reason: "free_plan", limit: 1, current: 1 });
});

test("decideOrgCreation: paid account over its points gets 14 days while grants remain", () => {
  const granted = decide({});
  assert.equal(granted.ok && granted.mode, "org_trial");
  assert.equal(granted.ok && granted.mode === "org_trial" && granted.trialEndsAt.getTime(), orgTrialEnd(NOW).getTime());
  assert.equal(decide({ grantsUsed: 1 }).ok, true);
  assert.deepEqual(decide({ grantsUsed: ORG_TRIAL_MAX_GRANTS }), { ok: false, reason: "trials_used", limit: 1, current: 1 });
});

test("decideOrgCreation: a spare paid point is used before any grant", () => {
  assert.deepEqual(decide({ pointLimit: 3, pointsInUse: 1, grantsUsed: 0 }), { ok: true, mode: "paid_point", used: 2, limit: 3 });
  assert.deepEqual(
    decide({ pointLimit: 3, pointsInUse: 2, grantsUsed: ORG_TRIAL_MAX_GRANTS }),
    { ok: true, mode: "paid_point", used: 3, limit: 3 },
    "with a spare point exhausted grants do not matter",
  );
});

test("decideOrgCreation: a locked organization blocks new grants", () => {
  assert.deepEqual(decide({ hasLockedOrg: true }), { ok: false, reason: "locked_org", limit: 1, current: 1 });
});

test("decideOrgCreation: account in its own trial — own 14 days while grants remain, then only the account trial", () => {
  const accountEnd = days(4);
  const own = decide({ phase: "trial", pointLimit: null, accountTrialEndsAt: accountEnd });
  assert.deepEqual(own, { ok: true, mode: "account_trial", grant: true, trialEndsAt: orgTrialEnd(NOW) });
  // ROOT extended the account trial beyond 14 days: the organization's own period is not shorter than it.
  const extended = decide({ phase: "trial", pointLimit: null, accountTrialEndsAt: days(40) });
  assert.deepEqual(extended, { ok: true, mode: "account_trial", grant: true, trialEndsAt: days(40) });
  const shared = decide({ phase: "trial", pointLimit: null, accountTrialEndsAt: accountEnd, grantsUsed: ORG_TRIAL_MAX_GRANTS });
  assert.deepEqual(shared, { ok: true, mode: "account_trial", grant: false, trialEndsAt: accountEnd });
});

test("decideOrgCreation: no tariff rules — as before", () => {
  assert.deepEqual(decide({ phase: "open" }), { ok: true, mode: "open" });
  assert.deepEqual(decide({ pointLimit: null }), { ok: true, mode: "open" });
});

test("refusal messages name the reason", () => {
  assert.match(orgCreationRefusalMessage("free_plan", 1), /бесплатном тарифе/);
  assert.match(orgCreationRefusalMessage("trials_used", 2), /Оплачено точек: 2/);
  assert.match(orgCreationRefusalMessage("locked_org", 1), /закончились бесплатные 14 дней/);
});

test("trialReuseVerdict: INN and phone together end the trial, one sign only flags, paid twins never count", () => {
  assert.equal(trialReuseVerdict([]), "none");
  assert.equal(trialReuseVerdict([{ phase: "paid", innMatch: true, phoneMatch: true }]), "none");
  assert.equal(trialReuseVerdict([{ phase: "trial", innMatch: true, phoneMatch: true }]), "none");
  assert.equal(trialReuseVerdict([{ phase: "free", innMatch: true, phoneMatch: false }]), "flag", "an INN anyone could have typed");
  assert.equal(trialReuseVerdict([{ phase: "free", innMatch: false, phoneMatch: true }]), "flag");
  assert.equal(trialReuseVerdict([{ phase: "free", innMatch: false, phoneMatch: false }]), "none");
  assert.equal(trialReuseVerdict([{ phase: "free", innMatch: true, phoneMatch: true }]), "end");
  // Signs split across two different lapsed accounts are not the same person.
  assert.equal(
    trialReuseVerdict([
      { phase: "free", innMatch: true, phoneMatch: false },
      { phase: "free", innMatch: false, phoneMatch: true },
    ]),
    "flag",
  );
});

test("accountPhase agrees with the tariff state of the account", () => {
  const cases = [
    { plan: "free", subscriptionEnd: null, createdAt: days(-3), trialEndsAt: null },
    { plan: "standard", subscriptionEnd: days(20), createdAt: days(-90), trialEndsAt: null },
    { plan: "premium", subscriptionEnd: days(-2), createdAt: days(-90), trialEndsAt: null },
    { plan: "free", subscriptionEnd: null, createdAt: days(-90), trialEndsAt: null },
    { plan: "free", subscriptionEnd: null, createdAt: days(-90), trialEndsAt: days(5) },
    { plan: "paid", subscriptionEnd: days(10), createdAt: days(-400), trialEndsAt: null },
  ];
  for (const settings of [SETTINGS, { ...SETTINGS, transitionEnabled: false }]) {
    for (const input of cases) {
      for (const activeUsers of [1, 7]) {
        const state = computeAccountBilling({ ...input, activeUsers, enabledJournals: 3, pointsInUse: 1 }, settings, NOW);
        assert.equal(
          accountPhase({ ...input, exempt: false }, settings, NOW),
          phaseOfKind(state.kind),
          `${JSON.stringify(input)} users=${activeUsers} transition=${settings.transitionEnabled} kind=${state.kind}`,
        );
      }
    }
  }
  assert.equal(phaseOfKind("exempt"), "open");
});
