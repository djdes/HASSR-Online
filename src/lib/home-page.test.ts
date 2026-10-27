import test from "node:test";
import assert from "node:assert/strict";

import type { NavModelSection } from "./app-nav.server";
import {
  HOME_FAVORITES_MAX,
  canSeeHomePage,
  favoriteCandidates,
  homeContacts,
  normalizeFavorites,
} from "./home-page";

test("главная — владельцу, управляющей и ROOT; заведующей и повару — нет", () => {
  assert.equal(canSeeHomePage({ role: "owner", permissionPreset: "admin" }), true);
  assert.equal(canSeeHomePage({ role: "manager", permissionPreset: "admin" }), true);
  assert.equal(canSeeHomePage({ isRoot: true }), true);
  assert.equal(canSeeHomePage({ role: "head_chef", permissionPreset: "head_chef" }), false);
  assert.equal(canSeeHomePage({ role: "cook", permissionPreset: "cook" }), false);
});

const sections: NavModelSection[] = [
  {
    key: "company",
    icon: "Building2",
    label: "Моя компания",
    rootHref: "/settings/organization",
    tabs: [],
    menu: [
      {
        label: null,
        items: [
          { id: "points", icon: "Store", href: "/settings/buildings", label: "Торговые точки", section: "points", hasMenu: true },
          { id: "organization", icon: "Building2", href: "/settings/organization", label: "Реквизиты" },
        ],
      },
    ],
  },
  { key: "more", icon: "LayoutGrid", label: "Остальное", parent: "company", rootHref: "/more", tabs: [] },
  {
    key: "points",
    icon: "Store",
    label: "Торговые точки",
    parent: "company",
    rootHref: "/settings/buildings",
    tabs: [],
    menu: [{ label: null, items: [{ id: "areas", icon: "DoorOpen", href: "/settings/areas", label: "Цеха" }] }],
  },
];

test("избранное: пункты меню и корни разделов без меню, без пунктов-разделов", () => {
  assert.deepEqual(
    favoriteCandidates(sections).map((candidate) => candidate.href),
    ["/settings/organization", "/more", "/settings/areas"],
  );
});

test("избранное: только разрешённые адреса, без повторов, не больше трёх", () => {
  const allowed = new Set(["/a", "/b", "/c", "/d"]);
  assert.deepEqual(normalizeFavorites(["/a", "/x", "/a", 5, "/b"], allowed), ["/a", "/b"]);
  assert.equal(normalizeFavorites(["/a", "/b", "/c", "/d"], allowed).length, HOME_FAVORITES_MAX);
  assert.deepEqual(normalizeFavorites("garbage", allowed), []);
  assert.deepEqual(normalizeFavorites(["https://evil.example/"], allowed), []);
});

test("контакты: Telegram из окружения, без него — страницы кабинета", () => {
  const none = homeContacts({});
  assert.deepEqual(
    none.map((row) => [row.id, row.href, row.external]),
    [
      ["support", "/home?support=chat", false],
      ["sales", "/settings/subscription", false],
      ["consulting", "/inspection/experts", false],
    ],
  );
  const set = homeContacts({ WESETUP_TG_SUPPORT_URL: "https://t.me/wesetup_support", WESETUP_TG_SALES_URL: "javascript:alert(1)" });
  assert.deepEqual(set[0], { id: "support", href: "https://t.me/wesetup_support", external: true });
  // Не t.me — не ссылка наружу.
  assert.equal(set[1].external, false);
});
