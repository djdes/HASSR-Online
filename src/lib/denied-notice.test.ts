import test from "node:test";
import assert from "node:assert/strict";

import {
  DENIED_PARAM,
  deniedRedirectLocation,
  keepDeniedParam,
  parseDeniedPath,
  stripDeniedParam,
  withDeniedParam,
} from "./denied-notice";

test("parseDeniedPath: только внутренний путь кабинета", () => {
  assert.equal(parseDeniedPath("/settings/users"), "/settings/users");
  assert.equal(parseDeniedPath("/settings/users/"), "/settings/users");
  assert.equal(parseDeniedPath("/production-control?x=1#top"), "/production-control");
  assert.equal(parseDeniedPath("/"), "/");
  for (const bad of [
    null,
    undefined,
    "",
    "settings",
    "//evil.example/path",
    "https://evil.example",
    "/\\evil.example",
    "/a b",
    "/a\nb",
    `/${"x".repeat(300)}`,
  ]) {
    assert.equal(parseDeniedPath(bad), null, String(bad));
  }
});

test("withDeniedParam: метка в адресе приземления", () => {
  assert.equal(withDeniedParam("/journals", "/settings/users"), "/journals?denied=%2Fsettings%2Fusers");
  assert.equal(withDeniedParam("/dashboard?tab=a", "/monitoring"), "/dashboard?tab=a&denied=%2Fmonitoring");
  assert.equal(
    withDeniedParam("/journals?denied=%2Fold#x", "/plans"),
    "/journals?denied=%2Fplans#x",
    "прежняя метка заменяется, якорь сохраняется",
  );
  assert.equal(withDeniedParam("/journals", "//evil.example"), "/journals", "плохой путь — без метки");
  const url = new URL(withDeniedParam("/mini", "/settings/users"), "https://wesetup.ru");
  assert.equal(url.pathname, "/mini");
  assert.equal(url.searchParams.get(DENIED_PARAM), "/settings/users");
});

test("deniedRedirectLocation: объясняем уход из раздела, но не с домашней", () => {
  assert.equal(deniedRedirectLocation("/journals", "/settings/users"), "/journals?denied=%2Fsettings%2Fusers");
  assert.equal(deniedRedirectLocation("/dashboard", "/settings/subscription"), "/dashboard?denied=%2Fsettings%2Fsubscription");
  // «На главную» сотрудника ведёт на /dashboard → proxy уводит в «Журналы»: это маршрут.
  assert.equal(deniedRedirectLocation("/journals", "/dashboard"), "/journals");
  assert.equal(deniedRedirectLocation("/journals", "/home"), "/journals");
  assert.equal(deniedRedirectLocation("/mini", "/"), "/mini");
  assert.equal(deniedRedirectLocation("/journals", "//evil.example"), "/journals");
});

test("keepDeniedParam: второй редирект домашней не теряет метку", () => {
  assert.equal(keepDeniedParam("/mini/today", "/settings/users"), "/mini/today?denied=%2Fsettings%2Fusers");
  assert.equal(keepDeniedParam("/control-board", ["/monitoring", "/x"]), "/control-board?denied=%2Fmonitoring");
  assert.equal(keepDeniedParam("/mini/today", undefined), "/mini/today");
  assert.equal(keepDeniedParam("/mini/today", "//evil.example"), "/mini/today");
});

test("stripDeniedParam: метка уходит, остальной запрос остаётся", () => {
  assert.equal(stripDeniedParam("?denied=%2Fsettings"), "");
  assert.equal(stripDeniedParam("?place=all&denied=%2Fsettings"), "?place=all");
  assert.equal(stripDeniedParam("place=all"), "place=all", "без метки — как было");
  assert.equal(stripDeniedParam(""), "");
});
