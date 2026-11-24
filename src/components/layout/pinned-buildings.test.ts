import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * Скрепка и звёздочка лежат внутри пунктов меню Radix: пункт выбирается по
 * отпусканию кнопки мыши (`pointerup` → `click`). Без остановки `pointerup`
 * нажатие на скрепку выбирало объект и закрывало список (найдено на стенде
 * 2026-11-23).
 */
test("скрепка и звёздочка не выбирают пункт меню и не закрывают список", () => {
  for (const file of ["src/components/layout/pinned-buildings.tsx", "src/components/favorites/favorite-star.tsx"]) {
    const source = readFileSync(file, "utf8");
    assert.match(source, /onPointerDown=\{\(event\) => event\.stopPropagation\(\)\}/, file);
    assert.match(source, /onPointerUp=\{\(event\) => event\.stopPropagation\(\)\}/, file);
    assert.match(source, /event\.preventDefault\(\);\s*event\.stopPropagation\(\);/, file);
  }
});
