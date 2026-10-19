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
import { PPK_MENU_GROUPS, ppkMenuBlocks } from "./ppk/registry";
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
    ...NAV_SECTIONS.flatMap((section) => [
      ...section.tabs.map((tab) => ({
        name: `${section.key}/${tab.id}`,
        href: tab.href,
        access: tab.access,
      })),
      ...(section.menu ?? []).flatMap((group) =>
        group.items.flatMap((item) => [
          { name: `${section.key}/${item.id}`, href: item.href, access: item.access },
          ...(item.tabs ?? []).map((tab) => ({
            name: `${section.key}/${item.id}/${tab.id}`,
            href: tab.href,
            access: tab.access,
          })),
        ]),
      ),
    ]),
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

test("права и иерархия зависят от права settings.permissions, а не от роли", () => {
  const staff = NAV_SECTIONS.find((section) => section.key === "staff");
  const links = (staff?.menu ?? []).flatMap((group) =>
    group.items.flatMap((item) => [item, ...(item.tabs ?? [])]),
  );
  const rights = links.filter((link) =>
    ["/settings/permissions", "/settings/staff-hierarchy"].includes(link.href),
  );
  assert.equal(rights.length, 2);
  const without: NavFacts = { checklists: false, settingsPermissions: false };
  const withRight: NavFacts = { checklists: false, settingsPermissions: true };
  for (const link of rights) {
    assert.deepEqual(link.access, { kind: "fact", fact: "settingsPermissions" }, link.href);
    assert.equal(navAllows(manager, link.href, link.access, without), false, link.href);
    assert.equal(navAllows(manager, link.href, link.access, withRight), true, link.href);
  }
});

test("«Шаблон заведения» — вкладка и пункт меню раздела «Моя компания»", () => {
  const company = NAV_SECTIONS.find((section) => section.key === "company");
  assert.ok(company?.tabs.some((tab) => tab.href === "/settings/onboarding-template"));
  assert.ok(company?.menu?.some((group) => group.items.some((item) => item.href === "/settings/onboarding-template")));
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
    ...NAV_SECTIONS.flatMap((section) =>
      (section.menu ?? []).flatMap((group) => group.items.map((item) => item.icon)),
    ),
  ]) {
    assert.ok(hasNavIcon(name), name);
  }
});

test("«Производственный контроль»: вкладок-групп нет, есть меню раздела из реестра", () => {
  const section = NAV_SECTIONS.find((item) => item.key === "productionControl");
  assert.ok(section);
  // Одна вкладка — корень раздела: вкладок над страницей не будет.
  assert.deepEqual(section.tabs.map((tab) => tab.href), ["/production-control"]);
  assert.ok(section.menu);
  assert.deepEqual(
    section.menu.map((group) => group.label),
    PPK_MENU_GROUPS.filter((group) => ppkMenuBlocks(group.key).length > 0).map((group) =>
      group.labelled ? group.key : null,
    ),
  );
  const main = section.menu[0];
  assert.equal(main.label, null);
  assert.deepEqual(
    main.items.map((item) => item.id),
    ppkMenuBlocks("main").map((block) => block.key),
  );
  assert.deepEqual(main.items.slice(0, 3).map((item) => item.id), ["program", "instructions", "procedures"]);
  const documents = section.menu.find((group) => group.label === "documents");
  const norms = documents?.items.find((item) => item.id === "norm-documents");
  assert.equal(norms?.href, "/production-control/norms/documents");
  assert.deepEqual(norms?.tabs?.map((tab) => tab.id), ["list", "guidelines", "sanpin"]);
});

test("у каждого пункта и вкладки меню раздела есть страница", () => {
  for (const section of NAV_SECTIONS) {
    for (const group of section.menu ?? []) {
      for (const item of group.items) {
        assert.ok(pageFileFor(item.href), `${section.key}/${item.id}: ${item.href}`);
        for (const tab of item.tabs ?? []) {
          assert.ok(pageFileFor(tab.href), `${section.key}/${item.id}/${tab.id}: ${tab.href}`);
        }
      }
    }
  }
});

