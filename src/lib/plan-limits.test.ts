import assert from "node:assert/strict";
import test from "node:test";

import { isFreePlan, isPaidPlan } from "@/lib/plan-limits";

test("платные возможности — только на действующем платном тарифе", () => {
  assert.equal(isPaidPlan("paid"), true);
  // Старые значения платных тарифов — тоже платные.
  assert.equal(isPaidPlan("pro"), true);
  assert.equal(isPaidPlan(" paid "), true);
  for (const plan of ["free", "trial", "paused", "cancelled", "", null, undefined]) {
    assert.equal(isPaidPlan(plan), false, String(plan));
  }
  // Бесплатный и платный не пересекаются.
  for (const plan of ["free", "trial", "paid", "pro"]) {
    assert.notEqual(isPaidPlan(plan), isFreePlan(plan), plan);
  }
});
