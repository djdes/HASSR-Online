import test from "node:test";
import assert from "node:assert/strict";

import {
  APP_SECTIONS,
  appSectionLabel,
  headerNavSections,
  visibleAppSectionGroups,
  visibleAppSections,
  type AppSectionActor,
} from "./app-sections";

const owner: AppSectionActor = { role: "manager", permissionPreset: "admin" };
const manager: AppSectionActor = { role: "owner", permissionPreset: "admin" };
const headChef: AppSectionActor = {
  // Заведующая: роль управленческая (сайт её пускает), но возможностей
  // администратора у неё нет — настройки и отчёты закрыты.
  role: "manager",
  permissionPreset: "head_chef",
};
const cook: AppSectionActor = { role: "cook", permissionPreset: "cook" };

function hrefs(actor: AppSectionActor): string[] {
  return visibleAppSections(actor).map((section) => section.href);
}

test("у каждого раздела есть название и подпись", () => {
  for (const section of APP_SECTIONS) {
    assert.ok(appSectionLabel(section).length > 0, section.href);
    assert.ok(section.hint.length > 0, section.href);
    assert.ok(section.icon.length > 0, section.href);
    assert.match(section.href, /^\//);
  }
});

test("адреса разделов не повторяются", () => {
  const seen = new Set(APP_SECTIONS.map((s) => s.href));
  assert.equal(seen.size, APP_SECTIONS.length);
});

test("владелец видит всё", () => {
  assert.equal(visibleAppSections(owner).length, APP_SECTIONS.length);
  assert.equal(visibleAppSections(manager).length, APP_SECTIONS.length);
});

test("ROOT видит всё, даже без роли", () => {
  assert.equal(
    visibleAppSections({ isRoot: true }).length,
    APP_SECTIONS.length
  );
});

test("линейному сотруднику открыты только журналы и баланс", () => {
  assert.deepEqual(hrefs(cook), ["/journals", "/settings/balance"]);
});

test("заведующая проверяет задачи, но не правит настройки", () => {
  const list = hrefs(headChef);
  assert.ok(list.includes("/verifications"));
  assert.ok(list.includes("/control-board"));
  // Сотрудники ей видны (staff.view), а хаб настроек и отчёты — нет.
  assert.ok(list.includes("/settings/users"));
  assert.ok(!list.includes("/settings"));
  assert.ok(!list.includes("/reports"));
});

test("повар не видит ни проверок, ни настроек", () => {
  const list = hrefs(cook);
  assert.ok(!list.includes("/verifications"));
  assert.ok(!list.includes("/settings"));
  assert.ok(!list.includes("/reports"));
});

test("группы отдаются без пустых", () => {
  const groups = visibleAppSectionGroups(cook);
  for (const group of groups) {
    assert.ok(group.sections.length > 0, group.id);
  }
  assert.deepEqual(
    groups.map((g) => g.id),
    ["work", "money"]
  );
  assert.deepEqual(
    visibleAppSectionGroups(owner).map((g) => g.id),
    ["work", "production", "money", "settings"]
  );
});

test("org-override пресета режет разделы так же, как на сайте", () => {
  const limited: AppSectionActor = {
    role: "manager",
    permissionPreset: "head_chef",
    orgPresetOverrides: { head_chef: ["staff.view"] },
  };
  const list = hrefs(limited);
  assert.ok(!list.includes("/verifications"));
  assert.ok(list.includes("/settings/users"));
});

test("всё, что было отдельными вкладками в приложении, есть в разделах", () => {
  // Мини-приложение больше не заводит своих экранов: «Сотрудники»,
  // «Оборудование», «Отчёты», «Журнал действий», «Команда» и «График
  // смен» должны находиться через «Все разделы» (П-3).
  const list = hrefs(owner);
  for (const href of [
    "/settings/users",
    "/settings/equipment",
    "/reports",
    "/settings/audit",
    "/team",
    "/settings/schedule",
  ]) {
    assert.ok(list.includes(href), href);
  }
});

test("меню шапки собирается из того же списка", () => {
  const items = headerNavSections();
  assert.equal(items.length, 10);
  assert.equal(items[0].href, "/journals");
  assert.equal(items[2].label, "Производственный план");
  assert.equal(items[9].label, "Идеи");
  for (const item of items) {
    assert.ok(APP_SECTIONS.some((s) => s.href === item.href));
  }
});
