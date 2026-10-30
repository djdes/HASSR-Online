import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

import {
  NAV_SECTIONS,
  OPEN_TO_ALL_NAV_HREFS,
  ROLE_HOME_NAV_HREFS,
  deniedNavHrefs,
  isNavHrefDenied,
  routedAwayNavHrefs,
  mainNavSections,
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
const MISSING_CATCH_ALL = "[...missing]";

/**
 * Все страницы кабинета как пути: `[code]` → `x`. Ловушки неизвестных адресов
 * (`<раздел>/[...missing]`, только `notFound()`) — не страницы, их пропускаем.
 */
function dashboardRoutes(): { route: string; file: string }[] {
  const result: { route: string; file: string }[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (name === MISSING_CATCH_ALL) continue;
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

/** Страницы кабинета вне разделов: главная — корень главного меню. */
const OUTSIDE_SECTIONS = new Set(["/home"]);

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

const ALL_KEYS = [
  "company",
  "office",
  "points",
  "staff",
  "journals",
  "productionControl",
  "monitoring",
  "checklists",
  "billing",
  "settings",
  "more",
  "inspection",
];

function mainKeys(actor: NavActor, facts: NavFacts = withChecklists): string[] {
  return mainNavSections(visibleNav(actor, facts)).map((section) => section.key);
}

test("разделы в порядке схемы владельца; главное меню руководителя — четыре раздела и «Пришла проверка»", () => {
  assert.deepEqual(
    NAV_SECTIONS.map((section) => section.key),
    ALL_KEYS,
  );
  // Эскиз 2026-10-28, лист 1: Моя компания, Мониторинг, Подписки, Настройки и оформление.
  assert.deepEqual(mainKeys(owner), ["company", "monitoring", "billing", "settings", "inspection"]);
  assert.deepEqual(mainKeys(manager), ["company", "monitoring", "billing", "settings", "inspection"]);
  assert.deepEqual(mainKeys(root), ["company", "monitoring", "billing", "settings", "inspection"]);
});

test("дерево: Моя компания → Офис / Торговые точки → Сотрудники / Журналы / ППК; Мониторинг → Чек-листы", () => {
  const parents = Object.fromEntries(NAV_SECTIONS.map((section) => [section.key, section.parent ?? null]));
  assert.deepEqual(parents, {
    company: null,
    office: "company",
    points: "company",
    staff: "points",
    journals: "points",
    productionControl: "points",
    monitoring: null,
    checklists: "monitoring",
    billing: null,
    settings: null,
    more: "company",
    inspection: null,
  });
  // Вложенный раздел — пункт меню своего родителя, и только его.
  for (const section of NAV_SECTIONS) {
    const listedIn = NAV_SECTIONS.filter((parent) =>
      (parent.menu ?? []).some((group) => (group.sections ?? []).includes(section.key)),
    ).map((parent) => parent.key);
    assert.deepEqual(listedIn, section.parent ? [section.parent] : [], section.key);
  }
  const visible = visibleNav(owner, withChecklists);
  const item = (key: string, id: string) =>
    visible.find((section) => section.key === key)?.menu?.flatMap((group) => group.items).find((entry) => entry.id === id);
  // Пункт-раздел ведёт на корень вложенного раздела; стрелка — у раздела со своим меню.
  assert.deepEqual(
    [item("company", "points")?.href, item("company", "points")?.section, item("company", "points")?.hasMenu],
    ["/settings/buildings", "points", true],
  );
  assert.equal(item("company", "more")?.href, "/more");
  assert.equal(item("company", "more")?.hasMenu, undefined);
  assert.equal(item("points", "journals")?.href, "/journals/points");
  assert.equal(item("points", "staff")?.href, "/settings/users");
  assert.equal(item("monitoring", "checklists")?.href, "/checklists/templates");
  // Мастер-кабинет — с меткой PRO (эскиз: «доступно в PRO»).
  assert.equal(item("company", "master")?.badge, "pro");
  // Видимый родитель у вложенного раздела.
  assert.equal(visible.find((section) => section.key === "staff")?.parent, "points");
  assert.equal(visible.find((section) => section.key === "company")?.parent, undefined);
});

test("закрытый родитель поднимает раздел в главное меню — права не меняются", () => {
  // Заведующей «Моя компания» закрыта: «Офис» (права и доступ), «Торговые точки» и «Остальное» — в главном меню.
  assert.deepEqual(mainKeys(headChef), ["office", "points", "monitoring", "billing", "settings", "more", "inspection"]);
  // Повар с доступом к чек-листам: «Мониторинг» закрыт — «Чек-листы» сами по себе.
  assert.deepEqual(mainKeys(cook), ["checklists"]);
  // Линейная роль с пресетом заведующей: «Торговые точки» закрыты — «Сотрудники» и «Журналы» сверху.
  assert.deepEqual(mainKeys(verifyOnly, noChecklists), ["staff", "journals", "inspection"]);
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
    .filter((route) => !OUTSIDE_SECTIONS.has(route) && sectionForPath(route) === null);
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
  assert.equal(sectionForPath("/settings/onboarding-template")?.section, "settings");
  assert.equal(sectionForPath("/inspection")?.section, "inspection");
  // Граница по `/`: `/settings/users-x` не принадлежит `/settings/users`.
  assert.equal(sectionForPath("/journalsx"), null);
});

test("корень вкладки отличается от глубокой страницы", () => {
  assert.equal(sectionForPath("/settings/users")?.isTabRoot, true);
  assert.equal(sectionForPath("/settings/users/abc/access")?.isTabRoot, false);
  assert.equal(sectionForPath("/more")?.isTabRoot, true);
  // Корень «Чек-листов» — «Шаблоны»; конструктор — свой пункт, не корень раздела.
  assert.equal(sectionForPath("/checklists/templates")?.isTabRoot, true);
  assert.equal(sectionForPath("/checklists")?.isTabRoot, false);
  assert.equal(sectionForPath("/checklists/inspections/1")?.isTabRoot, false);
});

test("владелец, управляющая и ROOT видят все разделы", () => {
  const all = NAV_SECTIONS.map((section) => section.key);
  assert.deepEqual(keys(owner, withChecklists), all);
  assert.deepEqual(keys(manager, withChecklists), all);
  assert.deepEqual(keys(root, withChecklists), all);
});

test("заведующая видит всё, кроме «Моей компании»", () => {
  assert.deepEqual(
    keys(headChef, withChecklists),
    ALL_KEYS.filter((key) => key !== "company"),
  );
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

test("у управляющей «Журналы» начинаются с журналов точек, панели контроля во вкладках нет", () => {
  const journals = visibleNav(manager, withChecklists).find((s) => s.key === "journals");
  assert.ok(journals);
  assert.deepEqual(
    journals.tabs.map((tab) => tab.href),
    ["/journals/points", "/dashboard", "/journals", "/verifications", "/settings/sections/journals"],
  );
  // Корень «Журналов» руководителя — журналы всех точек (эскиз: список точек с журналами).
  assert.equal(journals.rootHref, "/journals/points");
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
    case "notPointMode":
      return [["journalsPointMode("]];
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
  const items = (staff?.menu ?? []).flatMap((group) => group.items);
  // «Иерархия» — пункт меню по праву из БД.
  const hierarchy = items.find((item) => item.href === "/settings/staff-hierarchy");
  assert.ok(hierarchy);
  const without: NavFacts = { checklists: false, settingsPermissions: false };
  const withRight: NavFacts = { checklists: false, settingsPermissions: true };
  assert.deepEqual(hierarchy.access, { kind: "fact", fact: "settingsPermissions" });
  assert.equal(navAllows(manager, hierarchy.href, hierarchy.access, without), false);
  assert.equal(navAllows(manager, hierarchy.href, hierarchy.access, withRight), true);
  // «Права доступа» — не пункт и не вкладка, а подробный редактор пункта
  // «Доступ и права»: блок со ссылкой на него страница показывает по тому
  // же праву, что пускает саму страницу прав.
  assert.ok(!items.some((item) => item.href === "/settings/permissions"));
  const officeItems = (NAV_SECTIONS.find((section) => section.key === "office")?.menu ?? []).flatMap((group) => group.items);
  const access = officeItems.find((item) => item.id === "access");
  assert.ok(access?.match?.includes("/settings/permissions"));
  const accessPage = readFileSync(pageFileFor("/settings/access") ?? "", "utf8");
  const permissionsPage = readFileSync(pageFileFor("/settings/permissions") ?? "", "utf8");
  for (const source of [accessPage, permissionsPage]) {
    assert.match(source, /sessionHasPermission\(session, "settings\.permissions"\)/);
  }
  // Ссылка «Настроить наборы» — только с admin.full, как страница наборов.
  assert.match(accessPage, /hasCapability\(session\.user, "admin\.full"\)/);
  assert.match(readFileSync(pageFileFor("/settings/role-presets") ?? "", "utf8"), /"admin\.full"/);
});

test("«Шаблон заведения» — пункт меню «Настроек и оформления»", () => {
  const settings = NAV_SECTIONS.find((section) => section.key === "settings");
  assert.ok(settings?.menu?.some((group) => group.items.some((item) => item.href === "/settings/onboarding-template")));
  assert.equal(sectionForPath("/settings/onboarding-template")?.section, "settings");
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

/** Пункты меню раздела: пары «подпись группы — id пунктов» (вложенные разделы — первыми). */
function menuShape(key: string): [string | null, string[]][] {
  const section = NAV_SECTIONS.find((item) => item.key === key);
  return (section?.menu ?? []).map((group) => [
    group.label,
    [...(group.sections ?? []), ...group.items.map((item) => item.id)],
  ]);
}

test("у каждого раздела, кроме «Остального», своё меню — пункты по эскизам руководителя", () => {
  for (const section of NAV_SECTIONS) {
    if (section.key === "more") assert.equal(section.menu, undefined);
    else assert.ok(section.menu && section.menu.length > 0, section.key);
  }
  // Лист 2: Офис ›, Торговые точки ›, Мастер-кабинет (PRO), Остальное, Реквизиты.
  assert.deepEqual(menuShape("company"), [
    [null, ["office", "points", "master"]],
    [null, ["more", "organization"]],
  ]);
  // Лист 3: Сотрудники офиса; Права, доступ.
  assert.deepEqual(menuShape("office"), [[null, ["office", "access"]]]);
  // Лист 4: Сотрудники Т.Т. ›, Журналы ›, ППК ›, Цеха и помещения, Оборудование, QR-плакат.
  assert.deepEqual(menuShape("points"), [
    [null, ["staff", "journals", "productionControl", "areas", "equipment", "qr"]],
    ["more", ["printer", "kiosk", "products"]],
  ]);
  assert.deepEqual(menuShape("staff"), [
    ["directories", ["users", "positions"]],
    ["groups", ["commission", "haccpGroup", "controlGroup", "inspectors"]],
    ["more", ["team", "schedule", "health", "responsibles", "hierarchy", "visibility", "workload", "phone"]],
  ]);
  // «Настройка» — в общем списке, под ним наборы журналов (владелец, 2026-10-28).
  assert.deepEqual(menuShape("journals"), [
    [null, ["points", "today", "control", "all", "verify", "setup"]],
    ["sets", ["standard", "haccp", "extra"]],
  ]);
  assert.deepEqual(menuShape("monitoring"), [[null, ["overview"]], [null, ["checklists"]]]);
  assert.deepEqual(menuShape("checklists"), [[null, ["templates", "builder", "assignments", "results"]]]);
  assert.deepEqual(menuShape("billing"), [[null, ["plan", "balance", "services"]]]);
  assert.deepEqual(menuShape("settings"), [[null, ["appearance", "branding", "names", "onboarding", "template"]]]);
  // Фото 6-го листа: нормативные документы, ППК и ХАССП, QR для проверяющего, консалтинг.
  assert.deepEqual(menuShape("inspection"), [
    [null, ["laws", "norms", "portal", "experts"]],
    ["more", ["now", "visits", "readiness", "special"]],
  ]);
  // «Права и доступ» — одна страница без вкладок; прежние четыре страницы —
  // её подробные редакторы (подсвечивают пункт).
  const access = NAV_SECTIONS.find((item) => item.key === "office")?.menu?.[0].items.find((item) => item.id === "access");
  assert.equal(access?.href, "/settings/access");
  assert.equal(access?.tabs, undefined);
  assert.deepEqual(access?.match, [
    "/settings/permissions",
    "/settings/role-presets",
    "/settings/journal-access",
    "/settings/journals-by-position",
  ]);
});

test("id пунктов и вкладок меню в разделе не повторяются", () => {
  for (const section of NAV_SECTIONS) {
    const items = (section.menu ?? []).flatMap((group) => group.items);
    const ids = [...(section.menu ?? []).flatMap((group) => group.sections ?? []), ...items.map((item) => item.id)];
    assert.equal(new Set(ids).size, ids.length, section.key);
    for (const item of items) {
      const tabIds = (item.tabs ?? []).map((tab) => tab.id);
      assert.equal(new Set(tabIds).size, tabIds.length, `${section.key}/${item.id}`);
    }
  }
});

test("каждая вкладка раздела с меню — пункт, вкладка пункта или корень раздела", () => {
  for (const section of NAV_SECTIONS) {
    if (!section.menu) continue;
    const hrefs = new Set(
      section.menu.flatMap((group) =>
        group.items.flatMap((item) => [item.href, ...(item.tabs ?? []).map((tab) => tab.href)]),
      ),
    );
    // Корень «Торговых точек» — список точек: на него ведёт заголовок меню, своего пункта нет (эскиз).
    hrefs.add(section.tabs[0].href);
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
  for (const editor of ["/settings/permissions", "/settings/role-presets", "/settings/journal-access", "/settings/journals-by-position"]) {
    const place = sectionForPath(editor);
    assert.equal(place?.section, "office", editor);
    assert.equal(place?.menuItemId, "access", editor);
    assert.equal(place?.menuTabHref, null, editor);
    assert.equal(place?.ownerHref, "/settings/access", editor);
  }
  assert.equal(sectionForPath("/settings/access")?.menuItemId, "access");
  assert.equal(sectionForPath("/settings/positions")?.menuItemId, "positions");
  assert.equal(sectionForPath("/settings/brakerage-commission")?.menuItemId, "commission");
  assert.equal(sectionForPath("/settings/haccp-group")?.menuItemId, "haccpGroup");
  assert.equal(sectionForPath("/settings/control-group")?.menuItemId, "controlGroup");
  assert.equal(sectionForPath("/settings/inspectors")?.menuItemId, "inspectors");
  // «Кто видит коллег» — по-прежнему свой пункт в «Ещё».
  assert.equal(sectionForPath("/settings/position-staff-visibility")?.menuItemId, "visibility");
  assert.equal(sectionForPath("/settings/print-agent")?.menuItemId, "printer");
  assert.equal(sectionForPath("/settings/equipment/qr-sheet")?.menuItemId, "equipment");
  assert.equal(sectionForPath("/dashboard/catch-up")?.menuItemId, "today");
  assert.equal(sectionForPath("/dashboard/compliance-audit")?.menuItemId, "readiness");
  assert.equal(sectionForPath("/control-board")?.menuItemId, "control");
  assert.equal(sectionForPath("/journals/hygiene/documents/x")?.menuItemId, "all");
  // Проверка — глубина «Результатов»; конструктор и новые страницы — свои пункты.
  assert.equal(sectionForPath("/checklists/inspections/1")?.menuItemId, "results");
  assert.equal(sectionForPath("/checklists")?.menuItemId, "builder");
  assert.equal(sectionForPath("/checklists/templates")?.menuItemId, "templates");
  assert.equal(sectionForPath("/checklists/assignments")?.menuItemId, "assignments");
  assert.equal(sectionForPath("/checklists/results")?.menuItemId, "results");
  // Бывшие «Настройки» сотрудников и точек — в своих разделах (редиректы).
  assert.equal(sectionForPath("/settings/sections/staff")?.section, "staff");
  assert.equal(sectionForPath("/settings/sections/points")?.section, "points");
  // Точки: список, мастер добавления и страница точки — корень «Торговых точек».
  assert.equal(sectionForPath("/settings/buildings")?.section, "points");
  assert.equal(sectionForPath("/settings/buildings/new")?.section, "points");
  assert.equal(sectionForPath("/settings/buildings/x")?.section, "points");
  assert.equal(sectionForPath("/settings/buildings/x")?.menuItemId, null);
  // Новые страницы — свои пункты.
  assert.equal(sectionForPath("/journals/points")?.menuItemId, "points");
  assert.equal(sectionForPath("/journals/points")?.section, "journals");
  assert.equal(sectionForPath("/monitoring")?.section, "monitoring");
  assert.equal(sectionForPath("/settings/master-cabinet")?.section, "company");
  assert.equal(sectionForPath("/settings/organization/contacts")?.menuItemId, "organization");
  assert.equal(sectionForPath("/settings/organization/contacts")?.menuTabHref, "/settings/organization/contacts");
  assert.equal(sectionForPath("/settings/organization/branding")?.section, "settings");
  assert.equal(sectionForPath("/settings/organization/office")?.section, "office");
  // Главная — вне разделов: слева главное меню.
  assert.equal(sectionForPath("/home"), null);
  // ППК не задет.
  assert.equal(sectionForPath("/production-control/haccp/team")?.section, "productionControl");
  assert.equal(sectionForPath("/production-control/haccp/team")?.menuItemId, "team");
});

function visibleItemIds(actor: NavActor, key: string, facts: NavFacts = withChecklists): string[] {
  const section = visibleNav(actor, facts).find((item) => item.key === key);
  return (section?.menu ?? []).flatMap((group) => group.items.map((item) => item.id));
}

test("«Сегодня»: у управляющей — журналы дня, у заведующей — панель контроля", () => {
  assert.deepEqual(visibleItemIds(manager, "journals"), ["points", "today", "all", "verify", "setup", "standard", "haccp", "extra"]);
  assert.deepEqual(visibleItemIds(headChef, "journals"), ["control", "verify", "setup", "standard", "haccp", "extra"]);
  const journals = visibleNav(headChef, withChecklists).find((item) => item.key === "journals");
  assert.equal(journals?.menu?.[0].items[0].href, "/control-board");
});

test("«Наборы журналов»: руководству и заведующей — три страницы, повару — нет", () => {
  const sets = (actor: NavActor) =>
    visibleNav(actor, withChecklists)
      .find((item) => item.key === "journals")
      ?.menu?.find((group) => group.label === "sets")
      ?.items.map((item) => item.href);
  const hrefs = ["/journals/sets/standard", "/journals/sets/haccp", "/journals/sets/extra"];
  assert.deepEqual(sets(owner), hrefs);
  assert.deepEqual(sets(headChef), hrefs);
  assert.equal(sets(cook), undefined);
  assert.equal(sets(verifyOnly), undefined);
  for (const href of hrefs) {
    assert.equal(navAllows(cook, href, { kind: "fullAccess" }, withChecklists), false, href);
  }
  // Страница набора — свой пункт; страницы журналов остаются у «Все журналы».
  assert.equal(sectionForPath("/journals/sets/haccp")?.menuItemId, "haccp");
  assert.equal(sectionForPath("/journals/sets/standard")?.section, "journals");
  assert.equal(sectionForPath("/journals/hygiene")?.menuItemId, "all");
});

test("заведующая: пунктов только для admin.full нет", () => {
  assert.deepEqual(visibleItemIds(headChef, "staff"), [
    "users",
    "positions",
    "commission",
    "haccpGroup",
    "controlGroup",
    "inspectors",
    "team",
    "schedule",
    "health",
    "visibility",
    "phone",
  ]);
  // «Права и доступ» — в «Офисе»; «Сотрудников офиса» (admin.full) у неё нет.
  assert.deepEqual(visibleItemIds(headChef, "office"), ["access"]);
  const access = visibleNav(headChef, withChecklists)
    .find((item) => item.key === "office")
    ?.menu?.[0].items.find((item) => item.id === "access");
  // Одна страница без вкладок — и для заведующей.
  assert.equal(access?.tabs, undefined);
  assert.equal(access?.href, "/settings/access");
  // «Пришла проверка»: заведующей — всё, кроме «Готовности» (admin.full).
  assert.deepEqual(visibleItemIds(headChef, "inspection"), ["laws", "norms", "portal", "experts", "now", "visits", "special"]);
  assert.deepEqual(visibleItemIds(headChef, "billing"), ["plan", "balance", "services"]);
});

test("руководитель видит все пункты меню каждого раздела", () => {
  const full: NavFacts = { checklists: true, settingsPermissions: true };
  for (const section of NAV_SECTIONS) {
    const all = (section.menu ?? []).flatMap((group) => [
      ...(group.sections ?? []),
      ...group.items.filter((item) => !item.hideIfVisible).map((item) => item.id),
    ]);
    assert.deepEqual(visibleItemIds(owner, section.key, full), all, section.key);
  }
});

test("новые страницы «Сотрудников»: только руководству, повару — ни пункта, ни страницы", () => {
  const pages = [
    "/settings/positions",
    "/settings/brakerage-commission",
    "/settings/haccp-group",
    "/settings/control-group",
    "/settings/inspectors",
  ];
  const staff = NAV_SECTIONS.find((section) => section.key === "staff");
  const items = (staff?.menu ?? []).flatMap((group) => group.items);
  for (const href of pages) {
    const item = items.find((entry) => entry.href === href);
    assert.ok(item, href);
    assert.deepEqual(item.access, { kind: "fullAccess" }, href);
    // Повара не пускают ни proxy.ts, ни правило пункта; заведующую — пускают.
    assert.equal(navAllows(cook, href, item.access, withChecklists), false, href);
    assert.equal(navAllows(headChef, href, item.access, withChecklists), true, href);
    // Guard страницы — явный hasFullWorkspaceAccess( и объяснённый отказ
    // внутри кабинета (`forbidden()`), а не падение и не тихий уход.
    const source = readFileSync(pageFileFor(href) ?? "", "utf8");
    assert.match(source, /if \(!hasFullWorkspaceAccess\(session\.user\)\) forbidden\(\);/, href);
  }
  assert.deepEqual(visibleItemIds(cook, "staff"), []);
  // Контроль-группа с линейной ролью новых страниц не видит (их режет proxy.ts).
  assert.deepEqual(
    visibleItemIds({ role: "cook", permissionPreset: "control_group" }, "staff", noChecklists),
    ["team"],
  );
});

test("«Моя компания»: реквизиты с вкладками, мастер-кабинет; оформление — в «Настройках»", () => {
  const items = (NAV_SECTIONS.find((section) => section.key === "company")?.menu ?? []).flatMap((group) => group.items);
  const requisites = items.find((item) => item.id === "organization");
  assert.deepEqual(requisites?.tabs?.map((tab) => tab.href), [
    "/settings/organization",
    "/settings/organization/documents",
    "/settings/organization/contacts",
  ]);
  for (const tab of requisites?.tabs ?? []) assert.deepEqual(tab.access, { kind: "anyOf", capabilities: ["admin.full"] }, tab.id);
  assert.equal(sectionForPath("/settings/organization")?.menuItemId, "organization");
  assert.equal(sectionForPath("/settings/organization/documents")?.menuItemId, "organization");
  assert.deepEqual(visibleItemIds(manager, "company"), ["office", "points", "master", "more", "organization"]);
  assert.deepEqual(visibleItemIds(manager, "settings"), ["appearance", "branding", "names", "onboarding", "template"]);
  // Заведующей «Моей компании» нет; в «Настройках» — только названия разделов.
  assert.deepEqual(visibleItemIds(headChef, "company"), []);
  assert.deepEqual(visibleItemIds(headChef, "settings"), ["names"]);
  assert.deepEqual(visibleItemIds(cook, "company"), []);
});

test("пресет заведующей у линейной роли: в «Сотрудниках» — только команда", () => {
  // `/settings/phone` линейной роли закрывает proxy.ts — пункта нет, как не было и карточки.
  assert.deepEqual(visibleItemIds(verifyOnly, "staff", noChecklists), ["team"]);
  // Пресет заведующей у линейной роли: без QR-выпуска, готовности и услуг (их guard — руководство).
  assert.deepEqual(visibleItemIds(verifyOnly, "inspection", noChecklists), ["norms", "now", "visits", "special"]);
});

test("«Пришла проверка»: блоки страницы — свои пункты меню, повару раздел закрыт", () => {
  for (const [path, id] of [
    ["/inspection/laws", "laws"],
    ["/inspection", "now"],
    ["/inspection/visits", "visits"],
    ["/inspection/norms", "norms"],
    ["/settings/inspector-portal", "portal"],
    ["/dashboard/compliance-audit", "readiness"],
    ["/inspection/experts", "experts"],
    ["/inspection/special-mode", "special"],
  ]) {
    const place = sectionForPath(path);
    assert.equal(place?.section, "inspection", path);
    assert.equal(place?.menuItemId, id, path);
  }
  // «Нормативка» раздела — не пункт ППК: левое меню не переключается.
  assert.notEqual(sectionForPath("/inspection/norms")?.section, "productionControl");
  assert.ok(!keys(cook, withChecklists).includes("inspection"));
  assert.ok(!keys(cleaner, withChecklists).includes("inspection"));
  // «Нормативные документы» раздела — своя страница: левое меню не переключается на ППК.
  assert.equal(sectionForPath("/inspection/laws")?.section, "inspection");
  // Руководитель видит все восемь пунктов.
  assert.deepEqual(visibleItemIds(owner, "inspection"), ["laws", "norms", "portal", "experts", "now", "visits", "readiness", "special"]);
});

test("статическая модель без динамических сегментов в адресах пунктов", () => {
  for (const section of NAV_SECTIONS) {
    for (const group of section.menu ?? []) {
      for (const item of group.items) assert.ok(!/[[\]]/.test(item.href), `${section.key}/${item.id}: ${item.href}`);
    }
  }
});

test("«Чек-листы»: «Назначение» — только руководителю, без доступа к чек-листам раздела нет", () => {
  assert.deepEqual(visibleItemIds(owner, "checklists"), ["templates", "builder", "assignments", "results"]);
  assert.deepEqual(visibleItemIds(manager, "checklists"), ["templates", "builder", "assignments", "results"]);
  // Заведующая и повар с доступом к чек-листам: шаблоны, конструктор, результаты.
  assert.deepEqual(visibleItemIds(headChef, "checklists"), ["templates", "builder", "results"]);
  assert.deepEqual(visibleItemIds(cook, "checklists"), ["templates", "builder", "results"]);
  const cookSection = visibleNav(cook, withChecklists).find((item) => item.key === "checklists");
  assert.equal(cookSection?.rootHref, "/checklists/templates");
  assert.ok(!keys(cook, noChecklists).includes("checklists"));
  assert.ok(!keys(headChef, noChecklists).includes("checklists"));
  const assignments = NAV_SECTIONS.find((item) => item.key === "checklists")
    ?.menu?.[0].items.find((item) => item.id === "assignments");
  assert.deepEqual(assignments?.access, { kind: "anyOf", capabilities: ["admin.full"] });
});

// ---- Руководитель точки (фаза 2 «Офис и точки», 2026-10-27) ---------------

test("руководитель точки: без «Моей компании», «Подписок» и общих справочников", () => {
  const pointManager: NavActor = { ...manager, pointScope: ["b-lenina"] };
  const sections = visibleNav(pointManager, withChecklists);
  const keys: string[] = sections.map((section) => section.key);
  for (const key of ["company", "office", "billing", "settings"]) assert.equal(keys.includes(key), false, key);
  assert.ok(keys.includes("journals") && keys.includes("staff") && keys.includes("points"));
  // «Торговые точки» — в главном меню, «Сотрудники» и «Журналы» — в их меню.
  assert.deepEqual(mainKeys(pointManager), ["points", "monitoring", "more", "inspection"]);
  const items = (key: string) =>
    (sections.find((section) => section.key === key)?.menu ?? []).flatMap((group) => group.items.map((item) => item.id));
  // Сотрудники своей точки — да; должности и права на всю компанию — нет.
  assert.ok(items("staff").includes("users"));
  assert.equal(items("staff").includes("positions"), false);
  // Справочник продуктов — на всю компанию.
  assert.equal(items("points").includes("products"), false);
  assert.ok(items("points").includes("staff") && items("points").includes("journals"));
  // Набор журналов точки остаётся.
  assert.ok(items("journals").includes("setup"));
  // Тот же руководитель без ограничения точками видит всё, как раньше.
  assert.ok(keys.length < visibleNav(manager, withChecklists).length);
});

test("«Журналы» в режиме точки: «Журналы точек» и «Все журналы» пропадают, вход — «Сегодня»", () => {
  const pointMode: NavFacts = { ...withChecklists, journalsPointMode: true };
  const menuOf = (actor: NavActor, facts: NavFacts) =>
    (visibleNav(actor, facts).find((section) => section.key === "journals")?.menu ?? []).flatMap((group) =>
      group.items.map((item) => item.id),
    );
  // Вся организация — полное меню; «Настройка» — в общем списке, под ним наборы.
  assert.deepEqual(menuOf(manager, withChecklists), ["points", "today", "all", "verify", "setup", "standard", "haccp", "extra"]);
  assert.deepEqual(menuOf(manager, pointMode), ["today", "verify", "setup", "standard", "haccp", "extra"]);
  const journals = visibleNav(manager, pointMode).find((section) => section.key === "journals");
  assert.equal(journals?.rootHref, "/dashboard");
  // Заведующая: панель контроля вместо «Сегодня», «Всех журналов» нет.
  assert.ok(!menuOf(headChef, pointMode).includes("all"));
  assert.ok(menuOf(headChef, pointMode).includes("control"));
});

test("«Нет доступа» на месте страницы: закрытые пункты меню — по роли, не по режиму точки", () => {
  // Руководству с правом на права закрытых пунктов нет; без права из БД —
  // закрыта только иерархия (её страница пускает по тому же праву).
  const allFacts: NavFacts = { checklists: true, settingsPermissions: true };
  assert.deepEqual(deniedNavHrefs(owner, allFacts), []);
  assert.deepEqual(deniedNavHrefs(root, allFacts), []);
  assert.deepEqual(deniedNavHrefs(owner, withChecklists), ["/settings/staff-hierarchy"]);
  // Повару закрыты разделы руководства, но не его баланс.
  const cookDenied = deniedNavHrefs(cook, noChecklists);
  for (const href of ["/production-control", "/settings/users", "/monitoring", "/inspection", "/verifications"]) {
    assert.ok(cookDenied.includes(href), href);
  }
  assert.ok(!cookDenied.includes("/settings/balance"));
  // Заведующей закрыто только то, что просит admin.full.
  const headChefDenied = deniedNavHrefs(headChef, withChecklists);
  assert.ok(headChefDenied.includes("/settings/organization"));
  assert.ok(headChefDenied.includes("/checklists/assignments"));
  assert.ok(!headChefDenied.includes("/settings/users"));
  assert.ok(!headChefDenied.includes("/production-control"));
  // Режим точки — не отказ: «Журналы точек» и «Все журналы» сами объясняют,
  // что нужна «Вся организация» (PointModeUnavailable).
  const pointMode: NavFacts = { ...allFacts, journalsPointMode: true };
  assert.deepEqual(deniedNavHrefs(manager, pointMode), []);
  // Страницы, открытые всем (руководству — с правкой), «Нет доступа» не получают.
  for (const href of OPEN_TO_ALL_NAV_HREFS) assert.ok(!cookDenied.includes(href), href);
  // Домашние по роли уводят повара на «Сегодня» приложения — не отказ: плашку
  // «раздел закрыт» покажет страница, куда уведут.
  for (const href of ROLE_HOME_NAV_HREFS) {
    assert.ok(!cookDenied.includes(href), href);
    assert.ok(!headChefDenied.includes(href), href);
  }
  assert.deepEqual(routedAwayNavHrefs(cook, noChecklists), ["/control-board", "/dashboard", "/journals", "/team"]);
  assert.deepEqual(routedAwayNavHrefs(headChef, withChecklists), ["/dashboard", "/journals"]);
  assert.deepEqual(routedAwayNavHrefs(owner, allFacts), []);
});

test("isNavHrefDenied: точный адрес пункта, хвостовой слэш не мешает, глубина — не отказ", () => {
  const denied = ["/production-control", "/settings/users"];
  assert.equal(isNavHrefDenied("/settings/users", denied), true);
  assert.equal(isNavHrefDenied("/settings/users/", denied), true);
  assert.equal(isNavHrefDenied("/settings/users?place=all", denied), true);
  // Подстраницы проверяют свои guard'ы на сервере.
  assert.equal(isNavHrefDenied("/settings/users/abc/access", denied), false);
  assert.equal(isNavHrefDenied("/journals", denied), false);
  assert.equal(isNavHrefDenied("/settings/users", undefined), false);
});

test("страница каждого пункта меню уходит сама — панель меню не спорит с сервером", () => {
  const entries: { href: string; access: NavAccess }[] = [];
  for (const section of NAV_SECTIONS) {
    for (const tab of section.tabs) entries.push(tab);
    for (const group of section.menu ?? []) {
      for (const item of group.items) entries.push(item, ...(item.tabs ?? []));
    }
  }
  entries.push(...SETTINGS_CARDS);
  const hardGuard = /forbidden\(\)|redirect\(|notFound\(\)/;
  for (const { href, access } of entries) {
    if (access.kind === "staffPath") continue;
    const source = readFileSync(pageFileFor(href) ?? "", "utf8");
    if (OPEN_TO_ALL_NAV_HREFS.includes(href)) {
      assert.ok(!hardGuard.test(source), `${href}: страница закрыта — уберите её из OPEN_TO_ALL_NAV_HREFS`);
    } else if (ROLE_HOME_NAV_HREFS.includes(href)) {
      // Домашняя по роли уводит к своей домашней, а не отказывает.
      assert.match(source, /redirect\(/, `${href}: домашняя по роли без редиректа`);
    } else {
      // Отказ — объяснённой панелью (`forbidden()`), иначе «Нет доступа» меню
      // и сервер разошлись бы.
      assert.match(source, /forbidden\(\)/, `${href}: без forbidden() — добавьте его или внесите в списки выше`);
    }
  }
});

test("у каждого раздела кабинета без своего динамического сегмента — ловушка неизвестных адресов", () => {
  for (const name of readdirSync(DASHBOARD_DIR)) {
    const dir = join(DASHBOARD_DIR, name);
    if (!statSync(dir).isDirectory()) continue;
    const children = readdirSync(dir);
    const dynamic = children.filter((child) => child.startsWith("[") && child !== MISSING_CATCH_ALL);
    if (dynamic.length > 0) continue;
    const trap = join(dir, MISSING_CATCH_ALL, "page.tsx");
    assert.ok(statSync(trap, { throwIfNoEntry: false })?.isFile(), `${name}: нет ${MISSING_CATCH_ALL}/page.tsx`);
    assert.match(readFileSync(trap, "utf8"), /notFound\(\)/, name);
  }
});
