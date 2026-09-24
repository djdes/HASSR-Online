import assert from "node:assert/strict";
import test from "node:test";

import {
  checklistJournalsForOrg,
  computeDocumentsPhase,
} from "@/lib/onboarding-documents";
import { SPHERE_RULES } from "@/lib/sphere-journal-rules";
import { normalizeSphere } from "@/lib/org-profile";

test("без сферы — правила «Другое»: пустые приказы → фаза не пройдена", () => {
  const status = computeDocumentsPhase({
    sphere: normalizeSphere(null),
    issuedOrderCodes: [],
    checklistsReviewedAt: null,
  });
  assert.deepEqual(status.ordersRequired, SPHERE_RULES.other.ordersRequired);
  assert.equal(status.ordersIssuedCount, 0);
  assert.equal(status.ordersDone, false);
  assert.equal(status.checklistsDone, false);
  assert.equal(status.done, false);
});

test("часть приказов оформлена — прогресс растёт, фаза не пройдена", () => {
  const status = computeDocumentsPhase({
    sphere: "fitness",
    issuedOrderCodes: ["journals-intro", "journals-intro", "haccp-team"],
    checklistsReviewedAt: new Date(),
  });
  assert.equal(status.ordersRequired.length, SPHERE_RULES.fitness.ordersRequired.length);
  // Повтор и рекомендуемый приказ в счёт обязательных не идут.
  assert.equal(status.ordersIssuedCount, 1);
  assert.equal(status.ordersDone, false);
  assert.equal(status.checklistsDone, true);
  assert.equal(status.done, false);
});

test("все обязательные приказы + отметка о чек-листах → фаза пройдена", () => {
  for (const rules of Object.values(SPHERE_RULES)) {
    const status = computeDocumentsPhase({
      sphere: rules.sphere,
      issuedOrderCodes: rules.ordersRequired,
      checklistsReviewedAt: new Date("2026-09-24T10:00:00Z"),
    });
    assert.equal(status.ordersDone, true, rules.sphere);
    assert.equal(status.done, true, rules.sphere);
  }
});

test("приказы все, но чек-листы не отмечены — фаза не пройдена", () => {
  const status = computeDocumentsPhase({
    sphere: "education",
    issuedOrderCodes: SPHERE_RULES.education.ordersRequired,
    checklistsReviewedAt: null,
  });
  assert.equal(status.ordersDone, true);
  assert.equal(status.done, false);
});

test("чек-листы предлагаются только для включённых журналов сферы", () => {
  const enabled = new Set(["pool_water_control", "hygiene", "cleaning_ventilation_checklist"]);
  assert.deepEqual(checklistJournalsForOrg("fitness", enabled), ["pool_water_control"]);
  assert.deepEqual(checklistJournalsForOrg("restaurant", new Set()), []);
});
