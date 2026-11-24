import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const SOURCE = readFileSync("src/components/layout/section-top-menu.tsx", "utf8");

/** Тело функции компонента — от объявления до следующего верхнеуровневого `function`. */
function componentBody(name: string): string {
  const start = SOURCE.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  const next = SOURCE.indexOf("\nfunction ", start + 1);
  return SOURCE.slice(start, next === -1 ? undefined : next);
}

test("пункт строки с вложенными — одна кнопка списка: нажатие на «Журналы» не уводит в «Сегодня»", () => {
  const panel = componentBody("PanelEntry");
  // Вся вкладка — кнопка, открывающая список (владелец, 2026-11-23).
  assert.match(panel, /data-top-menu-trigger=\{entry\.id\}/);
  // Ссылки-вкладки в раздел у пункта с вложенными больше нет: раздел — первой строкой списка.
  assert.doesNotMatch(panel, /data-top-menu-link=\{entry\.id\}/);
  assert.match(panel, /data-top-menu-own/);
});

test("обычная вкладка без вложенных остаётся ссылкой", () => {
  const entry = componentBody("TopEntry");
  assert.match(entry, /<Link[\s\S]*href=\{entry\.href\}/);
});
