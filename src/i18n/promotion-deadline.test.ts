import assert from "node:assert/strict";
import { test } from "node:test";
import { promotionBadgeLabel, promotionEndHint } from "@/lib/promo/promotions";

test("English promotion deadline preserves the Moscow midnight boundary", () => {
  const promotion = { percent: 20, endsAt: "2026-10-10T21:00:00.000Z" };
  assert.equal(promotionBadgeLabel(promotion, "en"), "−20\u00a0% until 10\u00a0October");
  assert.equal(promotionEndHint(promotion, "en"), "Promotion ends on 10.10.2026, 23:59 Moscow time");
  assert.match(promotionBadgeLabel(promotion), /до 10/);
});
