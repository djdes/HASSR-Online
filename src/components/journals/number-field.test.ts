import assert from "node:assert/strict";
import test from "node:test";

import {
  outOfRangeMessage,
  parseNumeric,
  stepStartValue,
} from "@/components/journals/number-field";

/* ── Откуда считает степпер в пустом поле ──────────────────────────── */

test("пустое поле с нормой 2…6: степпер стартует с середины нормы", () => {
  // Раньше отсчёт шёл от нуля, и один тап «+» сохранял 0,1 °C в
  // холодильник как настоящий замер — сразу отклонение.
  assert.equal(stepStartValue({ min: 2, max: 6 }), 4);
});

test("норма задана одной границей — стартуем с неё", () => {
  assert.equal(stepStartValue({ min: null, max: 30 }), 30);
  assert.equal(stepStartValue({ min: -18, max: null }), -18);
});

test("нормы нет — поведение прежнее, от нуля", () => {
  assert.equal(stepStartValue(null), 0);
  assert.equal(stepStartValue(undefined), 0);
  assert.equal(stepStartValue({ min: null, max: null }), 0);
});

/* ── Границы поля при ручном вводе ─────────────────────────────────── */

test("значение внутри границ сохраняется молча", () => {
  assert.equal(outOfRangeMessage("4", -40, 30, "°C"), null);
  assert.equal(outOfRangeMessage("-40", -40, 30, "°C"), null);
  assert.equal(outOfRangeMessage("30", -40, 30, "°C"), null);
});

test("44 при максимуме 30 — понятная ошибка, а не тихое сохранение", () => {
  assert.equal(
    outOfRangeMessage("44", -40, 30, "°C"),
    "Проверьте значение: допустимо от -40 до 30 °C"
  );
});

test("одна граница — сообщение про неё одну", () => {
  assert.equal(
    outOfRangeMessage("44", undefined, 30, "%"),
    "Проверьте значение: допустимо не выше 30 %"
  );
  assert.equal(
    outOfRangeMessage("-5", 0, undefined),
    "Проверьте значение: допустимо не ниже 0"
  );
});

test("пустое поле и незаконченный ввод ошибкой не считаются", () => {
  assert.equal(outOfRangeMessage("", -40, 30, "°C"), null);
  assert.equal(outOfRangeMessage("-", -40, 30, "°C"), null);
});

test("границ нет — не ругаемся ни на что", () => {
  assert.equal(outOfRangeMessage("999", undefined, undefined), null);
});

test("русская запятая читается как разделитель дробной части", () => {
  assert.equal(parseNumeric("4,5"), 4.5);
  assert.equal(outOfRangeMessage("44,5", -40, 30, "°C") !== null, true);
});
