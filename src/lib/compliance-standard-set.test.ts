import assert from "node:assert/strict";
import test from "node:test";

import { standardSetCheck } from "@/lib/compliance-standard-set";
import { ACTIVE_JOURNAL_CATALOG } from "@/lib/journal-catalog";

test("все 11 журналов стандартного набора включены — «ок», полный балл", () => {
  // Выключены журналы вне набора — на проверку это не влияет.
  const check = standardSetCheck(new Set(["pool_water_control", "health_check", "medical_waste_b"]));
  assert.equal(check.status, "ok");
  assert.equal(check.score, 1);
  assert.equal(check.total, 11);
  assert.equal(check.enabled, 11);
  assert.match(check.detail, /все 11 журналов стандартного набора/);
});

test("не хватает 1–3 журналов — «внимание», названия перечислены", () => {
  const check = standardSetCheck(new Set(["med_books", "staff_training"]));
  assert.equal(check.status, "warn");
  assert.equal(check.enabled, 9);
  assert.equal(check.score, 9 / 11);
  assert.deepEqual(check.missing, ["med_books", "staff_training"]);
  assert.match(check.detail, /Включено 9 из 11/);
  assert.match(check.detail, /«Медицинские книжки»/);
});

test("не хватает больше трёх — «провал»; балл пропорционален", () => {
  const allOff = standardSetCheck(new Set(ACTIVE_JOURNAL_CATALOG.map((item) => item.code)));
  assert.equal(allOff.status, "fail");
  assert.equal(allOff.score, 0);
  assert.equal(allOff.enabled, 0);
  const four = standardSetCheck(new Set(["hygiene", "pest_control", "med_books", "general_cleaning"]));
  assert.equal(four.status, "fail");
  assert.equal(four.enabled, 7);
});
