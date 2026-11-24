import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { visibleNav, type NavActor, type NavFacts } from "./app-nav";
import type { NavModelSection } from "./app-nav.server";
import { buildNewNav, sectionEntryHref } from "./nav-layout";

const owner: NavActor = { role: "owner", permissionPreset: "admin" };
// Заведующая: «Моя компания» ей закрыта, «Объекты» стоят в главном меню.
const headChef: NavActor = { role: "head_chef", permissionPreset: "head_chef" };
const facts: NavFacts = { checklists: true, settingsPermissions: true };

/** Модель меню человека с подписями-ключами (перевод здесь не нужен). */
function model(actor: NavActor): NavModelSection[] {
  return visibleNav(actor, facts).map((section) => ({
    key: section.key,
    icon: section.icon,
    label: `s:${section.key}`,
    ...(section.parent ? { parent: section.parent } : {}),
    rootHref: section.rootHref,
    tabs: section.tabs.map((tab) => ({ id: tab.id, href: tab.href, label: tab.label })),
    ...(section.menu
      ? {
          menu: section.menu.map((group) => ({
            label: group.label,
            items: group.items.map((item) => ({
              id: item.id,
              icon: item.icon,
              href: item.href,
              label: item.section ? `s:${item.section}` : `i:${item.id}`,
              ...(item.section ? { section: item.section } : {}),
              ...(item.hasMenu ? { hasMenu: true } : {}),
              ...(item.tabs ? { tabs: item.tabs.map((tab) => ({ id: tab.id, href: tab.href, label: `t:${tab.id}` })) } : {}),
            })),
          })),
        }
      : {}),
  }));
}

const ownerNav = model(owner);
const labels = (place: ReturnType<typeof buildNewNav>) => place.trail.map((crumb) => crumb.label);

test("«Все журналы»: слева «Моя компания → Объекты», сверху пункты точек, «Журналы» раскрываются в подменю", () => {
  const place = buildNewNav(ownerNav, "/journals");
  assert.equal(place.top, "company");
  assert.equal(place.secondId, "points");
  assert.equal(place.entriesAreTabs, false);
  assert.deepEqual(
    place.entries.map((entry) => entry.id),
    ["points", "staff", "areas", "equipment", "journals", "productionControl", "qr", "products", "printer", "kiosk"],
  );
  const journals = place.entries.find((entry) => entry.id === "journals");
  assert.equal(journals?.active, true);
  assert.deepEqual(place.entries.filter((entry) => entry.active).map((entry) => entry.id), ["journals"]);
  const links = journals?.panel?.flatMap((group) => group.links) ?? [];
  assert.deepEqual(links.filter((link) => link.active).map((link) => link.id), ["all"]);
  assert.ok(links.some((link) => link.id === "standard"), "наборы журналов — в той же панели");
  assert.deepEqual(labels(place), ["s:company", "s:points", "s:journals", "i:all"]);
  assert.equal(place.deep, false);
});

test("глубокая страница журнала: цепочка та же, страница — глубже", () => {
  const place = buildNewNav(ownerNav, "/journals/hygiene/documents/abc");
  assert.deepEqual(labels(place), ["s:company", "s:points", "s:journals", "i:all"]);
  assert.equal(place.deep, true);
});

test("обычный пункт вложенного раздела: подсвечен в строке, подменю нет", () => {
  const place = buildNewNav(ownerNav, "/settings/equipment");
  assert.equal(place.secondId, "points");
  const equipment = place.entries.find((entry) => entry.id === "equipment");
  assert.equal(equipment?.active, true);
  assert.equal(equipment?.panel, undefined);
  assert.deepEqual(labels(place), ["s:company", "s:points", "i:equipment"]);
});

test("корень вложенного раздела: «Объекты» — первая вкладка строки и выбрана (владелец, 2026-11-23)", () => {
  const place = buildNewNav(ownerNav, "/settings/buildings");
  assert.equal(place.secondId, "points");
  const first = place.entries[0];
  assert.equal(first?.id, "points");
  assert.equal(first?.href, "/settings/buildings");
  assert.equal(first?.label, "s:points");
  assert.equal(first?.icon, ownerNav.find((section) => section.key === "points")?.icon);
  assert.equal(first?.panel, undefined);
  assert.deepEqual(place.entries.filter((entry) => entry.active).map((entry) => entry.id), ["points"]);
  assert.deepEqual(labels(place), ["s:company", "s:points"]);
  assert.equal(place.deep, false);
});