test("пункт меню — владелец своего адреса: пункт и вкладка для пути", () => {
  const order = sectionForPath("/orders/x");
  assert.equal(order?.section, "productionControl");
  assert.equal(order?.menuItemId, "orders");
  assert.equal(sectionForPath("/sanpin")?.menuItemId, "norm-documents");
  assert.equal(sectionForPath("/sanpin")?.menuTabHref, "/sanpin");
  assert.equal(sectionForPath("/production-control/norms/guidelines")?.menuItemId, "norm-documents");
  assert.equal(
    sectionForPath("/production-control/norms/guidelines")?.menuTabHref,
    "/production-control/norms/guidelines",
  );
  assert.equal(sectionForPath("/production-control/haccp/products/x")?.menuItemId, "products");
  assert.equal(sectionForPath("/knowledge")?.menuItemId, "instructions");
  // Корень раздела — пункт «ППК» и корень вкладки.
  const root = sectionForPath("/production-control");
  assert.equal(root?.menuItemId, "program");
  assert.equal(root?.isTabRoot, true);
  // Адрес без своего пункта (блок ещё не готов) остаётся в разделе, у «ППК».
  assert.equal(sectionForPath("/production-control/sanitation/lab")?.section, "productionControl");
  // Карточки «Остального» и адреса без пункта пунктов меню не имеют.
  assert.equal(sectionForPath("/settings")?.menuItemId, null);
  assert.equal(sectionForPath("/capa")?.menuItemId, null);
  assert.equal(sectionForPath("/more")?.menuItemId, null);
});

test("видимое меню: у пункта с вкладками адрес — первая видимая вкладка", () => {
  const section = visibleNav(manager, withChecklists).find((item) => item.key === "productionControl");
  assert.ok(section?.menu);
  const items = section.menu.flatMap((group) => group.items);
  const norms = items.find((item) => item.id === "norm-documents");
  assert.equal(norms?.href, "/production-control/norms/documents");
  assert.deepEqual(norms?.tabs?.map((tab) => tab.href), ["/production-control/norms/documents", "/production-control/norms/guidelines", "/sanpin"]);
  assert.equal(section.rootHref, "/production-control");
  for (const group of section.menu) assert.ok(group.items.length > 0);
});

test("заведующая: пункта «Рабочие инструкции» нет, «Процедуры» есть", () => {
  const section = visibleNav(headChef, withChecklists).find((item) => item.key === "productionControl");
  assert.ok(section?.menu);
  const ids = section.menu.flatMap((group) => group.items.map((item) => item.id));
  assert.ok(!ids.includes("instructions"));
  assert.ok(ids.includes("procedures"));
});

test("управляющая с правом просмотра журналов видит «Рабочие инструкции»", () => {
  const section = visibleNav(manager, withChecklists).find((item) => item.key === "productionControl");
  const ids = section?.menu?.flatMap((group) => group.items.map((item) => item.id)) ?? [];
  assert.ok(ids.includes("instructions"));
});

test("повар: раздела «Производственный контроль» нет", () => {
  assert.ok(!keys(cook, withChecklists).includes("productionControl"));
});

/** Пункты меню раздела: пары «подпись группы — id пунктов». */
function menuShape(key: string): [string | null, string[]][] {
  const section = NAV_SECTIONS.find((item) => item.key === key);
  return (section?.menu ?? []).map((group) => [group.label, group.items.map((item) => item.id)]);
}

