import assert from "node:assert/strict";
import test from "node:test";

import { formatDuration, isUvLampEquipment, isUvLampType, lampRemainingHours, lampWarnLevel, sessionHours, shouldSendLampWarning } from "./uv-lamp";

test("остаток ресурса и пороги: ≤10 % — «скоро», 0 — «исчерпан»", () => {
  assert.equal(lampRemainingHours(8000, 1500), 6500);
  assert.equal(lampWarnLevel(8000, 1500), null);
  assert.equal(lampWarnLevel(8000, 7200), "warn");
  assert.equal(lampWarnLevel(8000, 8100), "over");
  assert.equal(lampRemainingHours(null, 10), null);
});

test("предупреждение — один раз на порог", () => {
  assert.equal(shouldSendLampWarning("warn", null), true);
  assert.equal(shouldSendLampWarning("warn", "warn"), false);
  assert.equal(shouldSendLampWarning("over", "warn"), true);
  assert.equal(shouldSendLampWarning("over", "over"), false);
  assert.equal(shouldSendLampWarning(null, null), false);
});

test("часы сеанса и подпись длительности", () => {
  const start = new Date("2026-09-22T07:00:00Z");
  assert.equal(sessionHours(start, new Date("2026-09-22T08:20:00Z")), 1.33);
  assert.equal(formatDuration(1.3333), "1 ч 20 мин");
  assert.equal(formatDuration(0.5), "30 мин");
  assert.equal(formatDuration(2), "2 ч");
});

test("распознаём УФ-лампу по типу и старым названиям", () => {
  assert.equal(isUvLampType("uv_lamp"), true);
  assert.equal(isUvLampType("Бактерицидный облучатель"), true);
  assert.equal(isUvLampType("refrigerator"), false);
});

test("УФ-лампа — по типу и, у старых ламп «Другое», по названию", () => {
  assert.equal(isUvLampEquipment({ type: "uv_lamp", name: "Лампа 1" }), true);
  assert.equal(isUvLampEquipment({ type: "other", name: "УФ-лампа №1" }), true);
  assert.equal(isUvLampEquipment({ type: "other", name: "Лампа UV в цехе" }), true);
  assert.equal(isUvLampEquipment({ type: "other", name: "Бактерицидный облучатель ОБН-150" }), true);
  assert.equal(isUvLampEquipment({ type: null, name: "Рециркулятор-облучатель" }), true);
  // «Уфа» — не «УФ»; холодильник и фритюрница лампой не бывают.
  assert.equal(isUvLampEquipment({ type: "other", name: "Холодильник Уфа" }), false);
  assert.equal(isUvLampEquipment({ type: "refrigerator", name: "Холодильник с UV-подсветкой" }), false);
  assert.equal(isUvLampEquipment({ type: "fryer", name: "Фритюрница УФ" }), false);
  assert.equal(isUvLampEquipment({ type: "oven", name: "Пароконвектомат" }), false);
});