test("страницы раздела без своего пункта держат выбранными «Объекты»; пункт раздела — свою вкладку", () => {
  for (const path of ["/settings/buildings/new", "/settings/buildings/abc123"]) {
    const place = buildNewNav(ownerNav, path);
    assert.deepEqual(place.entries.filter((entry) => entry.active).map((entry) => entry.id), ["points"], path);
    assert.equal(place.deep, true, path);
  }
  for (const [path, id] of [["/settings/areas", "areas"], ["/journals", "journals"], ["/settings/users", "staff"]]) {
    const place = buildNewNav(ownerNav, path);
    assert.equal(place.entries[0]?.id, "points", path);
    assert.deepEqual(place.entries.filter((entry) => entry.active).map((entry) => entry.id), [id], path);
  }
});

test("раздел без своих пунктов («Остальное») — строки над страницей нет, одной вкладки тоже", () => {
  for (const path of ["/more", "/batches", "/losses", "/reports", "/settings/notifications"]) {
    const place = buildNewNav(ownerNav, path);
    assert.deepEqual(place.entries, [], path);
  }
});

test("корень раздела уже среди пунктов — лишней вкладки нет («Офис», «Чек-листы»)", () => {
  for (const path of ["/settings/organization/office", "/checklists/results"]) {
    const place = buildNewNav(ownerNav, path);
    const host = ownerNav.find((section) => section.key === place.secondId);
    const items = host?.menu?.flatMap((group) => group.items.map((item) => item.id)) ?? [];
    assert.ok(items.length > 0, path);
    assert.deepEqual(place.entries.map((entry) => entry.id), items, path);
  }
});

test("пункт второго уровня с вкладками: строка — его вкладки", () => {
  const place = buildNewNav(ownerNav, "/settings/organization/documents");
  assert.equal(place.top, "company");
  assert.equal(place.secondId, "organization");
  assert.equal(place.entriesAreTabs, true);
  assert.deepEqual(place.entries.map((entry) => entry.id), ["organization", "documents", "contacts"]);
  assert.deepEqual(place.entries.filter((entry) => entry.active).map((entry) => entry.id), ["documents"]);
  assert.deepEqual(labels(place), ["s:company", "i:organization", "t:documents"]);
});

test("пункт второго уровня без вкладок: строки над страницей нет", () => {
  const place = buildNewNav(ownerNav, "/monitoring");
  assert.equal(place.top, "monitoring");
  assert.equal(place.secondId, "overview");
  assert.deepEqual(place.entries, []);
  assert.deepEqual(labels(place), ["s:monitoring", "i:overview"]);
});

test("третий уровень вложенности: «Мониторинг → Чек-листы → Результаты»", () => {
  const place = buildNewNav(ownerNav, "/checklists/results");
  assert.equal(place.top, "monitoring");
  assert.equal(place.secondId, "checklists");
  assert.deepEqual(place.entries.filter((entry) => entry.active).map((entry) => entry.id), ["results"]);
  assert.deepEqual(labels(place), ["s:monitoring", "s:checklists", "i:results"]);
});

test("заведующая: «Объекты» — раздел главного меню, «Журналы» — второй уровень, их пункты — строка", () => {
  const place = buildNewNav(model(headChef), "/control-board");
  assert.equal(place.top, "points");
  assert.equal(place.secondId, "journals");
  assert.deepEqual(place.entries.filter((entry) => entry.active).map((entry) => entry.id), ["control"]);
  assert.deepEqual(labels(place), ["s:points", "s:journals", "i:control"]);
});

test("чужой адрес — пустое место", () => {
  const place = buildNewNav(ownerNav, "/no-such-page");
  assert.equal(place.top, null);
  assert.deepEqual(place.trail, []);
});

test("каждая ссылка строки и панели — адрес из модели меню человека", () => {
  const known = new Set<string>();
  for (const section of ownerNav) {
    known.add(section.rootHref);
    for (const group of section.menu ?? []) {
      for (const item of group.items) {
        known.add(item.href);
        for (const tab of item.tabs ?? []) known.add(tab.href);
      }
    }
  }
  for (const path of ["/journals", "/settings/organization", "/checklists/results", "/settings/users"]) {
    const place = buildNewNav(ownerNav, path);
    for (const entry of place.entries) {
      assert.ok(known.has(entry.href), `${path}: ${entry.href}`);
      for (const link of entry.panel?.flatMap((group) => group.links) ?? []) {
        assert.ok(known.has(link.href), `${path}: ${link.href}`);
        for (const tab of link.tabs) assert.ok(known.has(tab.href), `${path}: ${tab.href}`);
      }
    }
  }
});

