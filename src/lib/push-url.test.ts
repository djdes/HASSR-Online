import test from "node:test";
import assert from "node:assert/strict";

import { hostsFromUrls, normalizePushUrl } from "./push-url";

test("normalizePushUrl: ссылки из системы и уведомлений (14 случаев)", () => {
  const hosts = ["localhost:3021"];
  const cases: Array<[string | null | undefined, string]> = [
    [null, "/mini"],
    ["", "/mini"],
    ["/journals/hygiene?x=1#a", "/journals/hygiene?x=1#a"],
    ["https://wesetup.ru/mini/today", "/mini/today"],
    ["https://www.wesetup.ru/task-fill/1", "/task-fill/1"],
    ["http://localhost:3021/mini/me", "/mini/me"],
    ["https://evil.example/mini", "/mini"],
    ["//evil.example/x", "/mini"],
    ["/\\evil.example", "/mini"],
    ["javascript:alert(1)", "/mini"],
    ["/api/reports/pdf", "/mini"],
    ["/api", "/mini"],
    ["mini/today", "/mini"],
    ["https://wesetup.ru:bad", "/mini"],
  ];
  assert.equal(cases.length, 14);
  for (const [href, expected] of cases) {
    assert.equal(normalizePushUrl(href, hosts), expected, String(href));
  }
});

test("normalizePushUrl: без своих адресов стенд чужой", () => {
  assert.equal(normalizePushUrl("http://localhost:3021/mini/me"), "/mini");
  assert.equal(normalizePushUrl("https://WESETUP.RU/mini/me"), "/mini/me");
  assert.equal(normalizePushUrl("http://localhost:3021/x", ["LOCALHOST:3021"]), "/x");
  assert.equal(normalizePushUrl("https://wesetup.ru.evil.example/x"), "/mini");
  assert.equal(normalizePushUrl("/a\u0001b"), "/mini");
  assert.equal(normalizePushUrl("  /mini/me  "), "/mini/me");
});

test("hostsFromUrls: хосты из адресов, битые и пустые пропускаем", () => {
  assert.deepEqual(
    hostsFromUrls(["http://LOCALHOST:3021/", undefined, "", "не адрес", "https://wesetup.ru/mini"]),
    ["localhost:3021", "wesetup.ru"]
  );
  assert.deepEqual(hostsFromUrls([]), []);
});
