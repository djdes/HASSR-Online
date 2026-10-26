import assert from "node:assert/strict";
import { test } from "node:test";
import { createPageNavigationLimiter, hasAutomationUserAgent, PAGE_NAVIGATION_LIMITS, pageLimitMode } from "./page-navigation-limit";

const { browser, automated, background, cooldownSeconds } = PAGE_NAVIGATION_LIMITS;
const COOLDOWN = cooldownSeconds * 1000;
const MINUTE = 60_000;

test("budgets are loose: a person never meets them, each minute budget binds", () => {
  assert.deepEqual(PAGE_NAVIGATION_LIMITS, {
    browser: { burst: 100, minute: 400 },
    automated: { burst: 20, minute: 90 },
    background: 1200,
    cooldownSeconds: 15,
    userScale: 3,
    visitorIpScale: 3,
  });
  for (const budget of [browser, automated]) assert.ok(budget.minute < budget.burst * 6);
});

test("normal browsing and a burst across pages share a rolling budget", () => {
  let now = 0;
  const limit = createPageNavigationLimiter(() => now);
  for (let i = 0; i < browser.burst; i++) assert.equal(limit.check("a", false, false), 0);
  assert.equal(limit.check("a", false, false), cooldownSeconds);
  assert.equal(limit.check("b", false, false), 0);
  now = 5_000;
  assert.equal(limit.check("a", false, false), cooldownSeconds - 5);
  now = COOLDOWN - 1;
  assert.equal(limit.check("a", false, false), 1);
  now = COOLDOWN;
  assert.equal(limit.check("a", false, false), 0, "blocked retries never extend the deadline");
});

test("the 10-second window expires at its boundary", () => {
  let now = 0;
  const limit = createPageNavigationLimiter(() => now);
  for (let i = 0; i < browser.burst; i++) assert.equal(limit.check("a", false, false), 0);
  now = 10_000;
  assert.equal(limit.check("a", false, false), 0);
});

test("sustained browsing and automation hit the minute budget without a burst", () => {
  for (const [isAutomated, budget] of [[false, browser], [true, automated]] as const) {
    let now = 0;
    const limit = createPageNavigationLimiter(() => now);
    const step = Math.floor(MINUTE / (budget.minute + 10));
    assert.ok(10_000 / step < budget.burst, "the pace stays under the 10-second budget");
    for (let i = 0; i < budget.minute; i++) {
      now = i * step;
      assert.equal(limit.check("a", isAutomated, false), 0);
    }
    now = budget.minute * step;
    assert.equal(limit.check("a", isAutomated, false), cooldownSeconds);
  }
});

test("UA changes do not erase recorded requests", () => {
  const limit = createPageNavigationLimiter(() => 0);
  for (let i = 0; i < automated.burst; i++) assert.equal(limit.check("a", true, false), 0);
  for (let i = automated.burst; i < browser.burst; i++) assert.equal(limit.check("a", false, false), 0);
  assert.equal(limit.check("a", false, false), cooldownSeconds);
  assert.equal(limit.check("a", true, false), cooldownSeconds);
});

test("automation is only a signal, not a ban or allowlist", () => {
  for (const ua of [null, "", "curl/8", "Python-Requests/2", "HeadlessChrome/130", "HTTrack"]) assert.equal(hasAutomationUserAgent(ua), true);
  for (const ua of ["Mozilla/5.0 Chrome/130", "Googlebot", "WeSetupApp/1"]) assert.equal(hasAutomationUserAgent(ua), false);
  const limit = createPageNavigationLimiter(() => 0);
  for (let i = 0; i < automated.burst; i++) assert.equal(limit.check("a", true, false), 0);
  assert.equal(limit.check("a", true, false), cooldownSeconds);
});

test("excess background requests never block documents or extend their own window", () => {
  let now = 0;
  const limit = createPageNavigationLimiter(() => now);
  for (let i = 0; i < background; i++) assert.equal(limit.check("a", true, true), 0);
  // Over budget: only the prefetch waits until its oldest slot leaves the minute window.
  assert.equal(limit.check("a", true, true), 60);
  assert.equal(limit.check("a", true, false), 0);
  assert.equal(limit.check("a", true, true), 60);
  assert.equal(limit.check("a", false, false), 0);
  now = 15_000;
  assert.equal(limit.check("a", false, true), 45);
  assert.equal(limit.check("a", false, false), 0);
  now = 59_999;
  assert.equal(limit.check("a", false, true), 1);
  now = 60_000;
  assert.equal(limit.check("a", false, true), 0);
});

