import test from "node:test";
import assert from "node:assert/strict";

import {
  APP_SECTIONS,
  appSectionLabel,
  canSeeAppSection,
  headerNavSections,
  MENU_HIDDEN_HREFS,
  visibleAppSectionGroups,
  visibleAppSections,
  type AppSectionActor,
} from "./app-sections";

const owner: AppSectionActor = { role: "owner", permissionPreset: "admin" };
const manager: AppSectionActor = { role: "manager", permissionPreset: "admin" };
const headChef: AppSectionActor = {
  // Заведующая: роль управленческая (`hasFullWorkspaceAccess` = true),
  // но возможностей администратора нет — `admin.full` ей не выдан.
  role: "head_chef",
  permissionPreset: "head_chef",
};
const cook: AppSectionActor = { role: "cook", permissionPreset: "cook" };
const cleaner: AppSectionActor = { role: "cook", permissionPreset: "cleaner" };

function hrefs(actor: AppSectionActor): string[] {
  return visibleAppSections(actor).map((section) => section.href);
}

test("у каждого раздела есть название, подпись и правило доступа", () => {
  for (const section of APP_SECTIONS) {
    assert.ok(appSectionLabel(section).length > 0, section.href);
    assert.ok(section.hint.length > 0, section.href);
    assert.ok(section.icon.length > 0, section.href);
    assert.match(section.href, /^\//);
    assert.ok(section.access, section.href);
    if (section.access.kind === "anyOf") {
      assert.ok(section.access.capabilities.length > 0, section.href);
    }
  }
});

test("адреса разделов не повторяются", () => {
  const seen = new Set(APP_SECTIONS.map((s) => s.href));
  assert.equal(seen.size, APP_SECTIONS.length);
});

test("владелец и управляющая видят всё", () => {
  assert.equal(visibleAppSections(owner).length, APP_SECTIONS.length);
  assert.equal(visibleAppSections(manager).length, APP_SECTIONS.length);
});

test("ROOT видит всё, даже без роли", () => {
  assert.equal(
    visibleAppSections({ isRoot: true }).length,
    APP_SECTIONS.length
  );
});

test("линейному сотруднику открыт только баланс", () => {
  // `/journals` без `journals.view` уводит на «Сегодня» — значит пункта
  // быть не должно: список разделов показывает только то, что реально
  // откроется.
  assert.deepEqual(hrefs(cook), ["/settings/balance"]);
  assert.deepEqual(hrefs(cleaner), ["/settings/balance"]);
});

test("у заведующей в разделах ровно то, что открывается", () => {
  const list = hrefs(headChef);

  // Открывается: страницы с `tasks.verify` и все, где стоит
  // `hasFullWorkspaceAccess` (её роль — управленческая).
  for (const href of [
    "/control-board",
    "/verifications",
    "/journals-progress",
    "/team",
    "/settings/schedule",
    "/plans",
    "/capa",
    "/orders",
    "/mercury",
    "/reports",
    "/settings/balance",
    "/ideas",
    "/settings/users",
    "/settings/equipment",
    "/settings/areas",
    "/settings/products",
    "/settings/buildings",
    "/settings/notifications",
    "/settings/audit",
    "/settings/security",
  ]) {
    assert.ok(list.includes(href), `должно быть видно: ${href}`);
  }

  // Не открывается: журналы (нет `journals.view`) и хаб настроек
  // (нет `admin.full` — страница уводит на «Контрольную доску»).
  assert.ok(!list.includes("/journals"));
  assert.ok(!list.includes("/settings"));
});

test("заведующей закрыты ровно четыре раздела", () => {
  // Журналы (нет `journals.view`) и три страницы с `admin.full`:
  // хаб настроек, «Внешний вид», «Готовность к проверке».
  const list = hrefs(headChef);
  assert.equal(list.length, APP_SECTIONS.length - 4);
  for (const href of [
    "/journals",
    "/settings",
    "/settings/appearance",
    "/dashboard/compliance-audit",
  ]) {
    assert.ok(!list.includes(href), `не должно быть видно: ${href}`);
  }
});

test("повар не видит ни проверок, ни настроек, ни журналов", () => {
  const list = hrefs(cook);
  assert.ok(!list.includes("/verifications"));
  assert.ok(!list.includes("/settings"));
  assert.ok(!list.includes("/reports"));
  assert.ok(!list.includes("/journals"));
});

test("группы отдаются без пустых", () => {
  const groups = visibleAppSectionGroups(cook);
  for (const group of groups) {
    assert.ok(group.sections.length > 0, group.id);
  }
  assert.deepEqual(
    groups.map((g) => g.id),
    ["money"]
  );
  assert.deepEqual(
    visibleAppSectionGroups(owner).map((g) => g.id),
    ["work", "production", "money", "settings"]
  );
});

test("org-override пресета режет разделы так же, как на сайте", () => {
  const limited: AppSectionActor = {
    role: "head_chef",
    permissionPreset: "head_chef",
    orgPresetOverrides: { head_chef: ["staff.view"] },
  };
  const list = hrefs(limited);
  // Проверки задач больше нет — пункт исчез.
  assert.ok(!list.includes("/verifications"));
  assert.ok(!list.includes("/control-board"));
  // А «Сотрудники» проверяют роль, а не возможность — остаются.
  assert.ok(list.includes("/settings/users"));
});

test("правило раздела повторяет проверку самой страницы", () => {
  const section = (href: string) => {
    const found = APP_SECTIONS.find((s) => s.href === href);
    assert.ok(found, href);
    return found;
  };

  // Журналы: страница смотрит `journals.view`.
  assert.deepEqual(section("/journals").access, {
    kind: "anyOf",
    capabilities: ["journals.view"],
  });
  // Хаб настроек: страница смотрит `admin.full`.
  assert.deepEqual(section("/settings").access, {
    kind: "anyOf",
    capabilities: ["admin.full"],
  });
  // Отчёты: страница смотрит `hasFullWorkspaceAccess`, не `reports.view`.
  assert.deepEqual(section("/reports").access, { kind: "fullAccess" });
  // Оборудование: своей проверки у страницы нет.
  assert.deepEqual(section("/settings/equipment").access, { kind: "webPath" });
});

test("canSeeAppSection и visibleAppSections согласованы", () => {
  for (const actor of [owner, manager, headChef, cook, cleaner]) {
    const list = hrefs(actor);
    for (const section of APP_SECTIONS) {
      assert.equal(
        canSeeAppSection(actor, section),
        list.includes(section.href),
        section.href
      );
    }
  }
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
  assert.deepEqual(
    items.map((item) => item.href),
    ["/journals", "/plans", "/capa", "/reports", "/ideas"]
  );
  assert.equal(items[1].label, "Производственный план");
  assert.equal(items[4].label, "Идеи");
  for (const item of items) {
    assert.ok(APP_SECTIONS.some((s) => s.href === item.href));
  }
});

test("убранные из меню разделы не возвращаются ни в шапку, ни в «Разделы»", () => {
  // Партии, Изменения, Потери, Компетенции, Премии — страницы живут по
  // адресу, но в меню их нет (решение владельца 2026-09-25).
  assert.equal(MENU_HIDDEN_HREFS.length, 5);
  const header = headerNavSections().map((item) => item.href);
  const sections = APP_SECTIONS.map((section) => section.href);
  for (const href of MENU_HIDDEN_HREFS) {
    assert.ok(!header.includes(href), `в шапке: ${href}`);
    assert.ok(!sections.includes(href), `в разделах: ${href}`);
  }
});
