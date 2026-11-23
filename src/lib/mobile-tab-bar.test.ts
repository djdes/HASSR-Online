import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { visibleNav, type NavActor, type NavFacts } from "./app-nav";
import { getWebHomeHref } from "./role-access";
import { activeMobileTab, journalsTabHref, mobileTabs } from "./mobile-tab-bar";

const facts: NavFacts = { checklists: true, settingsPermissions: true };
const owner: NavActor = { role: "owner", permissionPreset: "admin" };
const cook: NavActor = { role: "cook", permissionPreset: "cook" };

const ids = (tabs: ReturnType<typeof mobileTabs>) => tabs.map((tab) => tab.id);

test("руководитель: «Домой» — главная, «Журналы» — все журналы, затем «Контакты» и «Настройки»", () => {
  const sections = visibleNav(owner, facts);
  const journalsHref = journalsTabHref(sections);
  assert.equal(journalsHref, "/journals");
  const tabs = mobileTabs({ homeHref: getWebHomeHref(owner), journalsHref });
  assert.deepEqual(ids(tabs), ["home", "journals", "contacts", "settings"]);
  assert.deepEqual(tabs[0], { id: "home", kind: "link", href: "/home" });
});

test("выбранная вкладка: главная, журналы (и «Сегодня» раздела журналов), остальное — «Настройки»", () => {
  const tabs = mobileTabs({ homeHref: "/home", journalsHref: "/journals" });
  assert.equal(activeMobileTab(tabs, "/home"), "home");
  assert.equal(activeMobileTab(tabs, "/home/"), "home");
  assert.equal(activeMobileTab(tabs, "/journals"), "journals");
  assert.equal(activeMobileTab(tabs, "/journals/hygiene/documents/abc"), "journals");
  assert.equal(activeMobileTab(tabs, "/dashboard"), "journals");
  assert.equal(activeMobileTab(tabs, "/settings/buildings"), "settings");
  assert.equal(activeMobileTab(tabs, "/settings/users?place=all"), "settings");
  assert.equal(activeMobileTab(tabs, "/monitoring"), "settings");
});

test("в режиме объекта «Все журналы» закрыты — «Журналы» ведут в корень раздела", () => {
  const sections = visibleNav(owner, { ...facts, journalsPointMode: true });
  const journals = sections.find((section) => section.key === "journals");
  assert.ok(journals);
  assert.equal(journalsTabHref(sections), journals.rootHref);
  assert.notEqual(journalsTabHref(sections), "/journals");
});

test("журналы и есть домашняя — вкладки «Журналы» нет, журналы подсвечивают «Домой»", () => {
  const tabs = mobileTabs({ homeHref: "/journals", journalsHref: "/journals" });
  assert.deepEqual(ids(tabs), ["home", "contacts", "settings"]);
  assert.equal(activeMobileTab(tabs, "/journals/hygiene"), "home");
  assert.equal(getWebHomeHref(cook), "/journals");
});

test("раздела журналов нет — «Журналов» в меню нет", () => {
  assert.equal(journalsTabHref([]), null);
  assert.deepEqual(ids(mobileTabs({ homeHref: "/home", journalsHref: null })), ["home", "contacts", "settings"]);
});

test("подписи нижнего меню — на трёх языках", () => {
  for (const locale of ["ru", "en", "uz"]) {
    const messages = JSON.parse(readFileSync(`src/i18n/messages/${locale}.json`, "utf8"));
    const tabBar = messages.navigation.shell.tabBar;
    for (const key of ["aria", "home", "journals", "contacts", "contactsUnread", "settings"]) {
      assert.equal(typeof tabBar[key], "string", `${locale}: ${key}`);
      assert.ok(tabBar[key].length > 0, `${locale}: ${key}`);
    }
  }
});
