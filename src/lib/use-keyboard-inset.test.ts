import assert from "node:assert/strict";
import test from "node:test";

import { keyboardSheetMaxHeight, keyboardStateFrom, scrollDeltaToReveal, stickyFooterStyle } from "./use-keyboard-inset";

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
  assert.deepEqual(stickyFooterStyle({ open: false, bottom: 0 }), { paddingBottom: "max(0.75rem, var(--safe-b))" });
  // Клавиатура 374px — подвал поднят ровно на неё. Полоска «домой» и нижнее
  // меню под клавиатурой, их отступы не добавляем (iPhone, раунд 5, кадр 015:
  // между кнопками и клавиатурой была пустая полоса ~140pt).
  assert.deepEqual(stickyFooterStyle({ open: true, bottom: 374 }), { bottom: 374, paddingBottom: "0.75rem" });
  // iOS сдвинул видимую часть к низу раскладки — подвал у низа, не над меню.
  assert.deepEqual(stickyFooterStyle({ open: true, bottom: 0 }), { bottom: 0, paddingBottom: "0.75rem" });
});

test("клавиатура открыта, даже когда iOS сдвинул видимую часть к низу раскладки", () => {
  // Нет клавиатуры (и полоса адреса Safari < 80px) — закрыта.
  assert.deepEqual(keyboardStateFrom(874, 874, 0), { open: false, bottom: 0 });
  assert.deepEqual(keyboardStateFrom(874, 820, 0), { open: false, bottom: 0 });
  // Поле вверху: видимая часть укоротилась — поднять на всю клавиатуру.
  assert.deepEqual(keyboardStateFrom(874, 508, 0), { open: true, bottom: 366 });
  // Поле внизу (iPhone, раунд 6, кадр 012): сдвиг 310 — поднять на 56, а не «закрыта».
  assert.deepEqual(keyboardStateFrom(874, 508, 310), { open: true, bottom: 56 });
  // Сдвиг до самого низа — 0, отрицательным не бывает.
  assert.deepEqual(keyboardStateFrom(874, 508, 400), { open: true, bottom: 0 });
});

test("Android-приложение: клавиатура сжимает само окно — открыта, если окно ниже полного и фокус в поле", () => {
  // Раунд 4 Android: окно 839 → 527 CSS px, видимая часть равна окну, фокус
  // в поле. Подвал ставим к низу окна (оно уже над клавиатурой), меню прячем.
  assert.deepEqual(keyboardStateFrom(527, 527.24, 0, 839, true), { open: true, bottom: 0 });
  // Окно так же ниже, но фокуса в поле нет (разделённый экран) — не клавиатура.
  assert.deepEqual(keyboardStateFrom(527, 527, 0, 839, false), { open: false, bottom: 0 });
  // Панель браузера свернулась/развернулась (десятки px) — не клавиатура.
  assert.deepEqual(keyboardStateFrom(780, 780, 0, 839, true), { open: false, bottom: 0 });
});
