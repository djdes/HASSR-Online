import assert from "node:assert/strict";
import test from "node:test";

import { keyboardSheetMaxHeight, scrollDeltaToReveal, stickyFooterStyle } from "./use-keyboard-inset";

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

test("липкий подвал формы встаёт прямо над клавиатурой, без лишних отступов", () => {
  // Клавиатуры нет — подвал у низа экрана, снизу поле под полоску «домой».
  assert.deepEqual(stickyFooterStyle(0), { paddingBottom: "max(0.75rem, var(--safe-b))" });
  // Клавиатура 374px — подвал поднят ровно на неё. Полоска «домой» и нижнее
  // меню под клавиатурой, их отступы не добавляем (iPhone, раунд 5, кадр 015:
  // между кнопками и клавиатурой была пустая полоса ~140pt).
  assert.deepEqual(stickyFooterStyle(374), { bottom: 374, paddingBottom: "0.75rem" });
});
