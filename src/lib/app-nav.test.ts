import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

import {
  NAV_SECTIONS,
  navAllows,
  sectionForPath,
  visibleNav,
  visibleSettingsCards,
  type NavAccess,
  type NavActor,
  type NavFacts,
} from "./app-nav";
import { SETTINGS_CARDS } from "./settings-cards";
import { isStaffRestrictedWebPath } from "./role-access";

const owner: NavActor = { role: "owner", permissionPreset: "admin" };
const manager: NavActor = { role: "manager", permissionPreset: "admin" };
const root: NavActor = { isRoot: true };
// Заведующая: роль управленческая (`hasFullWorkspaceAccess`), но без
// `admin.full` и без `journals.view`.
const headChef: NavActor = { role: "head_chef", permissionPreset: "head_chef" };
const cook: NavActor = { role: "cook", permissionPreset: "cook" };
const cleaner: NavActor = { role: "cook", permissionPreset: "cleaner" };
// Линейная роль, но пресет заведующей: проверяет задачи, видит команду.
const verifyOnly: NavActor = { role: "cook", permissionPreset: "head_chef" };

const noChecklists: NavFacts = { checklists: false, settingsPermissions: false };
const withChecklists: NavFacts = { checklists: true, settingsPermissions: false };

const DASHBOARD_DIR = join(process.cwd(), "src", "app", "(dashboard)");

/** Все страницы кабинета как пути: `[code]` → `x`. */
function dashboardRoutes(): { route: string; file: string }[] {
  const result: { route: string; file: string }[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name === "page.tsx") {
        const rel = relative(DASHBOARD_DIR, dir).split(sep).filter(Boolean);
        const route =
          "/" + rel.map((part) => (part.startsWith("[") ? "x" : part)).join("/");
        result.push({ route: route === "/" ? "/" : route, file: full });
      }
    }
  };
  walk(DASHBOARD_DIR);
  return result;
}

function pageFileFor(href: string): string | null {
  const parts = href.split("/").filter(Boolean);
  const file = join(DASHBOARD_DIR, ...parts, "page.tsx");
  try {
    return statSync(file).isFile() ? file : null;
  } catch {
    return null;
  }
}

function keys(actor: NavActor, facts: NavFacts = noChecklists): string[] {
  return visibleNav(actor, facts).map((section) => section.key);
}

test("девять разделов в порядке схемы владельца", () => {
  assert.deepEqual(
    NAV_SECTIONS.map((section) => section.key),
    [
      "company",
      "staff",
      "points",
      "journals",
      "checklists",
      "productionControl",
      "billing",
      "more",
      "inspection",
    ],
  );
});

test("у каждого раздела есть иконка и хотя бы одна вкладка, id вкладок не повторяются", () => {
  for (const section of NAV_SECTIONS) {
    assert.ok(section.icon.length > 0, section.key);
    assert.ok(section.tabs.length > 0, section.key);
    const ids = section.tabs.map((tab) => tab.id);
    assert.equal(new Set(ids).size, ids.length, section.key);
  }
});

test("каждая страница кабинета относится к разделу", () => {
  const orphans = dashboardRoutes()
    .map(({ route }) => route)
    .filter((route) => sectionForPath(route) === null);
  assert.deepEqual(orphans, []);
});

test("каждая вкладка и карточка ведёт на существующую страницу", () => {
  for (const section of NAV_SECTIONS) {
    for (const tab of section.tabs) {
      assert.ok(pageFileFor(tab.href), `${section.key}: ${tab.href}`);
    }
  }
  for (const card of SETTINGS_CARDS) {
    assert.ok(pageFileFor(card.href), `карточка ${card.id}: ${card.href}`);
  }
});

