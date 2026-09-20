import assert from "node:assert/strict";
import test from "node:test";

import { activeMiniNavHref, miniNavItems } from "@/app/mini/_lib/nav-items";

test("у руководителя четыре вкладки, главная — дашборд", () => {
  const items = miniNavItems({ role: "manager", isRoot: false });
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

test("у линейного сотрудника главная — журналы, второй такой кнопки нет", () => {
  const items = miniNavItems({ role: "cook", isRoot: false });
  assert.deepEqual(
    items.map((item) => [item.href, item.label]),
    [
      ["/journals", "Журналы"],
      ["/mini/sections", "Разделы"],
      ["/mini/me", "Профиль"],
    ]
  );
});

test("до входа показываем набор линейного сотрудника", () => {
  assert.deepEqual(
    miniNavItems(null).map((item) => item.href),
    ["/journals", "/mini/sections", "/mini/me"]
  );
});

test("вкладка подсвечивается и на страницах сайта", () => {
  const items = miniNavItems({ role: "manager", isRoot: false });

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

test("экран входа и «Сегодня» подсвечивают домашнюю вкладку", () => {
  const manager = miniNavItems({ role: "manager", isRoot: false });
  const staff = miniNavItems({ role: "cook", isRoot: false });

  assert.equal(activeMiniNavHref(manager, "/mini"), "/dashboard");
  assert.equal(activeMiniNavHref(staff, "/mini"), "/journals");
  // Сайт сам отправляет повара с `/journals` на «Сегодня» — значит это
  // и есть его домашний экран, и вкладка должна быть подсвечена.
  assert.equal(activeMiniNavHref(staff, "/mini/today"), "/journals");
});

test("соседние разделы чужую вкладку не подсвечивают", () => {
  const items = miniNavItems({ role: "manager", isRoot: false });

  // `/journals-progress` — отдельный раздел, а не вложенность журналов.
  assert.equal(activeMiniNavHref(items, "/journals-progress"), null);
  assert.equal(activeMiniNavHref(items, "/mini/outbox"), null);
  assert.equal(activeMiniNavHref(items, "/settings/users"), null);
});
