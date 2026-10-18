import assert from "node:assert/strict";
import test from "node:test";

import {
  WESETUP_ACCENT,
  brandInk,
  brandOnColor,
  brandPalette,
  brandTint,
  contrastRatio,
  hexToRgb,
  normalizeBrandColor,
} from "@/lib/document-brand";

test("цвет нормализуется в #rrggbb, мусор — null", () => {
  assert.equal(normalizeBrandColor("#ABC"), "#aabbcc");
  assert.equal(normalizeBrandColor(" #5566F6 "), "#5566f6");
  assert.equal(normalizeBrandColor("#5566f6cc"), "#5566f6");
  assert.equal(normalizeBrandColor("5566f6"), null);
  assert.equal(normalizeBrandColor("#55"), null);
  assert.equal(normalizeBrandColor(null), null);
  assert.deepEqual(hexToRgb("#5566f6"), [85, 102, 246]);
});

test("текст на заливке — что контрастнее: на жёлтом тёмный, на тёмно-синем белый", () => {
  assert.equal(brandOnColor("#fff200"), "#0b1024");
  assert.equal(brandOnColor("#1f3a8a"), "#ffffff");
  assert.equal(brandOnColor(WESETUP_ACCENT), "#ffffff");
});

test("линии светлого цвета затемняются до различимых на белом листе", () => {
  for (const color of ["#fff200", "#ffd1dc", "#5566f6", "#0b1024", "#ffffff"]) {
    assert.ok(contrastRatio(brandInk(color), "#ffffff") >= 3, color);
  }
  // Достаточно тёмный цвет не меняется.
  assert.equal(brandInk("#1f3a8a"), "#1f3a8a");
});

test("палитра: без цвета — индиго WeSetup, подложка светлая", () => {
  const fallback = brandPalette(null);
  assert.equal(fallback.fill, WESETUP_ACCENT);
  const palette = brandPalette("#d93a3a");
  assert.equal(palette.fill, "#d93a3a");
  const [r, g, b] = brandTint("#d93a3a");
  assert.ok(r > 240 && g > 220 && b > 220, `подложка светлая: ${r},${g},${b}`);
});