test("путь достаётся разделу по самому длинному префиксу", () => {
  assert.equal(sectionForPath("/dashboard")?.section, "journals");
  assert.equal(sectionForPath("/dashboard/catch-up")?.section, "journals");
  assert.equal(sectionForPath("/dashboard/compliance-audit")?.section, "inspection");
  assert.equal(sectionForPath("/journals-progress")?.section, "journals");
  assert.equal(sectionForPath("/journals-progress")?.isTabRoot, false);
  assert.equal(sectionForPath("/journals/hygiene/documents/abc")?.section, "journals");
  assert.equal(sectionForPath("/settings/journals/x/scope")?.section, "journals");
  assert.equal(sectionForPath("/settings/journal-pipelines-tree/x")?.section, "journals");
  assert.equal(sectionForPath("/capa/1")?.section, "more");
  assert.equal(sectionForPath("/settings")?.section, "company");
  assert.equal(sectionForPath("/staff")?.section, "staff");
  assert.equal(sectionForPath("/settings/equipment/qr-sheet")?.section, "points");
  assert.equal(sectionForPath("/settings/onboarding-template")?.section, "company");
  assert.equal(sectionForPath("/inspection")?.section, "inspection");
  // Граница по `/`: `/settings/users-x` не принадлежит `/settings/users`.
  assert.equal(sectionForPath("/journalsx"), null);
});

test("корень вкладки отличается от глубокой страницы", () => {
  assert.equal(sectionForPath("/settings/users")?.isTabRoot, true);
  assert.equal(sectionForPath("/settings/users/abc/access")?.isTabRoot, false);
  assert.equal(sectionForPath("/more")?.isTabRoot, true);
  assert.equal(sectionForPath("/checklists")?.isTabRoot, true);
  assert.equal(sectionForPath("/checklists/inspections/1")?.isTabRoot, false);
});

test("владелец, управляющая и ROOT видят все девять разделов", () => {
  const all = NAV_SECTIONS.map((section) => section.key);
  assert.deepEqual(keys(owner, withChecklists), all);
  assert.deepEqual(keys(manager, withChecklists), all);
  assert.deepEqual(keys(root, withChecklists), all);
});

test("заведующая видит восемь разделов — без «Моей компании»", () => {
  assert.deepEqual(keys(headChef, withChecklists), [
    "staff",
    "points",
    "journals",
    "checklists",
    "productionControl",
    "billing",
    "more",
    "inspection",
  ]);
});

test("у заведующей «Журналы» начинаются с панели контроля", () => {
  const journals = visibleNav(headChef, withChecklists).find((s) => s.key === "journals");
  assert.ok(journals);
  assert.equal(journals.rootHref, "/control-board");
  assert.deepEqual(
    journals.tabs.map((tab) => tab.href),
    ["/control-board", "/verifications", "/settings/sections/journals"],
  );
  // Подпись вкладки — «Сегодня», как у управляющей.
  assert.equal(journals.tabs[0].label, "today");
});

test("у управляющей «Журналы» начинаются с «Сегодня», панели контроля во вкладках нет", () => {
  const journals = visibleNav(manager, withChecklists).find((s) => s.key === "journals");
  assert.ok(journals);
  assert.equal(journals.rootHref, "/dashboard");
  assert.deepEqual(
    journals.tabs.map((tab) => tab.href),
    ["/dashboard", "/journals", "/verifications", "/settings/sections/journals"],
  );
});

test("повар и уборщица видят не больше одного раздела — сайдбара у них нет", () => {
  assert.deepEqual(keys(cook), []);
  assert.deepEqual(keys(cleaner), []);
  assert.deepEqual(keys(cook, withChecklists), ["checklists"]);
});

test("пользователь с пресетом заведующей и линейной ролью видит команду, проверку и «Пришла проверка»", () => {
  const sections = visibleNav(verifyOnly, noChecklists);
  assert.deepEqual(
    sections.map((s) => s.key),
    ["staff", "journals", "inspection"],
  );
  assert.equal(sections[0].rootHref, "/team");
  assert.equal(sections[1].rootHref, "/control-board");
  assert.equal(sections[2].rootHref, "/inspection");
  assert.deepEqual(sections[2].tabs.map((tab) => tab.href), ["/inspection"]);
});

test("«Разрешение менять настройки» (роль owner в сессии) — как руководство", () => {
  // Сессия подменяет роль на `owner`, пресет остаётся явным.
  const settingsManager: NavActor = { role: "owner", permissionPreset: "cook" };
  const list = keys(settingsManager, noChecklists);
  assert.ok(list.includes("points"));
  assert.ok(list.includes("more"));
  // Но `admin.full` у пресета повара нет — «Моя компания» закрыта.
  assert.ok(!list.includes("company"));
});

