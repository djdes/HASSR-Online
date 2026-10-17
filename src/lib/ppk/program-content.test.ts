import assert from "node:assert/strict";
import test from "node:test";
import { EMERGENCIES, MEDICAL_PHRASE } from "./program-content";

test("аварийные ситуации: семь пунктов с действиями", () => {
  assert.equal(EMERGENCIES.length, 7);
  for (const item of EMERGENCIES) {
    assert.ok(item.title.length > 3);
    assert.ok(item.actions.length > 40);
  }
  assert.match(MEDICAL_PHRASE, /29н/);
});
