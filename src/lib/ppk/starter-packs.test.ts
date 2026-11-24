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

test("мастер по сферам: 4 сферы объекта; общепит — прежние пакеты, остальные — свои планы и нормативы", async () => {
  const { STARTER_SPHERES, sphereStarterPack, starterBlocksFor, isStarterSphere } = await import("./starter-packs");
  const { NORM_CATALOG } = await import("./norm-catalog");
  const { PPK_RECORD_SCHEMAS } = await import("./records");
  assert.deepEqual([...STARTER_SPHERES], ["food", "medical", "consumer", "sport"]);
  assert.equal(isStarterSphere("medical"), true);
  assert.equal(isStarterSphere("cafe"), false);
  assert.deepEqual(sphereStarterPack("food", "bakery"), starterPack("bakery"));
  for (const sphere of ["medical", "consumer", "sport"] as const) {
    const pack = sphereStarterPack(sphere);
    assert.equal(pack.products.length + pack.hazards.length + pack.flowcharts.length, 0, `${sphere}: без ХАССП общепита`);
    assert.ok(pack.labPlan.length >= 3, `${sphere}: план лаборатории`);
    assert.ok(pack.pestPlan.length >= 3, `${sphere}: план дезинсекции`);
    for (const id of pack.norms) assert.ok(NORM_CATALOG.some((doc) => doc.id === id), `${sphere}: норматив ${id} в каталоге`);
    for (const row of pack.labPlan) assert.ok(PPK_RECORD_SCHEMAS["lab-plan"].safeParse(row).success, `${sphere}: ${row.subject}`);
    assert.deepEqual([...starterBlocksFor(sphere)], ["lab-plan", "pest-plan", "norms"]);
  }
  assert.ok(sphereStarterPack("sport").labPlan.some((row) => /бассейн/i.test(row.subject)));
  assert.ok(sphereStarterPack("medical").norms.includes("order-29n"));
});
