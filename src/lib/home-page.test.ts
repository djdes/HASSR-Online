import test from "node:test";
import assert from "node:assert/strict";

import type { NavModelSection } from "./app-nav.server";
import {
  HOME_FAVORITES_MAX,
  canSeeHomePage,
  favoriteCandidates,
  homeContacts,
  homeFavoriteSlots,
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
          { id: "points", icon: "Store", href: "/settings/buildings", label: "Объекты", section: "points", hasMenu: true },
          { id: "organization", icon: "Building2", href: "/settings/organization", label: "Реквизиты" },
        ],
      },
    ],
  },
  { key: "more", icon: "LayoutGrid", label: "Остальное", parent: "company", rootHref: "/more", tabs: [] },
  {
    key: "points",
    icon: "Store",
    label: "Объекты",
    parent: "company",
    rootHref: "/settings/buildings",
    tabs: [],
    menu: [{ label: null, items: [{ id: "areas", icon: "DoorOpen", href: "/settings/areas", label: "Цеха" }] }],
  },
];

test("избранное: любой пункт меню — пункты, вложенные разделы, корни разделов; адрес один раз", () => {
  const candidates = favoriteCandidates(sections);
  assert.deepEqual(
    candidates.map((candidate) => candidate.href),
    ["/settings/buildings", "/settings/organization", "/more", "/settings/areas"],
  );
  // Вложенный раздел подписан своим названием, а не названием родителя.
  assert.equal(candidates[0].label, "Объекты");
  assert.equal(candidates[0].sectionLabel, "Моя компания");
});

test("избранное: вкладки пункта — тоже, подписаны вкладкой", () => {
  const withTabs: NavModelSection[] = [
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
            {
              id: "organization",
              icon: "Building2",
              href: "/settings/organization",
              label: "Реквизиты",
              tabs: [
                { id: "organization", href: "/settings/organization", label: "Реквизиты" },
                { id: "documents", href: "/settings/organization/documents", label: "Сведения для документов" },
              ],
            },
          ],
        },
      ],
    },
  ];
  const candidates = favoriteCandidates(withTabs);
  assert.deepEqual(candidates.map((candidate) => candidate.href), ["/settings/organization", "/settings/organization/documents"]);
  assert.equal(candidates[1].label, "Сведения для документов");
  assert.equal(candidates[1].sectionLabel, "Реквизиты");
  assert.equal(candidates[1].icon, "Building2");
});

test("избранное: только разрешённые адреса, без повторов, не больше семи", () => {
  assert.equal(HOME_FAVORITES_MAX, 7);
  const allowed = new Set(["/a", "/b", "/c", "/d", "/e", "/f", "/g", "/h"]);
  assert.deepEqual(normalizeFavorites(["/a", "/x", "/a", 5, "/b"], allowed), ["/a", "/b"]);
  assert.equal(normalizeFavorites(["/a", "/b", "/c", "/d", "/e", "/f", "/g", "/h"], allowed).length, HOME_FAVORITES_MAX);
  assert.deepEqual(normalizeFavorites("garbage", allowed), []);
  assert.deepEqual(normalizeFavorites(["https://evil.example/"], allowed), []);
});

test("слоты «Избранного» на главной: не меньше трёх, один пустой «Добавить», не больше семи", () => {
  assert.equal(homeFavoriteSlots(0), 3);
  assert.equal(homeFavoriteSlots(2), 3);
  assert.equal(homeFavoriteSlots(3), 4);
  assert.equal(homeFavoriteSlots(6), 7);
  assert.equal(homeFavoriteSlots(7), 7);
  assert.equal(homeFavoriteSlots(9), 7);
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
