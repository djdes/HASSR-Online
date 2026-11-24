import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * Выпадающие списки ровнее (владелец, 2026-11-23): у поля с подписью внутри
 * рамки список открывается по рамке, везде ширина = ширине поля, на телефоне —
 * лист снизу, нативные списки полей на компьютере — в том же виде.
 */
const SELECT = readFileSync("src/components/ui/select.tsx", "utf8");
const FIELD = readFileSync("src/components/journals/journal-dialog-field.tsx", "utf8");
const RESPONSIVE = readFileSync("src/components/journals/journal-responsive.ts", "utf8");
const CSS = readFileSync("src/app/select-polish.css", "utf8");
const LAYOUT = readFileSync("src/app/layout.tsx", "utf8");

test("рамка поля с подписью — якорь списка: левый край, ширина и зазор по рамке", () => {
  assert.match(FIELD, /<div\s+data-field-frame\s/);
  assert.match(SELECT, /closest<HTMLElement>\("\[data-field-frame\]"\)/);
  for (const variable of ["--select-frame-width", "--select-frame-dx", "--select-frame-below", "--select-frame-above"]) {
    assert.ok(SELECT.includes(`"${variable}"`), variable);
  }
  // Переменные ставятся, когда список открылся (ref содержимого), и только тогда включают выравнивание.
  assert.match(SELECT, /content\.setAttribute\("data-field-frame-anchor", ""\)/);
  assert.match(SELECT, /data-\[field-frame-anchor\]:w-\(--select-frame-width\) data-\[field-frame-anchor\]:translate-x-\(--select-frame-dx\)/);
  assert.match(SELECT, /data-\[field-frame-anchor\]:data-\[side=bottom\]:translate-y-\(--select-frame-below\)/);
  assert.match(SELECT, /data-\[field-frame-anchor\]:data-\[side=top\]:translate-y-\[calc\(var\(--select-frame-above\)\*-1\)\]/);
  // Вся рамка открывает список, а не только строка значения.
  assert.match(RESPONSIVE, /JOURNAL_DIALOG_FIELD_TRIGGER_CLASS =[\s\S]*?after:absolute after:inset-0/);
  assert.match(RESPONSIVE, /JOURNAL_DIALOG_FIELD_CLASS =[\s\S]*?has-\[>\[data-slot=select-trigger\]\]:relative/);
});

test("ширина списка — как у поля (узкое — не меньше 12rem), высота не больше 24rem, пункты переносятся", () => {
  assert.match(SELECT, /w-\[max\(var\(--radix-select-trigger-width\),12rem\)\]/);
  assert.match(SELECT, /max-h-\[min\(var\(--radix-select-content-available-height\),24rem\)\]/);
  // У рамки высота меньше на сдвиг к рамке — список не выходит за край экрана.
  assert.match(SELECT, /data-\[side=top\]:max-h-\[calc\(min\(var\(--radix-select-content-available-height\),24rem\)-var\(--select-frame-above\)\)\]/);
  assert.match(SELECT, /"pr-9 whitespace-normal /);
});

test("телефон: список — лист снизу во всю ширину, пункты от 48px", () => {
  const phone = CSS.slice(CSS.indexOf("@media screen and (max-width: 639px) {"));
  assert.match(phone, /\[data-radix-popper-content-wrapper\]:has\(> \[data-slot="select-content"\]\) \{[\s\S]*?inset: auto 0 0 0 !important;[\s\S]*?transform: none !important;/);
  assert.match(phone, /border-radius: 20px 20px 0 0 !important;/);
  assert.match(phone, /padding-bottom: env\(safe-area-inset-bottom, 0px\);/);
  assert.match(phone, /\[data-slot="select-item"\] \{\s*min-height: 48px;/);
  assert.match(LAYOUT, /import "\.\/select-polish\.css";/);
});

test("компьютер: нативные списки полей — base-select там, где он есть, не в таблицах и не на телефоне", () => {
  const desktop = CSS.slice(CSS.indexOf("@supports (appearance: base-select) {"));
  assert.match(desktop, /@media \(hover: hover\) and \(pointer: fine\)/);
  assert.match(desktop, /appearance: base-select;/);
  assert.match(desktop, /::picker\(select\)/);
  // Не в таблицах, не внутри рамки с подписью (там список встал бы по строке, а не по рамке), не скрытые.
  assert.match(desktop, /:not\(\[multiple\], \[size\], \[hidden\], \[data-native-picker\], \.hidden, \.sr-only\):not\(:where\(table \*, \[role="grid"\] \*, \[data-field-frame\] \*\)\)/);
  assert.match(desktop, /min-inline-size: anchor-size\(self-inline\);/);
});
