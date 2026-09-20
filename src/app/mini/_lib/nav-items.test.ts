import assert from "node:assert/strict";
import test from "node:test";

import {
  activeMiniNavHref,
  miniHomeHref,
  miniNavItems,
} from "@/app/mini/_lib/nav-items";

const manager = { role: "manager", permissionPreset: "admin", isRoot: false };
const headChef = {
  role: "head_chef",
  permissionPreset: "head_chef",
  isRoot: false,
};
const cook = { role: "cook", permissionPreset: "cook", isRoot: false };

test("у руководителя четыре вкладки, главная — дашборд", () => {
  const items = miniNavItems(manager);
  assert.deepEqual(
    items.map((item) => [item.href, item.label]),
    [
      ["/dashboard", "Главная"],
      ["/journals", "Журналы"],
      ["/mini/sections", "Разделы"],
      ["/mini/me", "Профиль"],
    ]
  );
});

test("у заведующей главная — контрольная доска, вкладки «Журналы» нет", () => {
  // `/journals` её всё равно уводит на `/control-board` — кнопка,
  // ведущая на редирект, человеку только мешает.
  const items = miniNavItems(headChef);
  assert.deepEqual(
    items.map((item) => [item.href, item.label]),
    [
      ["/control-board", "Главная"],
      ["/mini/sections", "Разделы"],
      ["/mini/me", "Профиль"],
    ]
  );
  assert.equal(miniHomeHref(headChef), "/control-board");
});

test("у линейного сотрудника главная — «Сегодня», сразу без прыжка", () => {
  const items = miniNavItems(cook);
  assert.deepEqual(
    items.map((item) => [item.href, item.label, item.icon]),
    [
      ["/mini/today", "Сегодня", "CalendarCheck"],
      ["/mini/sections", "Разделы", "LayoutGrid"],
      ["/mini/me", "Профиль", "UserRound"],
    ]
  );
  assert.equal(miniHomeHref(cook), "/mini/today");
});

test("до входа показываем набор линейного сотрудника", () => {
  assert.deepEqual(
    miniNavItems(null).map((item) => item.href),
    ["/mini/today", "/mini/sections", "/mini/me"]
  );
});

test("вкладка подсвечивается и на страницах сайта", () => {
  const items = miniNavItems(manager);

  assert.equal(activeMiniNavHref(items, "/dashboard"), "/dashboard");
  assert.equal(activeMiniNavHref(items, "/journals"), "/journals");
  assert.equal(activeMiniNavHref(items, "/journals/hygiene"), "/journals");
  assert.equal(
    activeMiniNavHref(items, "/journals/hygiene/documents/42"),
    "/journals"
  );
  assert.equal(activeMiniNavHref(items, "/mini/me"), "/mini/me");
  assert.equal(activeMiniNavHref(items, "/mini/sections"), "/mini/sections");
});

test("экран входа подсвечивает домашнюю вкладку", () => {
  assert.equal(activeMiniNavHref(miniNavItems(manager), "/mini"), "/dashboard");
  assert.equal(activeMiniNavHref(miniNavItems(cook), "/mini"), "/mini/today");
  assert.equal(
    activeMiniNavHref(miniNavItems(headChef), "/mini"),
    "/control-board"
  );
});

test("«Сегодня» — домашний экран сотрудника", () => {
  const items = miniNavItems(cook);
  assert.equal(activeMiniNavHref(items, "/mini/today"), "/mini/today");
});

test("страницы из «Разделов» подсвечивают «Разделы»", () => {
  const items = miniNavItems(manager);

  for (const path of [
    "/settings",
    "/settings/users",
    "/settings/equipment/123",
    "/team",
    "/verifications",
    "/reports",
    "/batches",
    "/capa",
    "/journals-progress",
    "/control-board",
  ]) {
    assert.equal(activeMiniNavHref(items, path), "/mini/sections", path);
  }
});

test("у заведующей контрольная доска — это дом, а не раздел", () => {
  const items = miniNavItems(headChef);
  assert.equal(activeMiniNavHref(items, "/control-board"), "/control-board");
  assert.equal(activeMiniNavHref(items, "/verifications"), "/mini/sections");
});