test("у каждого раздела, кроме «Остального», своё меню — пункты по эскизам руководителя", () => {
  for (const section of NAV_SECTIONS) {
    if (section.key === "more") assert.equal(section.menu, undefined);
    else assert.ok(section.menu && section.menu.length > 0, section.key);
  }
  assert.deepEqual(menuShape("company"), [
    [null, ["organization", "documents", "branding", "contacts"]],
    ["more", ["names", "onboarding", "template", "appearance"]],
  ]);
  assert.deepEqual(menuShape("staff"), [
    ["directories", ["users", "access"]],
    ["more", ["team", "schedule", "health", "responsibles", "hierarchy", "visibility", "workload", "phone"]],
  ]);
  assert.deepEqual(menuShape("points"), [
    [null, ["buildings", "areas", "equipment", "qr"]],
    ["more", ["printer", "kiosk", "products", "master"]],
  ]);
  assert.deepEqual(menuShape("journals"), [[null, ["today", "control", "all", "verify", "setup"]]]);
  assert.deepEqual(menuShape("checklists"), [[null, ["builder"]]]);
  assert.deepEqual(menuShape("billing"), [[null, ["plan", "balance", "services"]]]);
  assert.deepEqual(menuShape("inspection"), [[null, ["now", "portal", "readiness"]]]);
  const access = NAV_SECTIONS.find((item) => item.key === "staff")?.menu?.[0].items.find((item) => item.id === "access");
  assert.deepEqual(access?.tabs?.map((tab) => tab.href), [
    "/settings/permissions",
    "/settings/role-presets",
    "/settings/journal-access",
    "/settings/journals-by-position",
  ]);
});

test("id пунктов и вкладок меню в разделе не повторяются", () => {
  for (const section of NAV_SECTIONS) {
    const items = (section.menu ?? []).flatMap((group) => group.items);
    const ids = items.map((item) => item.id);
    assert.equal(new Set(ids).size, ids.length, section.key);
    for (const item of items) {
      const tabIds = (item.tabs ?? []).map((tab) => tab.id);
      assert.equal(new Set(tabIds).size, tabIds.length, `${section.key}/${item.id}`);
    }
  }
});

test("каждая вкладка раздела с меню — пункт или вкладка пункта его меню", () => {
  for (const section of NAV_SECTIONS) {
    if (!section.menu) continue;
    const hrefs = new Set(
      section.menu.flatMap((group) =>
        group.items.flatMap((item) => [item.href, ...(item.tabs ?? []).map((tab) => tab.href)]),
      ),
    );
    for (const tab of section.tabs) assert.ok(hrefs.has(tab.href), `${section.key}: ${tab.href}`);
  }
});

test("match пункта: карточки и подстраницы подсвечивают свой пункт", () => {
  const periods = sectionForPath("/settings/journal-periods");
  assert.equal(periods?.section, "journals");
  assert.equal(periods?.menuItemId, "setup");
  assert.equal(periods?.ownerHref, "/settings/sections/journals");
  assert.equal(sectionForPath("/settings/journal-pipelines-tree/x")?.menuItemId, "setup");
  assert.equal(sectionForPath("/settings/journals/x/scope")?.menuItemId, "setup");
  assert.equal(sectionForPath("/settings/users/x/access")?.menuItemId, "users");
  const presets = sectionForPath("/settings/role-presets");
  assert.equal(presets?.section, "staff");
  assert.equal(presets?.menuItemId, "access");
  assert.equal(presets?.menuTabHref, "/settings/role-presets");
  assert.equal(sectionForPath("/settings/print-agent")?.menuItemId, "printer");
  assert.equal(sectionForPath("/settings/equipment/qr-sheet")?.menuItemId, "equipment");
  assert.equal(sectionForPath("/dashboard/catch-up")?.menuItemId, "today");
  assert.equal(sectionForPath("/dashboard/compliance-audit")?.menuItemId, "readiness");
  assert.equal(sectionForPath("/control-board")?.menuItemId, "control");
  assert.equal(sectionForPath("/journals/hygiene/documents/x")?.menuItemId, "all");
  assert.equal(sectionForPath("/checklists/inspections/1")?.menuItemId, "builder");
  // Бывшие «Настройки» сотрудников и точек — в своих разделах (редиректы).
  assert.equal(sectionForPath("/settings/sections/staff")?.section, "staff");
  assert.equal(sectionForPath("/settings/sections/points")?.section, "points");
  // ППК не задет.
  assert.equal(sectionForPath("/production-control/haccp/team")?.section, "productionControl");
  assert.equal(sectionForPath("/production-control/haccp/team")?.menuItemId, "team");
});

