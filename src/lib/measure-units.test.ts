import assert from "node:assert/strict";
import test from "node:test";

import { formatMeasureUnit } from "@/lib/measure-units";

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
