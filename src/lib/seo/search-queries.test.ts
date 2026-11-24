import assert from "node:assert/strict";
import { test } from "node:test";

import { defaultPeriod, mergeBehavior, normalizeUrl, readSearchQueriesConfig, type Behavior } from "./search-queries.server";

test("normalizeUrl склеивает варианты одного адреса", () => {
  assert.equal(normalizeUrl("https://www.wesetup.ru/"), "wesetup.ru/");
  assert.equal(normalizeUrl("http://wesetup.ru"), "wesetup.ru/");
  assert.equal(normalizeUrl("https://wesetup.ru/blanki/?utm_source=google#top"), "wesetup.ru/blanki");
  assert.equal(normalizeUrl("https://WeSetup.ru/blanki"), "wesetup.ru/blanki");
  assert.equal(normalizeUrl("https://wesetup.ru/%D0%B1%D0%BB%D0%BE%D0%B3/"), "wesetup.ru/блог");
  assert.equal(normalizeUrl("wesetup.ru/a//b/"), "wesetup.ru/a/b");
  assert.equal(normalizeUrl("https://wesetup.ru/%E0%A4%A"), "wesetup.ru/%E0%A4%A");
});

const b = (visits: number, bounceRate: number, duration: number, reaches: number): Behavior => ({
  visits,
  users: visits,
  bounceRate,
  pageDepth: 1,
  duration,
  reaches,
  conversion: reaches / visits,
  goals: { 1: { reaches, conversion: reaches / visits } },
});

test("mergeBehavior: визиты и цели складываются, доли — средневзвешенные по визитам", () => {
  const m = mergeBehavior(b(30, 0.1, 100, 3), b(10, 0.5, 20, 0));
  assert.equal(m.visits, 40);
  assert.equal(m.reaches, 3);
  assert.equal(m.goals[1].reaches, 3);
  assert.ok(Math.abs(m.bounceRate - 0.2) < 1e-9);
  assert.ok(Math.abs(m.duration - 80) < 1e-9);
  assert.ok(Math.abs(m.conversion - 3 / 40) < 1e-9);
});

test("defaultPeriod: 90 дней до вчера включительно", () => {
  assert.deepEqual(defaultPeriod(90, new Date("2026-11-24T10:00:00Z")), { from: "2026-08-26", to: "2026-11-23" });
});

test("readSearchQueriesConfig: счётчик по умолчанию из NEXT_PUBLIC_YANDEX_METRIKA_ID, цели через запятую", () => {
  const c = readSearchQueriesConfig({ NEXT_PUBLIC_YANDEX_METRIKA_ID: "108650751", METRIKA_GOAL_IDS: "1, 2,x", METRIKA_TOKEN: '"t"' } as unknown as NodeJS.ProcessEnv);
  assert.equal(c.counterId, "108650751");
  assert.deepEqual(c.goalIds, [1, 2]);
  assert.equal(c.metrikaToken, "t");
  assert.equal(c.gscSiteUrl, "https://wesetup.ru/");
  assert.equal(c.gscKeyPath, null);
});
