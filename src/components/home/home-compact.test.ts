/* eslint-disable react/no-children-prop -- Explicit children for SSR tests. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { HomeContacts } from "./home-contacts";

/*
 * Главная на телефоне (владелец, 2026-11-21 и 2026-11-22): «Начальная
 * настройка» — иконка и текст в строку, «Избранное» — три плитки в ряд, знак
 * ниже, «Мы на связи» всегда открыто и не сворачивается, без строки заголовка;
 * всё помещается на экран без прокрутки. С 768px — прежняя раскладка.
 */

const read = (file: string) => readFileSync(file, "utf8");
const PAGE = read("src/app/(dashboard)/home/page.tsx");
const FAVORITES = read("src/components/home/home-favorites.tsx");

test("«Мы на связи» всегда открыто: ни кнопки сворачивания, ни скрытой панели; заголовок — с 768px", () => {
  const html = renderToStaticMarkup(
    createElement(HomeContacts, { title: "Мы на связи", children: createElement("p", { id: "inside" }, "каналы") }),
  );
  assert.match(html, /<aside aria-label="Мы на связи"[^>]*data-home-contacts/);
  assert.doesNotMatch(html, /<button/);
  assert.doesNotMatch(html, /aria-expanded|data-home-contacts-toggle|data-open/);
  assert.match(html, /<p id="inside">каналы<\/p>/);
  // На телефоне строки заголовка нет, с 768px — маленький заголовок, как раньше.
  assert.match(html, /class="[^"]*\bhidden\b[^"]*\bmd:block\b[^"]*" aria-hidden="true">Мы на связи<\/div>/);
});

test("главная: контакты — открытым блоком, панель та же", () => {
  assert.match(PAGE, /<HomeContacts title=\{t\("contactsTitle"\)\}>/);
  assert.match(PAGE, /<ContactUsPanel\s+compact\s+defaultGroup="support"/);
  assert.doesNotMatch(PAGE, /<aside|HomeContactsSpoiler/);
});

test("главная на телефоне помещается на экран: промежутки 12px, подвала нет, поля меньше", () => {
  assert.match(PAGE, /className="space-y-3 md:space-y-5 [^"]*" data-home-page/);
  assert.match(PAGE, /className="grid gap-3 md:gap-5 lg:grid-cols/);
  const layout = read("src/app/(dashboard)/layout.tsx");
  assert.match(layout, /max-md:has-\[\[data-home-page\]\]:py-2\.5 md:py-6/);
  const css = read("src/app/globals.css");
  assert.match(css, /@media \(max-width: 767px\) \{\s*body:has\(\[data-home-page\]\) \[data-dashboard-footer\] \{\s*display: none;/);
});

test("главная на телефоне: три колонки, «Начальная настройка» строкой на всю ширину, знак ниже", () => {
  // Без `no-mobile-shrink` общее правило телефона (globals.css) делает из трёх колонок две.
  assert.match(PAGE, /className="no-mobile-shrink grid grid-cols-3 gap-2\.5 md:grid-cols-4 md:gap-3" data-nav-rise/);
  const setup = PAGE.slice(PAGE.indexOf("data-home-setup"), PAGE.indexOf("<HomeFavorites"));
  assert.match(setup, /col-span-3 flex items-center gap-3/);
  assert.match(setup, /md:col-span-1 md:min-h-\[148px\] md:flex-col/);
  assert.match(PAGE, /\[--logo-h:40px\] md:\[--logo-h:104px\]/);
  assert.match(PAGE, /px-5 py-2\.5 [^"]*md:px-6 md:py-20/);
});

test("«Избранное» на телефоне — плитки 72px: плюс и «Избранное» или значок и название", () => {
  assert.equal((FAVORITES.match(/min-h-\[72px\]/g) ?? []).length, 2);
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
