import assert from "node:assert/strict";
import test from "node:test";

import { hueDistance, paletteFromPixels } from "./logo-palette";

/** Пиксели RGBA: [[цвет, сколько, альфа?]] — как из canvas. */
function pixels(parts: Array<[string, number, number?]>): Uint8ClampedArray {
  const total = parts.reduce((sum, [, count]) => sum + count, 0);
  const data = new Uint8ClampedArray(total * 4);
  let offset = 0;
  for (const [hex, count, alpha = 255] of parts) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    for (let i = 0; i < count; i += 1) {
      data.set([r, g, b, alpha], offset);
      offset += 4;
    }
  }
  return data;
}

test("зелёные буквы на белом — основной зелёный, дополнительного нет", () => {
  const palette = paletteFromPixels(pixels([["#ffffff", 700], ["#1f9d3a", 300]]));
  assert.deepEqual(palette, { primary: "#1f9d3a", secondary: null });
});

test("прозрачный фон и тёмно-серый текст не в счёт", () => {
  const palette = paletteFromPixels(pixels([["#e53935", 500], ["#333333", 300], ["#00ff00", 400, 0]]));
  assert.deepEqual(palette, { primary: "#e53935", secondary: null });
});

test("два цвета: основной — заметнее, дополнительный — другой оттенок", () => {
  const palette = paletteFromPixels(pixels([["#1f3a8a", 600], ["#f39c12", 250], ["#ffffff", 900]]));
  assert.deepEqual(palette, { primary: "#1f3a8a", secondary: "#f39c12" });
});

test("второй цвет того же оттенка — не дополнительный", () => {
  const palette = paletteFromPixels(pixels([["#1f9d3a", 500], ["#2ecc71", 300]]));
  assert.equal(palette?.secondary, null);
});

test("едва заметный второй цвет (меньше 12% основного) — не дополнительный", () => {
  const palette = paletteFromPixels(pixels([["#1f3a8a", 900], ["#f39c12", 60]]));
  assert.deepEqual(palette, { primary: "#1f3a8a", secondary: null });
});

test("ч/б логотип и логотип, где цвета почти нет, — null", () => {
  assert.equal(paletteFromPixels(pixels([["#000000", 300], ["#888888", 300], ["#ffffff", 400]])), null);
  assert.equal(paletteFromPixels(pixels([["#000000", 990], ["#e53935", 10]])), null);
  assert.equal(paletteFromPixels(new Uint8ClampedArray(0)), null);
});

test("оттенок средних цветов: соседние оттенки сливаются в один цвет", () => {
  const palette = paletteFromPixels(pixels([["#5566f6", 300], ["#4a5bf0", 300], ["#13a08f", 200]]));
  assert.ok(palette);
  assert.ok(hueDistance(palette.primary, "#5566f6") < 10, palette.primary);
  assert.ok(palette.secondary && hueDistance(palette.secondary, "#13a08f") < 10, String(palette.secondary));
});
