"""Переписывает app-nav.test.ts под дерево разделов (однократный скрипт)."""
import sys

path = sys.argv[1]
s = open(path, encoding="utf-8").read()


def rep(old, new, count=1):
    global s
    assert s.count(old) == count, (old[:90], s.count(old))
    s = s.replace(old, new)


def cut(start_marker, end_marker, new):
    """Заменить текст от start_marker (включительно) до end_marker (не включая)."""
    global s
    start = s.index(start_marker)
    end = s.index(end_marker, start)
    s = s[:start] + new + s[end:]


rep('''import {
  NAV_MENU_SOURCES,
  NAV_SECTIONS,
  activeMenuItemId,
  navAllows,
  sectionForPath,
  sourceMenuItems,
  visibleNav,
  visibleSettingsCards,
  type NavAccess,
  type NavActor,
  type NavFacts,
  type NavMenuData,
} from "./app-nav";
import { allowedBuildingsForUser } from "./building-scope";
''', '''import {
  NAV_SECTIONS,
  mainNavSections,
  navAllows,
  sectionForPath,
  visibleNav,
  visibleSettingsCards,
  type NavAccess,
  type NavActor,
  type NavFacts,
} from "./app-nav";
''')

rep('''test("девять разделов в порядке схемы владельца", () => {
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
});''', '''const ALL_KEYS = [
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
});''')

rep('''  walk(DASHBOARD_DIR);
  return result;
}''', '''  walk(DASHBOARD_DIR);
  return result;
}

/** Страницы кабинета вне разделов: главная — корень главного меню. */
const OUTSIDE_SECTIONS = new Set(["/home"]);''')

rep('''    .map(({ route }) => route)
    .filter((route) => sectionForPath(route) === null);''', '''    .map(({ route }) => route)
    .filter((route) => !OUTSIDE_SECTIONS.has(route) && sectionForPath(route) === null);''')

rep('''test("владелец, управляющая и ROOT видят все девять разделов", () => {
  const all = NAV_SECTIONS.map((section) => section.key);''', '''test("владелец, управляющая и ROOT видят все разделы", () => {
  const all = NAV_SECTIONS.map((section) => section.key);''')

rep('''test("заведующая видит восемь разделов — без «Моей компании»", () => {
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
});''', '''test("заведующая видит всё, кроме «Моей компании»", () => {
  assert.deepEqual(
    keys(headChef, withChecklists),
    ALL_KEYS.filter((key) => key !== "company"),
  );
});''')

rep('''    ["/dashboard", "/journals", "/verifications", "/settings/sections/journals"],
  );
});''', '''    ["/journals/points", "/dashboard", "/journals", "/verifications", "/settings/sections/journals"],
  );
  // Корень «Журналов» руководителя — журналы всех точек (эскиз: список точек с журналами).
  assert.equal(journals.rootHref, "/journals/points");
});''')
rep('''test("у управляющей «Журналы» начинаются с «Сегодня», панели контроля во вкладках нет", () => {
  const journals = visibleNav(manager, withChecklists).find((s) => s.key === "journals");
  assert.ok(journals);
  assert.equal(journals.rootHref, "/dashboard");''', '''test("у управляющей «Журналы» начинаются с журналов точек, панели контроля во вкладках нет", () => {
  const journals = visibleNav(manager, withChecklists).find((s) => s.key === "journals");
  assert.ok(journals);''')

rep('''test("«Шаблон заведения» — вкладка и пункт меню раздела «Моя компания»", () => {
  const company = NAV_SECTIONS.find((section) => section.key === "company");
  assert.ok(company?.tabs.some((tab) => tab.href === "/settings/onboarding-template"));
  assert.ok(company?.menu?.some((group) => group.items.some((item) => item.href === "/settings/onboarding-template")));
});''', '''test("«Шаблон заведения» — пункт меню «Настроек и оформления»", () => {
  const settings = NAV_SECTIONS.find((section) => section.key === "settings");
  assert.ok(settings?.menu?.some((group) => group.items.some((item) => item.href === "/settings/onboarding-template")));
  assert.equal(sectionForPath("/settings/onboarding-template")?.section, "settings");
});''')

