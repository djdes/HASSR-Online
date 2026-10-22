import assert from "node:assert/strict";
import { test } from "node:test";
import { createPageNavigationLimiter, hasAutomationUserAgent } from "./page-navigation-limit";

test("normal browsing and a burst across pages share a rolling budget", () => {
  let now = 0;
  const limit = createPageNavigationLimiter(() => now);
  for (let i = 0; i < 20; i++) assert.equal(limit.check("a", false, false), 0);
  assert.equal(limit.check("a", false, false), 30);
  assert.equal(limit.check("b", false, false), 0);
  now = 15_000;
  assert.equal(limit.check("a", false, false), 15);
  now = 29_999;
  assert.equal(limit.check("a", false, false), 1);
  now = 30_000;
  assert.equal(limit.check("a", false, false), 0, "blocked retries never extend the deadline");
});

test("the 10-second window expires at its boundary", () => {
  let now = 0;
  const limit = createPageNavigationLimiter(() => now);
  for (let i = 0; i < 20; i++) assert.equal(limit.check("a", false, false), 0);
  now = 10_000;
  assert.equal(limit.check("a", false, false), 0);
});

test("sustained automation hits the minute budget without a burst", () => {
  let now = 0;
  const limit = createPageNavigationLimiter(() => now);
  for (let i = 0; i < 30; i++) {
    now = i * 1900;
    assert.equal(limit.check("a", true, false), 0);
  }
  now = 57_000;
  assert.equal(limit.check("a", true, false), 30);
});

test("UA changes do not erase recorded requests", () => {
  const limit = createPageNavigationLimiter(() => 0);
  for (let i = 0; i < 6; i++) assert.equal(limit.check("a", true, false), 0);
  for (let i = 0; i < 14; i++) assert.equal(limit.check("a", false, false), 0);
  assert.equal(limit.check("a", false, false), 30);
  assert.equal(limit.check("a", true, false), 30);
});

test("automation is only a signal, not a ban or allowlist", () => {
  for (const ua of [null, "", "curl/8", "Python-Requests/2", "HeadlessChrome/130", "HTTrack"]) assert.equal(hasAutomationUserAgent(ua), true);
  for (const ua of ["Mozilla/5.0 Chrome/130", "Googlebot", "WeSetupApp/1"]) assert.equal(hasAutomationUserAgent(ua), false);
  const limit = createPageNavigationLimiter(() => 0);
  for (let i = 0; i < 6; i++) assert.equal(limit.check("a", true, false), 0);
  assert.equal(limit.check("a", true, false), 30);
});

test("excess background requests never block documents or extend their own window", () => {
  let now = 0;
  const limit = createPageNavigationLimiter(() => now);
  for (let i = 0; i < 240; i++) assert.equal(limit.check("a", true, true), 0);
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
  let rejectedBackground = 0;
  for (let page = 0; page < 12; page++) {
    now = page * 5_000;
    for (let link = 0; link < 30; link++) {
      if (limit.check("browser", false, true)) rejectedBackground++;
    }
    assert.equal(limit.check("browser", false, false), 0);
  }
  assert.equal(rejectedBackground, 120);
});

test("background retries cannot extend or clear an actual document cooldown", () => {
  let now = 0;
  const limit = createPageNavigationLimiter(() => now);
  for (let i = 0; i < 240; i++) assert.equal(limit.check("a", false, true), 0);
  for (let i = 0; i < 20; i++) assert.equal(limit.check("a", false, false), 0);
  assert.equal(limit.check("a", false, false), 30);
  now = 15_000;
  assert.equal(limit.check("a", false, true), 15);
  now = 30_000;
  assert.equal(limit.check("a", false, false), 0);
  assert.equal(limit.check("a", false, true), 30, "the background minute budget survives a document cooldown");
  assert.equal(limit.check("a", false, false), 0);
});

test("expired budgets are swept and capacity cannot evict a blocked subject", () => {
  let now = 0;
  const limit = createPageNavigationLimiter(() => now, 2);
  for (let i = 0; i < 7; i++) limit.check("a", true, false);
  limit.check("b", false, false);
  assert.ok(limit.check("c", false, false) > 0);
  assert.equal(limit.size, 2);
  assert.equal(limit.check("a", true, false), 30);
  now = 60_000;
  assert.equal(limit.check("c", false, false), 0);
  assert.equal(limit.size, 1);
});

test("a page cooldown also holds back prefetch", () => {
  const limit = createPageNavigationLimiter(() => 0);
  for (let i = 0; i < 6; i++) assert.equal(limit.check("a", true, false), 0);
  assert.equal(limit.check("a", true, false), 30);
  assert.equal(limit.check("a", true, true), 30);
});
