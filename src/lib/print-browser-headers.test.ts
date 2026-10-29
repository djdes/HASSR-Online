import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { PRINT_WINDOW_PAGE_CSS } from "./native-bridge";

/**
 * Колонтитулы браузера (дата/время, заголовок вкладки, ссылка, «1/13»)
 * не печатаются ни на одном листе: Chrome их не рисует у края, где у
 * `@page` есть поле-бокс. Проверка ловит потерю пустых боксов до прода.
 */

const GLOBALS = readFileSync("src/app/globals.css", "utf8");

/** Тело безымянного `@page { ... }` с вложенными боксами. */
function unnamedPageRule(css: string): string {
  // С начала строки: в комментариях `@page { size: A4 }` тоже встречается.
  const start = css.search(/^[ \t]*@page\s*\{/m);
  assert.ok(start >= 0, "в globals.css нет безымянного @page");
  let depth = 0;
  for (let i = css.indexOf("{", start); i < css.length; i += 1) {
    if (css[i] === "{") depth += 1;
    if (css[i] === "}" && --depth === 0) return css.slice(start, i + 1);
  }
  throw new Error("безымянный @page не закрыт");
}

test("общий @page сайта глушит верхний и нижний колонтитулы браузера", () => {
  const rule = unnamedPageRule(GLOBALS);
  assert.match(rule, /@top-center\s*\{\s*content:\s*""/);
  assert.match(rule, /@bottom-center\s*\{\s*content:\s*""/);
  // Поля листа остаются — колонтитулы убраны не через `margin: 0`.
  assert.match(rule, /margin:\s*1cm/);
});

test("отдельные окна печати QR несут тот же @page", () => {
  assert.match(PRINT_WINDOW_PAGE_CSS, /@top-center\{content:""\}/);
  assert.match(PRINT_WINDOW_PAGE_CSS, /@bottom-center\{content:""\}/);
  for (const file of [
    "src/components/staff/personal-qr-card.tsx",
    "src/components/staff/staff-qr-invite-dialog.tsx",
  ]) {
    const source = readFileSync(file, "utf8");
    assert.match(source, /<style>\s*\$\{PRINT_WINDOW_PAGE_CSS\}/, file);
  }
});