rep('''    ...NAV_SECTIONS.map((section) => section.icon),
    ...Object.values(NAV_MENU_SOURCES).map((source) => source.icon),
''', '''    ...NAV_SECTIONS.map((section) => section.icon),
''')

cut('''test("у каждого раздела, кроме «Остального», своё меню''', '''test("id пунктов и вкладок меню в разделе не повторяются"''', '''test("у каждого раздела, кроме «Остального», своё меню — пункты по эскизам руководителя", () => {
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
  assert.deepEqual(menuShape("journals"), [
    [null, ["points", "today", "control", "all"]],
    ["sets", ["standard", "haccp", "extra"]],
    ["more", ["verify", "setup"]],
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

''')

rep('''/** Пункты меню раздела: пары «подпись группы — id пунктов». */
function menuShape(key: string): [string | null, string[]][] {
  const section = NAV_SECTIONS.find((item) => item.key === key);
  return (section?.menu ?? []).map((group) => [group.label, group.items.map((item) => item.id)]);
}''', '''/** Пункты меню раздела: пары «подпись группы — id пунктов» (вложенные разделы — первыми). */
function menuShape(key: string): [string | null, string[]][] {
  const section = NAV_SECTIONS.find((item) => item.key === key);
  return (section?.menu ?? []).map((group) => [
    group.label,
    [...(group.sections ?? []), ...group.items.map((item) => item.id)],
  ]);
}''')

rep('''    const items = (section.menu ?? []).flatMap((group) => group.items);
    const ids = items.map((item) => item.id);
    assert.equal(new Set(ids).size, ids.length, section.key);''', '''    const items = (section.menu ?? []).flatMap((group) => group.items);
    const ids = [...(section.menu ?? []).flatMap((group) => group.sections ?? []), ...items.map((item) => item.id)];
    assert.equal(new Set(ids).size, ids.length, section.key);''')

rep('''test("каждая вкладка раздела с меню — пункт или вкладка пункта его меню", () => {
  for (const section of NAV_SECTIONS) {
    if (!section.menu) continue;
    const hrefs = new Set(
      section.menu.flatMap((group) =>
        group.items.flatMap((item) => [item.href, ...(item.tabs ?? []).map((tab) => tab.href)]),
      ),
    );
    for (const tab of section.tabs) assert.ok(hrefs.has(tab.href), `${section.key}: ${tab.href}`);
  }
});''', '''test("каждая вкладка раздела с меню — пункт, вкладка пункта или корень раздела", () => {
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
});''')

rep('''    assert.equal(place?.section, "staff", editor);
    assert.equal(place?.menuItemId, "access", editor);''', '''    assert.equal(place?.section, "office", editor);
    assert.equal(place?.menuItemId, "access", editor);''')
rep('''  assert.equal(sectionForPath("/settings/sections/points")?.section, "points");''', '''  assert.equal(sectionForPath("/settings/sections/points")?.section, "points");
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
  assert.equal(sectionForPath("/home"), null);''')

rep('''  assert.deepEqual(visibleItemIds(manager, "journals"), ["today", "all", "standard", "haccp", "extra", "verify", "setup"]);''',
    '''  assert.deepEqual(visibleItemIds(manager, "journals"), ["points", "today", "all", "standard", "haccp", "extra", "verify", "setup"]);''')

rep('''  assert.deepEqual(visibleItemIds(headChef, "staff"), [
    "positions",
    "users",
    "access",
    "commission",''', '''  assert.deepEqual(visibleItemIds(headChef, "staff"), [
    "users",
    "positions",
    "commission",''')
