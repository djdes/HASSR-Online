import assert from "node:assert/strict";
import test from "node:test";

import { formatMeasureUnit, parseMeasureUnitInput } from "@/lib/measure-units";

test("латинские коды единиц показываются по-русски", () => {
  assert.equal(formatMeasureUnit("kg"), "кг");
  assert.equal(formatMeasureUnit("l"), "л");
  assert.equal(formatMeasureUnit("pcs"), "шт");
});

test("незнакомый код показываем как есть, пустой — пустым", () => {
  assert.equal(formatMeasureUnit("бочка"), "бочка");
  assert.equal(formatMeasureUnit(""), "");
  assert.equal(formatMeasureUnit(null), "");
});

test("ввод «кг» сохраняется кодом «kg», незнакомое — как введено", () => {
  assert.equal(parseMeasureUnitInput("кг"), "kg");
  assert.equal(parseMeasureUnitInput(" Шт "), "pcs");
  assert.equal(parseMeasureUnitInput("ящик"), "ящик");
  assert.equal(formatMeasureUnit(parseMeasureUnitInput("кг")), "кг");
});