test("slow browsing with many speculative requests does not trigger a document cooldown", () => {
  let now = 0;
  const limit = createPageNavigationLimiter(() => now);
  const links = Math.ceil(background / 10);
  let rejectedBackground = 0;
  for (let page = 0; page < 12; page++) {
    now = page * 5_000;
    for (let link = 0; link < links; link++) {
      if (limit.check("browser", false, true)) rejectedBackground++;
    }
    assert.equal(limit.check("browser", false, false), 0);
  }
  assert.equal(rejectedBackground, 12 * links - background);
});

test("background retries cannot extend or clear an actual document cooldown", () => {
  let now = 0;
  const limit = createPageNavigationLimiter(() => now);
  for (let i = 0; i < background; i++) assert.equal(limit.check("a", false, true), 0);
  for (let i = 0; i < browser.burst; i++) assert.equal(limit.check("a", false, false), 0);
  assert.equal(limit.check("a", false, false), cooldownSeconds);
  now = 5_000;
  assert.equal(limit.check("a", false, true), cooldownSeconds - 5);
  now = COOLDOWN;
  assert.equal(limit.check("a", false, false), 0);
  assert.equal(limit.check("a", false, true), (MINUTE - COOLDOWN) / 1000, "the background minute budget survives a document cooldown");
  assert.equal(limit.check("a", false, false), 0);
});

test("expired budgets are swept and capacity cannot evict a blocked subject", () => {
  let now = 0;
  const limit = createPageNavigationLimiter(() => now, 2);
  for (let i = 0; i <= automated.burst; i++) limit.check("a", true, false);
  limit.check("b", false, false);
  assert.ok(limit.check("c", false, false) > 0);
  assert.equal(limit.size, 2);
  assert.equal(limit.check("a", true, false), cooldownSeconds);
  now = 60_000;
  assert.equal(limit.check("c", false, false), 0);
  assert.equal(limit.size, 1);
});

test("a page cooldown also holds back prefetch", () => {
  const limit = createPageNavigationLimiter(() => 0);
  for (let i = 0; i < automated.burst; i++) assert.equal(limit.check("a", true, false), 0);
  assert.equal(limit.check("a", true, false), cooldownSeconds);
  assert.equal(limit.check("a", true, true), cooldownSeconds);
});

test("every refusal names its reason for the statistics", () => {
  let now = 0;
  const limit = createPageNavigationLimiter(() => now, 3);
  for (let i = 0; i < browser.burst; i++) assert.deepEqual(limit.decide("burst", false, false), { wait: 0, reason: null });
  assert.deepEqual(limit.decide("burst", false, false), { wait: cooldownSeconds, reason: "burst" });
  assert.deepEqual(limit.decide("burst", false, true), { wait: cooldownSeconds, reason: "cooldown" });
  for (let i = 0; i < background; i++) limit.decide("background", false, true);
  assert.deepEqual(limit.decide("background", false, true), { wait: 60, reason: "background" });
  const step = Math.floor(MINUTE / (automated.minute + 10));
  for (let i = 0; i < automated.minute; i++) {
    now = i * step;
    limit.decide("minute", true, false);
  }
  now = automated.minute * step;
  assert.deepEqual(limit.decide("minute", true, false), { wait: cooldownSeconds, reason: "minute" });
  assert.equal(limit.decide("fourth", false, false).reason, "capacity");
});

test("scale multiplies every budget of one check, and is per check", () => {
  const limit = createPageNavigationLimiter(() => 0);
  for (let i = 0; i < automated.burst * 3; i++) assert.equal(limit.check("user", true, false, 3), 0);
  assert.equal(limit.check("user", true, false, 3), cooldownSeconds);
  for (let i = 0; i < background * 3; i++) assert.equal(limit.check("prefetch", false, true, 3), 0);
  assert.equal(limit.check("prefetch", false, true, 3), 60);
  for (let i = 0; i < automated.burst / 4; i++) assert.equal(limit.check("tight", true, false, 0.25), 0);
  assert.equal(limit.check("tight", true, false, 0.25), cooldownSeconds);
});

test("admits: a known subject always, a new one only while there is room", () => {
  const limit = createPageNavigationLimiter(() => 0, 1);
  assert.equal(limit.admits("a"), true);
  limit.check("a", false, false);
  assert.equal(limit.admits("a"), true);
  assert.equal(limit.admits("b"), false);
});

test("the emergency switch reads only valid values", () => {
  assert.deepEqual(pageLimitMode({}), { off: false, scale: 1 });
  assert.deepEqual(pageLimitMode({ PAGE_NAVIGATION_LIMIT: " OFF ", PAGE_NAVIGATION_LIMIT_SCALE: "2.5" }), { off: true, scale: 2.5 });
  for (const value of ["", "0", "0.1", "101", "abc", "Infinity", "-3"]) {
    assert.equal(pageLimitMode({ PAGE_NAVIGATION_LIMIT_SCALE: value }).scale, 1, value);
  }
  assert.equal(pageLimitMode({ PAGE_NAVIGATION_LIMIT: "on" }).off, false);
});
