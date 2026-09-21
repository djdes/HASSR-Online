import assert from "node:assert/strict";
import test from "node:test";

import { generateServiceCode, normalizeServiceCode } from "@/lib/dish-pool-code";

test("код: 10 символов без похожих букв, формат XXXXX-XXXXX", () => {
  const code = generateServiceCode();
  assert.match(code, /^[A-Z2-9]{5}-[A-Z2-9]{5}$/);
  assert.ok(!/[01OIL]/.test(code));
});

test("ввод кода: регистр, пробелы, дефисы и русские буквы-двойники не важны", () => {
  assert.equal(normalizeServiceCode(" abcde fgh23 "), "ABCDE-FGH23");
  assert.equal(normalizeServiceCode("АВСDЕ-FGН23"), "ABCDE-FGH23");
  assert.equal(normalizeServiceCode("ABCDE"), null);
  assert.equal(normalizeServiceCode("ABCDE-FGH20"), null, "0 в алфавите нет");
  assert.equal(normalizeServiceCode(42), null);
});
