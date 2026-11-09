import test from "node:test";
import assert from "node:assert/strict";

import { visibleNav, type NavActor, type NavFacts } from "./app-nav";
import type { NavModelSection } from "./app-nav.server";
import { buildNewNav } from "./nav-layout";

const owner: NavActor = { role: "owner", permissionPreset: "admin" };
// Заведующая: «Моя компания» ей закрыта, «Торговые точки» стоят в главном меню.
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

test("«Все журналы»: слева «Моя компания → Торговые точки», сверху пункты точек, «Журналы» раскрываются в подменю", () => {
  const place = buildNewNav(ownerNav, "/journals");
  assert.equal(place.top, "company");
  assert.equal(place.secondId, "points");
  assert.equal(place.entriesAreTabs, false);
  assert.deepEqual(
    place.entries.map((entry) => entry.id),
    ["staff", "journals", "productionControl", "areas", "equipment", "qr", "printer", "kiosk", "products"],
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

test("корень вложенного раздела: строка есть, ни один пункт не выбран", () => {
  const place = buildNewNav(ownerNav, "/settings/buildings");
  assert.equal(place.secondId, "points");
  assert.ok(place.entries.length > 0);
  assert.equal(place.entries.some((entry) => entry.active), false);
  assert.deepEqual(labels(place), ["s:company", "s:points"]);
  assert.equal(place.deep, false);
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

test("заведующая: «Торговые точки» — раздел главного меню, «Журналы» — второй уровень, их пункты — строка", () => {
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
