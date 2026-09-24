import assert from "node:assert/strict";
import test from "node:test";

import { ownershipFromOpf, sphereFromOkved } from "./org-lookup-map";

test("sphereFromOkved: общепит, производство, торговля, отели", () => {
  assert.equal(sphereFromOkved("56.10.1"), "restaurant");
  assert.equal(sphereFromOkved("56.10.2"), "fastfood");
  assert.equal(sphereFromOkved("56.29"), "canteen");
  assert.equal(sphereFromOkved("56.30"), "bar");
  assert.equal(sphereFromOkved("56.21"), "catering");
  assert.equal(sphereFromOkved("10.71"), "bakery");
  assert.equal(sphereFromOkved("10.13"), "production");
  assert.equal(sphereFromOkved("47.11"), "retail");
  assert.equal(sphereFromOkved("47.30"), "gas_station");
  assert.equal(sphereFromOkved("55.10"), "hotel");
  assert.equal(sphereFromOkved("85.11"), "education");
  assert.equal(sphereFromOkved("86.21"), "medical");
  assert.equal(sphereFromOkved("93.11"), "fitness");
  assert.equal(sphereFromOkved("93.12"), "fitness");
  assert.equal(sphereFromOkved("93.13"), "fitness");
  assert.equal(sphereFromOkved("93.19"), "fitness");
  assert.equal(sphereFromOkved("96.04"), "fitness");
  // Развлечения (93.2x) — не фитнес.
  assert.equal(sphereFromOkved("93.29"), null);
  assert.equal(sphereFromOkved("64.19"), null);
  assert.equal(sphereFromOkved(""), null);
});

test("ownershipFromOpf: государственные учреждения и остальные", () => {
  assert.equal(ownershipFromOpf("Общество с ограниченной ответственностью", "LEGAL"), "private");
  assert.equal(ownershipFromOpf("Муниципальное бюджетное дошкольное образовательное учреждение", "LEGAL"), "state");
  assert.equal(ownershipFromOpf("Государственное унитарное предприятие", "LEGAL"), "state");
  assert.equal(ownershipFromOpf(null, "INDIVIDUAL"), "private");
  assert.equal(ownershipFromOpf("", "LEGAL"), null);
});
