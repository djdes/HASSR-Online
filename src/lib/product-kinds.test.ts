import assert from "node:assert/strict";
import test from "node:test";

import {
  looksLikeStorageTemperature,
  parseProductKindText,
  parseShelfLifeText,
  productKindOf,
  productShelfLife,
  productShelfLifeHours,
  shelfLifeFields,
} from "@/lib/product-kinds";

test("вид продукции: старые записи и мусор — сырьё", () => {
  assert.equal(productKindOf(null), "raw");
  assert.equal(productKindOf(""), "raw");
  assert.equal(productKindOf("dish"), "raw");
  assert.equal(productKindOf("semi"), "semi");
  assert.equal(productKindOf("finished"), "finished");
});

test("вид из колонки импорта", () => {
  assert.equal(parseProductKindText("Сырьё"), "raw");
  assert.equal(parseProductKindText("продукты"), "raw");
  assert.equal(parseProductKindText("Полуфабрикат собственного производства"), "semi");
  assert.equal(parseProductKindText("П/Ф"), "semi");
  assert.equal(parseProductKindText("Готовая продукция"), "finished");
  assert.equal(parseProductKindText("блюдо"), "finished");
  assert.equal(parseProductKindText("finished"), "finished");
  assert.equal(parseProductKindText("что-то другое"), null);
  assert.equal(parseProductKindText(""), null);
  assert.equal(parseProductKindText(undefined), null);
});

test("срок годности: часы важнее суток, пусто — нет срока", () => {
  assert.deepEqual(productShelfLife({ shelfLifeDays: 3, shelfLifeHours: null }), { value: 3, unit: "days" });
  assert.deepEqual(productShelfLife({ shelfLifeDays: null, shelfLifeHours: 12 }), { value: 12, unit: "hours" });
  assert.equal(productShelfLife({ shelfLifeDays: null, shelfLifeHours: null }), null);
  assert.equal(productShelfLifeHours({ shelfLifeDays: 2 }), 48);
  assert.equal(productShelfLifeHours({ shelfLifeHours: 6 }), 6);
});

test("срок из формы: одно поле из двух, ошибка на нецелом и нуле", () => {
  assert.deepEqual(shelfLifeFields("12", "hours"), { ok: true, shelfLifeDays: null, shelfLifeHours: 12 });
  assert.deepEqual(shelfLifeFields(30, "days"), { ok: true, shelfLifeDays: 30, shelfLifeHours: null });
  assert.deepEqual(shelfLifeFields("", "hours"), { ok: true, shelfLifeDays: null, shelfLifeHours: null });
  assert.deepEqual(shelfLifeFields(null, "days"), { ok: true, shelfLifeDays: null, shelfLifeHours: null });
  assert.deepEqual(shelfLifeFields("1.5", "days"), { ok: false });
  assert.deepEqual(shelfLifeFields(0, "hours"), { ok: false });
  assert.deepEqual(shelfLifeFields(-3, "days"), { ok: false });
});

test("срок из ячейки импорта", () => {
  assert.deepEqual(parseShelfLifeText("30"), { value: 30, unit: "days" });
  assert.deepEqual(parseShelfLifeText(5), { value: 5, unit: "days" });
  assert.deepEqual(parseShelfLifeText("72 ч"), { value: 72, unit: "hours" });
  assert.deepEqual(parseShelfLifeText("12 часов"), { value: 12, unit: "hours" });
  assert.deepEqual(parseShelfLifeText("3 сут."), { value: 3, unit: "days" });
  assert.deepEqual(parseShelfLifeText("5 дней"), { value: 5, unit: "days" });
  assert.deepEqual(parseShelfLifeText("2 мес"), { value: 60, unit: "days" });
  assert.deepEqual(parseShelfLifeText("24", true), { value: 24, unit: "hours" });
  assert.equal(parseShelfLifeText("долго"), null);
  assert.equal(parseShelfLifeText(""), null);
  assert.equal(parseShelfLifeText(null), null);
});

test("«Условия хранения» из файла: температура — в режим, слова — в условие", () => {
  assert.equal(looksLikeStorageTemperature("+2…+6 °C"), true);
  assert.equal(looksLikeStorageTemperature("-18"), true);
  assert.equal(looksLikeStorageTemperature("не выше +25"), true);
  assert.equal(looksLikeStorageTemperature("В сухом месте"), false);
  assert.equal(looksLikeStorageTemperature("Хранить при влажности не более 75% в закрытой таре вдали от сырья"), false);
});
