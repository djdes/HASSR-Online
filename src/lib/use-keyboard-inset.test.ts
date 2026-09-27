import assert from "node:assert/strict";
import test from "node:test";

import { keyboardSheetMaxHeight, scrollDeltaToReveal } from "./use-keyboard-inset";

test("окно над клавиатурой не выше видимой части экрана и не заезжает под часы", () => {
  assert.equal(keyboardSheetMaxHeight(420.4), "calc(420px - env(safe-area-inset-top, 0px) - 12px)");
  assert.equal(keyboardSheetMaxHeight(0), null);
});

test("поле под кнопками окна прокручивается в видимую часть", () => {
  // Видимая середина окна 100…300; поле 290…334 — под кнопками.
  assert.equal(scrollDeltaToReveal({ top: 100, bottom: 300 }, { top: 290, bottom: 334 }), 46);
  // Уже видно — не трогаем.
  assert.equal(scrollDeltaToReveal({ top: 100, bottom: 300 }, { top: 150, bottom: 194 }), 0);
  // Выше видимой части — вверх.
  assert.equal(scrollDeltaToReveal({ top: 100, bottom: 300 }, { top: 60, bottom: 104 }), -52);
  // Выше самого блока — выравниваем по верху, а не по низу.
  assert.equal(scrollDeltaToReveal({ top: 100, bottom: 200 }, { top: 150, bottom: 400 }), 38);
});
