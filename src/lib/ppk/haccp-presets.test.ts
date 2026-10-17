import test from "node:test";
import assert from "node:assert/strict";

import { PPK_PRODUCT_CATEGORIES } from "./records";
import { PPK_RECORD_SCHEMAS } from "./records";
import {
  PRODUCT_CATEGORY_LABELS,
  TYPICAL_HAZARDS,
  TYPICAL_STEPS,
  productIndicatorPreset,
} from "./haccp-presets";

test("у каждой группы продукции есть русская подпись", () => {
  for (const category of PPK_PRODUCT_CATEGORIES) {
    assert.ok(PRODUCT_CATEGORY_LABELS[category].length > 0, category);
  }
  assert.equal(PRODUCT_CATEGORY_LABELS.drinks, "Напитки");
});

test("у каждой группы не меньше 4 показателей с названием и нормой", () => {
  for (const category of PPK_PRODUCT_CATEGORIES) {
    const preset = productIndicatorPreset(category);
    assert.ok(preset.length >= 4, `${category}: ${preset.length}`);
    for (const row of preset) {
      assert.ok(row.name.length > 0, category);
      assert.ok(row.norm.length > 0, category);
    }
  }
});

test("базовые показатели есть во всех группах, токсичные элементы — кроме напитков", () => {
  for (const category of PPK_PRODUCT_CATEGORIES) {
    const names = productIndicatorPreset(category).map((row) => row.name);
    assert.ok(names.includes("БГКП (колиформы)"), category);
    assert.ok(names.includes("Патогенные, в т. ч. сальмонеллы"), category);
    if (category !== "drinks") assert.ok(names.includes("S. aureus"), category);
    assert.equal(names.includes("Токсичные элементы (свинец, кадмий, мышьяк, ртуть)"), category !== "drinks", category);
  }
});

test("КМАФАнМ у не напитков — КОЕ/г с нормой по подгруппе ТР ТС 021/2011", () => {
  const row = productIndicatorPreset("dairy").find((item) => item.name === "КМАФАнМ, КОЕ/г");
  assert.equal(row?.norm, "по подгруппе: ТР ТС 021/2011, прил. 1");
});

test("специфичные показатели групп", () => {
  const names = (category: (typeof PPK_PRODUCT_CATEGORIES)[number]) =>
    productIndicatorPreset(category).map((row) => row.name);
  assert.ok(names("ready-meals").includes("L. monocytogenes"));
  assert.ok(names("ready-meals").includes("Бактерии рода Proteus"));
  assert.ok(names("dairy").includes("Антибиотики"));
  assert.ok(names("meat").includes("Бактерии рода Proteus"));
  assert.ok(names("fish").includes("Гистамин (лососёвые, сельдевые, скумбриевые, тунцовые), мг/кг"));
  assert.ok(names("bakery").includes("Плесени, КОЕ/г"));
  assert.ok(names("drinks").includes("Дрожжи и плесени, КОЕ/см³"));
  assert.equal(names("semi-finished").includes("L. monocytogenes"), false);
});

test("типовые этапы — 10 строк без повторов; каждая типовая опасность привязана к этапу", () => {
  assert.equal(TYPICAL_STEPS.length, 10);
  assert.equal(new Set(TYPICAL_STEPS).size, TYPICAL_STEPS.length);
  for (const hazard of TYPICAL_HAZARDS) {
    assert.ok(TYPICAL_STEPS.includes(hazard.step), hazard.step);
  }
});

test("все типовые опасности проходят схему записи ППК", () => {
  assert.equal(TYPICAL_HAZARDS.length, 10);
  for (const hazard of TYPICAL_HAZARDS) {
    const result = PPK_RECORD_SCHEMAS.hazards.safeParse(hazard);
    assert.equal(result.success, true, hazard.hazard);
  }
});
