import test from "node:test";
import assert from "node:assert/strict";

import { PPK_RECORD_SCHEMAS } from "./records";
import { flowchartTemplate } from "./diagram";
import { STARTER_KINDS, isStarterKind, starterPack, starterSummary } from "./starter-packs";

test("у каждого вида есть продукты, опасности, схемы и планы", () => {
  for (const kind of STARTER_KINDS) {
    const pack = starterPack(kind);
    assert.ok(pack.products.length >= 3, `${kind}: продукты`);
    assert.ok(pack.hazards.length >= 9, `${kind}: опасности`);
    assert.ok(pack.flowcharts.length >= 1, `${kind}: блок-схемы`);
    assert.ok(pack.labPlan.length >= 1, `${kind}: лаборатория`);
    assert.ok(pack.pestPlan.length >= 1, `${kind}: дезинсекция`);
    assert.ok(pack.norms.length >= 1, `${kind}: нормативы`);
  }
});

test("все данные пакетов проходят схемы реестра", () => {
  for (const kind of STARTER_KINDS) {
    const pack = starterPack(kind);
    const check = (block: keyof typeof PPK_RECORD_SCHEMAS, data: unknown) => {
      const parsed = PPK_RECORD_SCHEMAS[block].safeParse(data);
      assert.ok(parsed.success, `${kind}/${block}: ${parsed.success ? "" : parsed.error.message}`);
    };
    pack.products.forEach((row) => check("products", row));
    pack.hazards.forEach((row) => check("hazards", row));
    pack.labPlan.forEach((row) => check("lab-plan", row));
    pack.pestPlan.forEach((row) => check("pest-plan", row));
    pack.flowcharts.forEach((chart) =>
      check("flowchart", { ...flowchartTemplate(chart.template), title: chart.title }),
    );
    check("norms", { selected: pack.norms, custom: [] });
  }
});

test("пекарня: без размораживания, с отделкой кремом", () => {
  const steps = starterPack("bakery").hazards.map((h) => h.step);
  assert.ok(!steps.includes("Размораживание"));
  assert.ok(steps.includes("Отделка"));
});

test("кафе и столовая: блок-схемы hot и cold; пекарня — pastry; магазин — cold", () => {
  const templates = (k: Parameters<typeof starterPack>[0]) => starterPack(k).flowcharts.map((c) => c.template);
  assert.deepEqual(templates("cafe"), ["hot", "cold"]);
  assert.deepEqual(templates("canteen"), ["hot", "cold"]);
  assert.deepEqual(templates("bakery"), ["pastry"]);
  assert.deepEqual(templates("shop"), ["cold"]);
});

test("пакет — копия: правка не портит следующий вызов", () => {
  starterPack("cafe").products[0].name = "x";
  assert.notEqual(starterPack("cafe").products[0].name, "x");
});

test("starterSummary считает состав", () => {
  const s = starterSummary("cafe");
  assert.equal(s.products, 4);
  assert.equal(s.flowcharts, 2);
  assert.equal(s.hazards, 10);
  assert.equal(s.norms, 10);
});

test("isStarterKind", () => {
  assert.equal(isStarterKind("cafe"), true);
  assert.equal(isStarterKind("zoo"), false);
  assert.equal(isStarterKind(undefined), false);
});