rep('''  const access = visibleNav(headChef, withChecklists)
    .find((item) => item.key === "staff")
    ?.menu?.[0].items.find((item) => item.id === "access");''', '''  // «Права и доступ» — в «Офисе»; «Сотрудников офиса» (admin.full) у неё нет.
  assert.deepEqual(visibleItemIds(headChef, "office"), ["access"]);
  const access = visibleNav(headChef, withChecklists)
    .find((item) => item.key === "office")
    ?.menu?.[0].items.find((item) => item.id === "access");''')
rep('''  assert.deepEqual(visibleItemIds(headChef, "inspection"), ["now", "visits", "norms", "portal", "experts", "special"]);''',
    '''  assert.deepEqual(visibleItemIds(headChef, "inspection"), ["laws", "norms", "portal", "experts", "now", "visits", "special"]);''')

rep('''    const all = (section.menu ?? []).flatMap((group) =>
      group.items.filter((item) => !item.hideIfVisible).map((item) => item.id),
    );''', '''    const all = (section.menu ?? []).flatMap((group) => [
      ...(group.sections ?? []),
      ...group.items.filter((item) => !item.hideIfVisible).map((item) => item.id),
    ]);''')

rep('''  const pages = [
    "/settings/positions",
    "/settings/access",
    "/settings/brakerage-commission",''', '''  const pages = [
    "/settings/positions",
    "/settings/brakerage-commission",''')

cut('''test("«Моя компания»: сведения для документов''', '''test("пресет заведующей у линейной роли''', '''test("«Моя компания»: реквизиты с вкладками, мастер-кабинет; оформление — в «Настройках»", () => {
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

''')

rep('''  assert.deepEqual(visibleItemIds(verifyOnly, "inspection", noChecklists), ["now", "visits", "norms", "special"]);''',
    '''  assert.deepEqual(visibleItemIds(verifyOnly, "inspection", noChecklists), ["norms", "now", "visits", "special"]);''')

rep('''  for (const [path, id] of [
    ["/inspection", "now"],''', '''  for (const [path, id] of [
    ["/inspection/laws", "laws"],
    ["/inspection", "now"],''')
rep('''  // Руководитель видит все семь пунктов.
  assert.deepEqual(visibleItemIds(owner, "inspection"), ["now", "visits", "norms", "portal", "readiness", "experts", "special"]);''',
    '''  // «Нормативные документы» раздела — своя страница: левое меню не переключается на ППК.
  assert.equal(sectionForPath("/inspection/laws")?.section, "inspection");
  // Руководитель видит все восемь пунктов.
  assert.deepEqual(visibleItemIds(owner, "inspection"), ["laws", "norms", "portal", "experts", "now", "visits", "readiness", "special"]);''')

cut('''// ---- «Торговые точки»: пункты из данных (точки)''', '''test("«Чек-листы»: «Назначение»''', '''test("статическая модель без динамических сегментов в адресах пунктов", () => {
  for (const section of NAV_SECTIONS) {
    for (const group of section.menu ?? []) {
      for (const item of group.items) assert.ok(!/[[\\]]/.test(item.href), `${section.key}/${item.id}: ${item.href}`);
    }
  }
});

''')

s += 'ZZZ_END'
cut('''test("руководитель точки: без «Моей компании»''', '''ZZZ_END''', '''test("руководитель точки: без «Моей компании», «Подписок» и общих справочников", () => {
  const pointManager: NavActor = { ...manager, pointScope: ["b-lenina"] };
  const sections = visibleNav(pointManager, withChecklists);
  const keys = sections.map((section) => section.key);
  for (const key of ["company", "office", "billing", "settings"]) assert.equal(keys.includes(key), false, key);
  assert.ok(keys.includes("journals") && keys.includes("staff") && keys.includes("points"));
  // «Торговые точки» — в главном меню, «Сотрудники» и «Журналы» — в их меню.
  assert.deepEqual(mainKeys(pointManager), ["points", "monitoring", "inspection"]);
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
''')

open(path, "w", encoding="utf-8", newline="\n").write(s)
print("ok")
