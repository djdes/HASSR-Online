import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import {
  moscowDay,
  PAGE_LIMIT_SECTIONS,
  platformOf,
  recordPageLimit,
  restorePageLimitStats,
  sectionOf,
  takePageLimitStats,
  type PageLimitEvent,
} from "./page-limit-stats";

const event: PageLimitEvent = { limited: true, reason: "burst", subject: "ip", client: "browser", platform: "ios-old", background: false, metadata: false, section: "journals" };

test("sections are known routes only; IDs and unknown paths are «other»", () => {
  assert.equal(sectionOf("/"), "home");
  assert.equal(sectionOf("/journals/cleaning/documents/abc123"), "journals");
  assert.equal(sectionOf("/en/pricing"), "en");
  for (const pathname of ["/clx9abcdef0001", "/wp-admin", "/journals2", "/JOURNALS"]) assert.equal(sectionOf(pathname), "other", pathname);
  const app = path.join(process.cwd(), "src/app");
  const routes = new Set<string>();
  for (const entry of fs.readdirSync(app, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith("(")) {
      for (const child of fs.readdirSync(path.join(app, entry.name), { withFileTypes: true })) if (child.isDirectory()) routes.add(child.name);
    } else {
      routes.add(entry.name);
    }
  }
  for (const section of PAGE_LIMIT_SECTIONS) assert.ok(routes.has(section), `${section} is not a route in src/app`);
});

test("platform: old iOS (before 16.4) apart, the rest coarse", () => {
  assert.equal(platformOf("Mozilla/5.0 (iPhone; CPU iPhone OS 15_7 like Mac OS X) AppleWebKit/605.1.15"), "ios-old");
  assert.equal(platformOf("Mozilla/5.0 (iPhone; CPU iPhone OS 16_3_1 like Mac OS X)"), "ios-old");
  assert.equal(platformOf("Mozilla/5.0 (iPhone; CPU iPhone OS 16_4 like Mac OS X)"), "ios");
  assert.equal(platformOf("Mozilla/5.0 (iPad; CPU OS 17_1 like Mac OS X)"), "ios");
  assert.equal(platformOf("Mozilla/5.0 (Linux; Android 13; SM-A515F) Chrome/120 Mobile"), "android");
  assert.equal(platformOf("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130"), "desktop");
  assert.equal(platformOf("curl/8"), "other");
  assert.equal(platformOf(null), "other");
  const started = performance.now();
  platformOf(`iPhone ${"iPhone ".repeat(2_000)}`);
  assert.ok(performance.now() - started < 50, "linear on a long header");
});

test("days are Moscow calendar days", () => {
  assert.equal(moscowDay(Date.parse("2026-10-25T20:59:59Z")), "2026-10-25");
  assert.equal(moscowDay(Date.parse("2026-10-25T21:00:00Z")), "2026-10-26");
});

test("counts aggregate by dimensions; passed pages lose reason and section", () => {
  takePageLimitStats();
  const at = Date.parse("2026-10-26T10:00:00Z");
  recordPageLimit(event, at);
  recordPageLimit(event, at);
  recordPageLimit({ ...event, limited: false, reason: null, section: "settings" }, at);
  recordPageLimit({ ...event, limited: false, reason: null, section: "journals" }, at);
  const buckets = takePageLimitStats();
  assert.deepEqual(buckets, [
    { day: "2026-10-26", outcome: "limited", reason: "burst", subject: "ip", client: "browser", platform: "ios-old", request: "document", metadata: false, section: "journals", count: 2 },
    { day: "2026-10-26", outcome: "passed", reason: "-", subject: "ip", client: "browser", platform: "ios-old", request: "document", metadata: false, section: "*", count: 2 },
  ]);
  assert.deepEqual(takePageLimitStats(), [], "taking empties the store");
  restorePageLimitStats(buckets);
  recordPageLimit(event, at);
  assert.equal(takePageLimitStats().find((bucket) => bucket.outcome === "limited")?.count, 3, "a failed write is put back and keeps counting");
});

test("the store is bounded: new buckets beyond the cap are dropped, known ones still count", () => {
  takePageLimitStats();
  const at = Date.parse("2026-10-26T10:00:00Z");
  for (let i = 0; i < 2_100; i++) recordPageLimit({ ...event, section: `s${i}` }, at);
  recordPageLimit({ ...event, section: "s0" }, at);
  const buckets = takePageLimitStats();
  assert.equal(buckets.length, 2_000);
  assert.equal(buckets.find((bucket) => bucket.section === "s0")?.count, 2);
});
