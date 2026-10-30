import test from "node:test";
import assert from "node:assert/strict";

import { TAGLINE_VIEW_WIDTH, estimateTaglineEm, taglineLayout } from "./wordmark-tagline";

// Настоящая ширина подписей в Manrope 600 (замер в браузере, em).
const MEASURED = [
  ["Ваш электронный ХАССП", 12.386],
  ["Your electronic HACCP", 10.842],
  ["Sizning elektron HACCP tizimingiz", 16.234],
] as const;

test("оценка ширины подписи не меньше настоящей и не шире на 9%", () => {
  for (const [text, real] of MEASURED) {
    const estimate = estimateTaglineEm(text);
    // Недооценка дала бы слишком крупный шрифт: `textLength` сжал бы буквы.
    assert.ok(estimate >= real, `${text}: ${estimate} < ${real}`);
    assert.ok(estimate <= real * 1.09, `${text}: ${estimate} > ${real} × 1.09`);
  }
});

test("подпись тянется ровно на ширину знака, шрифт — по длине строки", () => {
  const russian = taglineLayout("Ваш электронный ХАССП");
  assert.equal(russian.stretch, true);
  // Естественная ширина при этом шрифте — чуть меньше рамки: растяжка едва заметна.
  const natural = (12.386 * russian.fontSize) / TAGLINE_VIEW_WIDTH;
  assert.ok(natural > 0.95 && natural <= 1, String(natural));
  assert.ok(russian.baseline < russian.height);

  const uzbek = taglineLayout("Sizning elektron HACCP tizimingiz");
  assert.ok(uzbek.fontSize < russian.fontSize, "длинная строка — мельче");
});

test("короткую строку не растягиваем — буквы разлетелись бы", () => {
  const short = taglineLayout("ХАССП");
  assert.equal(short.stretch, false);
  assert.ok(short.fontSize <= TAGLINE_VIEW_WIDTH / 9);
});
