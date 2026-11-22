import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  BUILDING_ICON_KEYS,
  BUILDING_ICON_LIBRARY,
  buildingIconUrl,
  buildingIconUrlBelongsTo,
  isBuildingIconKey,
  parseBuildingIcon,
} from "./building-icons";
import { BUILDING_ICON_COMPONENTS, BuildingIcon } from "@/components/layout/building-icon";
import { headerPointOption } from "./header-point";

/* Значок объекта (владелец, 2026-11-22): типовой из библиотеки или свой файл. */

test("library: at least 12 unique typical icons, each drawn and named in ru/en/uz", () => {
  assert.ok(BUILDING_ICON_LIBRARY.length >= 12);
  assert.equal(new Set(BUILDING_ICON_KEYS).size, BUILDING_ICON_KEYS.length);
  assert.deepEqual(Object.keys(BUILDING_ICON_COMPONENTS).sort(), [...BUILDING_ICON_KEYS].sort());
  for (const locale of ["ru", "en", "uz"]) {
    const messages = JSON.parse(readFileSync(`src/i18n/messages/${locale}.json`, "utf8"));
    const labels = messages.settingsManagement.points.icon.library as Record<string, string>;
    for (const key of BUILDING_ICON_KEYS) assert.ok(labels[key]?.trim(), `${locale}: ${key}`);
  }
});

test("parse: library key, own file URL, anything else is «по виду»", () => {
  assert.deepEqual(parseBuildingIcon("school"), { kind: "library", key: "school" });
  const url = buildingIconUrl("org-a", "b-1", 3);
  assert.equal(url, "/api/org-assets/org-a/building-icon/b-1?v=3");
  assert.deepEqual(parseBuildingIcon(url), { kind: "upload", url });
  for (const value of [null, undefined, "", "rocket", "https://evil.example/x.png", "/api/org-assets/org-a/logo?v=1", "javascript:alert(1)"]) {
    assert.equal(parseBuildingIcon(value), null, String(value));
  }
  assert.equal(isBuildingIconKey("office"), true);
  assert.equal(isBuildingIconKey("__proto__"), false);
});

test("own file URL belongs only to its organization and building", () => {
  const url = buildingIconUrl("org-a", "b-1", 1);
  assert.equal(buildingIconUrlBelongsTo(url, "org-a", "b-1"), true);
  assert.equal(buildingIconUrlBelongsTo(url, "org-b", "b-1"), false);
  assert.equal(buildingIconUrlBelongsTo(url, "org-a", "b-2"), false);
});

test("BuildingIcon draws the library icon, the own picture or the default by kind", () => {
  assert.match(renderToStaticMarkup(createElement(BuildingIcon, { icon: "school", className: "size-4" })), /data-building-icon="school"/);
  assert.match(renderToStaticMarkup(createElement(BuildingIcon, { icon: null })), /data-building-icon="default"/);
  assert.match(renderToStaticMarkup(createElement(BuildingIcon, { icon: null, office: true })), /data-building-icon="office-default"/);
  const own = renderToStaticMarkup(createElement(BuildingIcon, { icon: buildingIconUrl("o", "b", 2), className: "size-4", uploadClassName: "size-7" }));
  assert.match(own, /<img[^>]*src="\/api\/org-assets\/o\/building-icon\/b\?v=2"/);
  assert.match(own, /alt=""/);
  assert.match(own, /size-7/);
  // Чужой адрес картинкой не становится.
  assert.doesNotMatch(renderToStaticMarkup(createElement(BuildingIcon, { icon: "https://evil.example/x.png" })), /<img/);
});

test("header option carries the chosen icon only when it is set", () => {
  assert.equal("icon" in headerPointOption({ id: "b", name: "Кафе", address: null }, "ООО Ромашка"), false);
  assert.equal(headerPointOption({ id: "b", name: "Кафе", address: null, icon: "coffee" }, "ООО Ромашка").icon, "coffee");
});
