import assert from "node:assert/strict";
import test from "node:test";

import { fitWithin } from "@/lib/ai-vision/downscale";

test("большое фото вписывается в 1600 по длинной стороне с пропорциями", () => {
  assert.deepEqual(fitWithin(4032, 3024, 1600), { width: 1600, height: 1200, scaled: true });
  assert.deepEqual(fitWithin(3024, 4032, 1600), { width: 1200, height: 1600, scaled: true });
});

test("маленькое фото не растягивается", () => {
  assert.deepEqual(fitWithin(1200, 900, 1600), { width: 1200, height: 900, scaled: false });
  assert.deepEqual(fitWithin(1600, 1600, 1600), { width: 1600, height: 1600, scaled: false });
});

test("узкая полоска не схлопывается в ноль", () => {
  assert.deepEqual(fitWithin(10000, 3, 1600), { width: 1600, height: 1, scaled: true });
  assert.deepEqual(fitWithin(0, 0, 1600), { width: 1, height: 1, scaled: false });
});
