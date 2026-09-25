import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { QR_FILL_CSS } from "@/lib/journal-fill-html";

const CSS = readFileSync("src/app/mini/mini-theme.css", "utf8");

/**
 * Сторож для `mini-theme.css`.
 *
 * Проверяется не вкус, а две вещи, которые ломались молча и были видны
 * только на телефоне — то есть не в типах, не в тестах и не в dev на
 * ноутбуке. Связь здесь по тексту файла, а не по импортам, поэтому
 * обычный тест её не поймал бы.
 */
describe("mini-theme: позиционирование прямых детей", () => {
  it("возвращает position тем, кто задаёт его сам", () => {
    // `.mini-root > *` задаёт position всем детям и тем самым перебивает
    // утилиты `.fixed` и `.sticky` — вес одинаковый, решает порядок
    // файлов. Из-за этого нижняя навигация уезжала в конец документа, а
    // шапка переставала быть липкой: выглядело как отсутствие навигации.
    for (const selector of [
      ".mini-root > .fixed",
      ".mini-root > .sticky",
      ".mini-root > .absolute",
    ]) {
      assert.ok(
        CSS.includes(selector),
        `нет возврата позиционирования: ${selector}`
      );
    }
  });

  it("общее правило про стопку слоёв осталось", () => {
    // Без него содержимое уходит под фоновые слои свечения и зерна.
    assert.match(CSS, /\.mini-root > \*\s*\{[^}]*z-index:\s*1/);
  });
});

describe("mini-theme: токены", () => {
  it("держит безопасные поля, слои и движение в одном месте", () => {
    for (const token of [
      "--mini-safe-t",
      "--mini-safe-b",
      "--mini-z-topbar",
      "--mini-z-nav",
      "--mini-z-overlay",
      "--mini-ease",
      "--mini-dur-fast",
    ]) {
      assert.ok(CSS.includes(token), `пропал токен ${token}`);
    }
  });

  it("не запрещает выделять значения журналов", () => {
    // `user-select: none` можно вешать только на элементы управления:
    // температуру и номер партии человек должен уметь скопировать.
    // Разбираем файл по правилам вручную: флаг `s` недоступен в целевой
    // версии, а без него точка не перешагнёт перенос строки.
    const rules = CSS.split("}");
    const blocked = rules.filter((rule) => /user-select:\s*none/.test(rule));
    for (const rule of blocked) {
      const selector = rule.slice(rule.lastIndexOf("\n", rule.indexOf("{"))).split("{")[0];
      assert.ok(
        /mini-press|mini-nav-rail|mini-topbar|mini-pill/.test(selector),
        `user-select: none на слишком широком селекторе: ${selector.trim()}`
      );
    }
  });
});

/** Без пробелов и ведущих нулей: `rgba(85, 102, 246, 0.55)` ≡ `rgba(85,102,246,.55)`. */
function compact(css: string): string {
  return css.replace(/\s+/g, "").replace(/([,(])0\./g, "$1.");
}

/** Значение объявления внутри блока `selector { … }` (первое вхождение). */
function declaration(css: string, selector: string, property: string): string | null {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) return null;
  const block = css.slice(start, css.indexOf("}", start));
  const match = new RegExp(`${property}:\\s*([^;]+);`).exec(block);
  return match ? match[1].trim() : null;
}

describe("mini-theme: узнаётся как QR-страницы", () => {
  it("шапка — тот же тёмно-синий градиент, что у QR-страниц", () => {
    // Владелец: мини-приложение «ощущается какой-то иной системой».
    // Шапка — главный признак QR-страниц; разъедется — снова разные системы.
    const qrHero = /\.hero\{[^}]*background:([^;}]+)/.exec(QR_FILL_CSS)?.[1];
    assert.ok(qrHero, "в QR_FILL_CSS нет фона шапки .hero");
    const miniHero = /--mini-hero:\s*([^;]+);/.exec(CSS)?.[1];
    assert.ok(miniHero, "нет токена --mini-hero");
    assert.equal(compact(miniHero), compact(qrHero));
    assert.equal(declaration(CSS, ".mini-topbar", "background"), "var(--mini-hero)");
  });

  it("индиго QR-страниц — акцент в обеих темах", () => {
    const accents = [...CSS.matchAll(/--mini-accent:\s*([^;]+);/g)].map((m) => m[1].trim());
    assert.ok(accents.length >= 2, "акцент должен быть задан в обеих темах");
    for (const accent of accents) assert.equal(accent, "#5566f6");
  });

  it("кнопки и поля в оболочке не ниже 48px, шрифт полей не меньше 16px", () => {
    // Под палец, в том числе на страницах кабинета, открытых в оболочке.
    const rules = CSS.split("}").filter((rule) => rule.includes("#mini-root main"));
    assert.ok(
      rules.some((rule) => /button/.test(rule) && /min-height:\s*48px/.test(rule)),
      "нет правила min-height: 48px для кнопок в оболочке"
    );
    assert.ok(
      rules.some((rule) => /textarea/.test(rule) && /min-height:\s*48px/.test(rule)),
      "нет правила min-height: 48px для полей в оболочке"
    );
    assert.ok(
      rules.some((rule) => /input, select, textarea/.test(rule) && /font-size:\s*16px/.test(rule)),
      "нет правила font-size: 16px для полей в оболочке"
    );
    assert.equal(declaration(CSS, ".mini-input", "font-size"), "17px");
    assert.equal(declaration(CSS, ".mini-btn-primary", "min-height"), "56px");
  });
});