test("«Моя компания» открывает первую строчку своего меню — «Офис»; остальные разделы — свой корень", () => {
  const company = {
    key: "company",
    rootHref: "/settings/organization",
    menu: [{ items: [{ href: "/settings/organization/office" }, { href: "/settings/buildings" }] }, { items: [{ href: "/more" }] }],
  };
  assert.equal(sectionEntryHref(company), "/settings/organization/office");
  assert.equal(sectionEntryHref({ ...company, menu: [] }), "/settings/organization");
  assert.equal(sectionEntryHref({ key: "billing", rootHref: "/settings/subscription", menu: [{ items: [{ href: "/settings/balance" }] }] }), "/settings/subscription");
});

test("строка и панель несут иконку пункта; у вкладок иконки нет", () => {
  const place = buildNewNav(ownerNav, "/journals");
  const itemsOf = (key: string) => ownerNav.find((section) => section.key === key)?.menu?.flatMap((group) => group.items) ?? [];
  // Строка — пункты «Объектов»: иконка та же, что у пункта в модели меню; первая
  // вкладка — сам раздел, с иконкой раздела.
  for (const entry of place.entries) {
    const icon =
      entry.id === "points"
        ? ownerNav.find((section) => section.key === "points")?.icon
        : itemsOf("points").find((item) => item.id === entry.id)?.icon;
    assert.ok(icon, `строка: ${entry.id}`);
    assert.equal(entry.icon, icon, `строка: ${entry.id}`);
    for (const link of entry.panel?.flatMap((group) => group.links) ?? []) {
      for (const tab of link.tabs) assert.equal(tab.icon, undefined, `вкладка: ${tab.id}`);
    }
  }
  // Панель «Журналов» — пункты раздела «Журналы», каждый со своей иконкой.
  const journals = place.entries.find((entry) => entry.id === "journals");
  const links = journals?.panel?.flatMap((group) => group.links) ?? [];
  assert.ok(links.length > 0);
  for (const link of links) {
    assert.equal(link.icon, itemsOf("journals").find((item) => item.id === link.id)?.icon, `панель: ${link.id}`);
    assert.ok(link.icon, `панель: ${link.id} — без иконки`);
  }
  // Строка-вкладки обычного пункта — без иконок.
  const tabs = buildNewNav(ownerNav, "/settings/organization");
  assert.equal(tabs.entriesAreTabs, true);
  assert.ok(tabs.entries.every((entry) => entry.icon === undefined));
});

test("короткое название пункта доходит до строки, полное остаётся подписью", () => {
  const withShort = ownerNav.map((section) =>
    section.key === "points" && section.menu
      ? {
          ...section,
          menu: section.menu.map((group) => ({
            ...group,
            items: group.items.map((item) => (item.id === "productionControl" ? { ...item, shortLabel: "ППК" } : item)),
          })),
        }
      : section,
  );
  const entry = buildNewNav(withShort, "/journals").entries.find((item) => item.id === "productionControl");
  assert.equal(entry?.short, "ППК");
  assert.equal(entry?.label, "s:productionControl");
  assert.equal(buildNewNav(ownerNav, "/journals").entries.find((item) => item.id === "productionControl")?.short, undefined);
});

test("короткие названия строки: на трёх языках, только у существующих пунктов и короче полного", () => {
  type Menus = Record<string, { items?: Record<string, string>; short?: Record<string, string> }>;
  const menusOf = (locale: string) =>
    (
      JSON.parse(readFileSync(new URL(`../i18n/messages/${locale}.json`, import.meta.url), "utf8")) as {
        navigation: { shell: { menus: Menus } };
      }
    ).navigation.shell.menus;
  const ru = menusOf("ru");
  const shortIds = (menus: Menus) =>
    Object.entries(menus).flatMap(([section, menu]) => Object.keys(menu.short ?? {}).map((id) => `${section}.${id}`)).sort();
  assert.ok(shortIds(ru).includes("points.staff"));
  // Владелец, 2026-11-23: в строке «Объектов» — полные названия ППК, принтера,
  // планшета и справочника; коротко остаются только «Сотрудники» и «QR-плакаты».
  assert.deepEqual(shortIds(ru).filter((id) => id.startsWith("points.")), ["points.qr", "points.staff"]);
  for (const locale of ["ru", "en", "uz"]) {
    const menus = menusOf(locale);
    assert.deepEqual(shortIds(menus), shortIds(ru), locale);
    for (const [section, menu] of Object.entries(menus)) {
      for (const [id, short] of Object.entries(menu.short ?? {})) {
        const full = menu.items?.[id];
        assert.ok(full, `${locale}: ${section}.${id} — нет такого пункта`);
        assert.ok(short.length < full.length, `${locale}: ${section}.${id} — «${short}» не короче «${full}»`);
      }
    }
  }
});