test("правило proxy: линейному сотруднику закрыты /more и /production-control, открыта /inspection", () => {
  assert.ok(isStaffRestrictedWebPath("/more"));
  assert.ok(isStaffRestrictedWebPath("/production-control"));
  assert.ok(!isStaffRestrictedWebPath("/inspection"));
  assert.ok(!isStaffRestrictedWebPath("/checklists"));
  const staffPath: NavAccess = { kind: "staffPath" };
  assert.equal(navAllows(cook, "/more", staffPath, noChecklists), false);
  assert.equal(navAllows(cook, "/settings/balance", staffPath, noChecklists), true);
});

/**
 * Правило вкладки повторяет проверку самой страницы. Текст страницы
 * читаем как есть: если guard поменяют, тест покажет расхождение.
 */
function guardTokens(access: NavAccess): string[][] {
  switch (access.kind) {
    case "staffPath":
      return [];
    case "fullAccess":
      return [["hasFullWorkspaceAccess(", "isManagementRole("]];
    case "anyOf":
      return [access.capabilities.map((capability) => `"${capability}"`)];
    case "fullAccessOr":
      return [
        [
          "hasFullWorkspaceAccess(",
          ...access.capabilities.map((capability) => `"${capability}"`),
        ],
      ];
    case "all":
      return access.rules.flatMap(guardTokens);
    case "fact":
      return [
        [access.fact === "settingsPermissions" ? "sessionHasPermission(" : "hasJournalAccess("],
      ];
  }
}

test("правило каждой вкладки и карточки повторяет guard страницы", () => {
  const links = [
    ...NAV_SECTIONS.flatMap((section) =>
      section.tabs.map((tab) => ({ name: `${section.key}/${tab.id}`, href: tab.href, access: tab.access })),
    ),
    ...SETTINGS_CARDS.map((card) => ({ name: `card ${card.id}`, href: card.href, access: card.access })),
  ];
  for (const link of links) {
    const file = pageFileFor(link.href);
    assert.ok(file, link.name);
    const source = readFileSync(file, "utf8");
    for (const alternatives of guardTokens(link.access)) {
      assert.ok(
        alternatives.some((token) => source.includes(token)),
        `${link.name} (${link.href}): в странице нет ни одного из ${alternatives.join(", ")}`,
      );
    }
  }
});

test("карточки прав и иерархии зависят от права settings.permissions, а не от роли", () => {
  const rights = SETTINGS_CARDS.filter((card) =>
    ["settings_permissions", "settings_staff_hierarchy"].includes(card.id),
  );
  assert.equal(rights.length, 2);
  const without: NavFacts = { checklists: false, settingsPermissions: false };
  const withRight: NavFacts = { checklists: false, settingsPermissions: true };
  for (const card of rights) {
    assert.deepEqual(card.access, { kind: "fact", fact: "settingsPermissions" }, card.id);
    assert.equal(navAllows(manager, card.href, card.access, without), false, card.id);
    assert.equal(navAllows(manager, card.href, card.access, withRight), true, card.id);
  }
});

test("«Шаблон заведения» — вкладка раздела «Моя компания»", () => {
  const company = NAV_SECTIONS.find((section) => section.key === "company");
  assert.ok(company?.tabs.some((tab) => tab.href === "/settings/onboarding-template"));
});

test("поиск: управляющей доступны карточки настроек, повару — нет", () => {
  const hrefs = visibleSettingsCards(manager, withChecklists).map((card) => card.href);
  for (const href of ["/reports", "/capa", "/settings/journals"]) {
    assert.ok(hrefs.includes(href), href);
  }
  assert.deepEqual(visibleSettingsCards(cook, noChecklists), []);
});

test("у каждой иконки меню и карточек есть компонент", async () => {
  const { hasNavIcon } = await import("../components/layout/nav-icons");
  for (const name of [
    ...NAV_SECTIONS.map((section) => section.icon),
    ...SETTINGS_CARDS.map((card) => card.icon),
  ]) {
    assert.ok(hasNavIcon(name), name);
  }
});