function visibleItemIds(actor: NavActor, key: string, facts: NavFacts = withChecklists): string[] {
  const section = visibleNav(actor, facts).find((item) => item.key === key);
  return (section?.menu ?? []).flatMap((group) => group.items.map((item) => item.id));
}

test("«Сегодня»: у управляющей — журналы дня, у заведующей — панель контроля", () => {
  assert.deepEqual(visibleItemIds(manager, "journals"), ["today", "all", "verify", "setup"]);
  assert.deepEqual(visibleItemIds(headChef, "journals"), ["control", "verify", "setup"]);
  const journals = visibleNav(headChef, withChecklists).find((item) => item.key === "journals");
  assert.equal(journals?.menu?.[0].items[0].href, "/control-board");
});

test("заведующая: пунктов только для admin.full нет", () => {
  assert.deepEqual(visibleItemIds(headChef, "staff"), [
    "users",
    "access",
    "team",
    "schedule",
    "health",
    "visibility",
    "phone",
  ]);
  const access = visibleNav(headChef, withChecklists)
    .find((item) => item.key === "staff")
    ?.menu?.[0].items.find((item) => item.id === "access");
  // «Права» — по праву из БД, «Наборы прав» — admin.full: заведующей — две вкладки.
  assert.deepEqual(access?.tabs?.map((tab) => tab.id), ["journals", "positions"]);
  assert.equal(access?.href, "/settings/journal-access");
  assert.deepEqual(visibleItemIds(headChef, "inspection"), ["now", "portal"]);
  assert.deepEqual(visibleItemIds(headChef, "billing"), ["plan", "balance", "services"]);
});

test("руководитель видит все пункты меню каждого раздела", () => {
  const full: NavFacts = { checklists: true, settingsPermissions: true };
  for (const section of NAV_SECTIONS) {
    const all = (section.menu ?? []).flatMap((group) =>
      group.items.filter((item) => !item.hideIfVisible).map((item) => item.id),
    );
    assert.deepEqual(visibleItemIds(owner, section.key, full), all, section.key);
  }
});

test("«Моя компания»: сведения для документов, логотип и контакты — свои пункты, только руководителю", () => {
  const items = NAV_SECTIONS.find((section) => section.key === "company")?.menu?.[0].items ?? [];
  const hrefs = Object.fromEntries(items.map((item) => [item.id, item.href]));
  assert.deepEqual(hrefs, {
    organization: "/settings/organization",
    documents: "/settings/organization/documents",
    branding: "/settings/organization/branding",
    contacts: "/settings/organization/contacts",
  });
  for (const item of items) assert.deepEqual(item.access, { kind: "anyOf", capabilities: ["admin.full"] }, item.id);
  // Новые адреса — пункты, а не глубина «Реквизитов».
  for (const id of ["documents", "branding", "contacts"]) {
    const place = sectionForPath(`/settings/organization/${id}`);
    assert.equal(place?.section, "company", id);
    assert.equal(place?.menuItemId, id, id);
  }
  assert.equal(sectionForPath("/settings/organization")?.menuItemId, "organization");
  assert.deepEqual(visibleItemIds(manager, "company"), ["organization", "documents", "branding", "contacts", "names", "onboarding", "template", "appearance"]);
  // Заведующей раздела нет вовсе; повару — тоже.
  assert.deepEqual(visibleItemIds(headChef, "company"), []);
  assert.deepEqual(visibleItemIds(cook, "company"), []);
});

test("пресет заведующей у линейной роли: в «Сотрудниках» — только команда", () => {
  // `/settings/phone` линейной роли закрывает proxy.ts — пункта нет, как не было и карточки.
  assert.deepEqual(visibleItemIds(verifyOnly, "staff", noChecklists), ["team"]);
  assert.deepEqual(visibleItemIds(verifyOnly, "inspection", noChecklists), ["now"]);
});
