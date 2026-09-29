import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  DocumentToolbarAddButton,
  DocumentToolbarRow,
} from "@/components/journals/document-toolbar-row";

/**
 * Ряд шапки документа «описание + Добавить строку».
 *
 * Правка владельца 2026-09-29: на телефоне описание и кнопка — в одну
 * строку. До 640px описание обрезано до трёх строк со ссылкой
 * «Подробнее» / «Свернуть», кнопка компактная — «+ Добавить»; от 640px —
 * как раньше: описание целиком и «Добавить строку». Печать не меняется.
 * Раскладку на живых ширинах (360–1280) меряет e2e задачи
 * doc-toolbar-row-phone-2026-09, здесь — разметка и классы.
 */

const SOURCE = readFileSync("src/components/journals/document-toolbar-row.tsx", "utf8");
const DESCRIPTION = "Только складские помещения с продуктами. Раз в день, в первой половине дня.";

const addButton = () => createElement(DocumentToolbarAddButton, { onClick() {} });
const renderRow = (children?: ReactElement) =>
  renderToStaticMarkup(
    createElement(DocumentToolbarRow, { description: DESCRIPTION, sticky: true }, children),
  );

/** Классы первого элемента с атрибутом `attr`. */
function classesOf(html: string, attr: string): string[] {
  const tag = (html.match(/<[a-z]+\s[^>]*>/g) ?? []).find((item) => item.includes(` ${attr}=`));
  assert.ok(tag, `нет элемента с ${attr}`);
  const value = /\sclass="([^"]*)"/.exec(tag)?.[1];
  assert.ok(value !== undefined, `у элемента с ${attr} нет class`);
  return value.split(/\s+/);
}

test("телефон: описание и кнопка в одной строке, кнопка не во всю ширину и не сжимается", () => {
  const html = renderRow(addButton());
  const row = classesOf(html, "data-doc-toolbar-row");
  assert.ok(row.includes("flex") && row.includes("items-start"), row.join(" "));
  assert.ok(!row.includes("flex-col"), "ряд не складывается в колонку на телефоне");
  assert.ok(row.includes("sm:items-center"), "от 640px — по центру, как раньше");
  // Описание забирает остаток строки и может сжиматься, кнопки — нет.
  const text = classesOf(html, "data-touch-compact");
  assert.ok(text.includes("min-w-0") && text.includes("flex-1"), text.join(" "));
  const actions = classesOf(html, "data-doc-toolbar-actions");
  assert.ok(actions.includes("shrink-0"), actions.join(" "));
  assert.ok(!actions.some((cls) => cls.includes("w-full")), "кнопка не во всю ширину");
  // Кнопка не сжимается (shrink-0 у Button) и не ниже 40px (h-11 = 44px).
  const button = classesOf(html, "data-doc-toolbar-add");
  assert.ok(button.includes("shrink-0") && button.includes("h-11"), button.join(" "));
});

test("на узком экране короткая подпись «Добавить», от 640px — «Добавить строку»", () => {
  const html = renderToStaticMarkup(addButton());
  assert.match(html, /aria-label="Добавить строку"/);
  assert.match(html, /<svg/);
  assert.match(html, /<span class="sm:hidden">Добавить<\/span>/);
  assert.match(html, /<span class="max-sm:hidden">Добавить строку<\/span>/);
});

test("описание: до 640px — три строки 13px, «Подробнее» — только если текст не влез", () => {
  const html = renderRow(addButton());
  const text = classesOf(html, "data-doc-toolbar-description");
  assert.ok(text.includes("max-sm:line-clamp-3"), text.join(" "));
  assert.ok(text.includes("text-[13px]"), text.join(" "));
  // 13px и на телефоне: правило «крупнее на телефоне» подняло бы до 15px.
  assert.match(html, /data-touch-compact=""/);
  // До замера на клиенте ссылки нет: она появляется, только когда текст обрезан.
  assert.doesNotMatch(html, /Подробнее|Свернуть/);
  assert.match(SOURCE, /element\.scrollHeight - element\.clientHeight > 1/);
  assert.match(SOURCE, /new ResizeObserver\(measure\)/);
  assert.match(SOURCE, /addEventListener\("resize", measure\)/);
  assert.match(SOURCE, /expanded \|\| clipped \?/);
  assert.match(SOURCE, /expanded \? "Свернуть" : "Подробнее"/);
  assert.match(SOURCE, /aria-expanded=\{expanded\}/);
});

test("печать: описание целиком мелко по центру, без кнопок и «Подробнее»", () => {
  const html = renderRow(addButton());
  assert.ok(classesOf(html, "data-doc-toolbar-row").includes("print:block"));
  const text = classesOf(html, "data-doc-toolbar-description");
  for (const cls of ["print:text-center", "print:text-[10px]", "print:line-clamp-none"]) {
    assert.ok(text.includes(cls), cls);
  }
  assert.ok(classesOf(html, "data-doc-toolbar-actions").includes("print:hidden"));
  assert.match(SOURCE, /sm:hidden print:hidden/);
});

test("кнопок нет (документ закрыт) — одно описание на всю ширину", () => {
  const html = renderRow();
  assert.doesNotMatch(html, /data-doc-toolbar-actions|<button/);
  assert.ok(classesOf(html, "data-touch-compact").includes("flex-1"));
  assert.equal(renderToStaticMarkup(createElement(DocumentToolbarRow, {})), "");
});

test("журнал складов ставит в ряд общую кнопку «Добавить строку»", () => {
  const climate = readFileSync("src/components/journals/climate-document-client.tsx", "utf8");
  assert.match(
    climate,
    /<DocumentToolbarRow[\s\S]*?<DocumentToolbarAddButton[\s\S]*?data-tour=\{TOUR\.addRow\}[\s\S]*?<\/DocumentToolbarRow>/,
  );
});
