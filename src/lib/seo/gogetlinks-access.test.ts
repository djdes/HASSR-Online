import assert from "node:assert/strict";
import test from "node:test";
import { PLATFORM_SECTION_KEYS } from "@/lib/platform-access";
import { canApproveGglSpend } from "@/lib/seo/gogetlinks-access";

test("canApproveGglSpend enforces owner/admin by default and optional seo delegation only within plan", () => {
  const owner = { isRoot: true, platformSections: [] };
  const fullAdmin = { isRoot: false, platformSections: [...PLATFORM_SECTION_KEYS] };
  const seoOnly = { isRoot: false, platformSections: ["seo", "content"] };

  assert.equal(canApproveGglSpend(owner, { allowSeoApproveWithinPlan: false, withinApprovedPlan: false }), true);
  assert.equal(canApproveGglSpend(fullAdmin, { allowSeoApproveWithinPlan: false, withinApprovedPlan: false }), true);
  assert.equal(canApproveGglSpend(seoOnly, { allowSeoApproveWithinPlan: false, withinApprovedPlan: true }), false);
  assert.equal(canApproveGglSpend(seoOnly, { allowSeoApproveWithinPlan: true, withinApprovedPlan: true }), true);
  assert.equal(canApproveGglSpend(seoOnly, { allowSeoApproveWithinPlan: true, withinApprovedPlan: false }), false);
});
