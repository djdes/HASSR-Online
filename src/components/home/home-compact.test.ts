/* eslint-disable react/no-children-prop -- Explicit children for SSR tests. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { HomeContactsSpoiler } from "./home-contacts-spoiler";

/*
 * Главная на телефоне (владелец, 2026-11-21): «Начальная настройка» —
 * иконка и текст в строку, «Избранное» — три плитки в ряд, знак ниже,
 * «Мы на связи» — под спойлером. С 768px — прежняя раскладка.
 */

const read = (file: string) => readFileSync(file, "utf8");
const PAGE = read("src/app/(dashboard)/home/page.tsx");
const FAVORITES = read("src/components/home/home-favorites.tsx");

test("«Мы на связи» на телефоне свёрнуто: строка-кнопка, панель скрыта; с 768px — всегда открыто", () => {
  const html = renderToStaticMarkup(
    createElement(HomeContactsSpoiler, { title: "Мы на связи", children: createElement("p", { id: "inside" }, "каналы") }),
  );
  assert.match(html, /<aside[^>]*data-home-contacts/);
  assert.match(html, /<button[^>]*aria-expanded="false"[^>]*data-home-contacts-toggle/);
  assert.match(html, /<button[^>]*class="[^"]*\bmd:hidden\b[^"]*"[^>]*data-home-contacts-toggle/);
  const panel = html.match(/<div id="([^"]+)" class="([^"]*)" data-home-contacts-panel/);
  assert.ok(panel, html);
  assert.match(panel[2], /(^|\s)hidden(\s|$)/);
  assert.match(panel[2], /md:block/);
  assert.match(html, new RegExp(`aria-controls="${panel[1]}"`));
  assert.match(html, /<p id="inside">каналы<\/p>/);
  // Заголовок для планшета и компьютера — как раньше.
  assert.match(html, /hidden[^"]*md:block[^"]*">Мы на связи<\/div>/);
});

test("главная: контакты — в спойлере, панель та же", () => {
  assert.match(PAGE, /<HomeContactsSpoiler title=\{t\("contactsTitle"\)\}>/);
  assert.match(PAGE, /<ContactUsPanel\s+compact\s+defaultGroup="support"/);
  assert.doesNotMatch(PAGE, /<aside/);
});

test("главная на телефоне: три колонки, «Начальная настройка» строкой на всю ширину, знак ниже", () => {
  // Без `no-mobile-shrink` общее правило телефона (globals.css) делает из трёх колонок две.
  assert.match(PAGE, /className="no-mobile-shrink grid grid-cols-3 gap-2\.5 md:grid-cols-4 md:gap-3" data-nav-rise/);
  const setup = PAGE.slice(PAGE.indexOf("data-home-setup"), PAGE.indexOf("<HomeFavorites"));
  assert.match(setup, /col-span-3 flex items-center gap-3/);
  assert.match(setup, /md:col-span-1 md:min-h-\[148px\] md:flex-col/);
  assert.match(PAGE, /\[--logo-h:48px\] md:\[--logo-h:104px\]/);
  assert.match(PAGE, /px-5 py-5 [^"]*md:px-6 md:py-20/);
});

test("«Избранное» на телефоне — плитки 84px: плюс и «Избранное» или значок и название", () => {
  assert.equal((FAVORITES.match(/min-h-\[84px\]/g) ?? []).length, 2);
  assert.equal((FAVORITES.match(/md:min-h-\[148px\]/g) ?? []).length, 2);
  assert.match(FAVORITES, /md:hidden">\s*\{strings\.title\}/);
  assert.match(FAVORITES, /aria-label=\{strings\.add\}/);
  assert.match(FAVORITES, /line-clamp-2 block text-\[12\.5px\]/);
});

test("подпись «Начальной настройки» короткая во всех языках", () => {
  const expected = { ru: "Объекты, сотрудники и журналы", en: "Sites, staff and journals", uz: "Nuqtalar, xodimlar va jurnallar" };
  for (const [locale, body] of Object.entries(expected)) {
    const messages = JSON.parse(read(`src/i18n/messages/${locale}.json`)) as { homePage: { setupBody: string } };
    assert.equal(messages.homePage.setupBody, body, locale);
  }
});
