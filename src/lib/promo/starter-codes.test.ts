import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formatMskDateTime } from "@/lib/promo/promotions";
import { isValidPromoCodeFormat, normalizePromoCode } from "@/lib/promo/rules";
import { STARTER_PROMO_CODES } from "@/lib/promo/starter-codes";

describe("STARTER_PROMO_CODES", () => {
  it("3–4 кода, латиница/цифры, уже нормализованы, без повторов", () => {
    assert.ok(STARTER_PROMO_CODES.length >= 3 && STARTER_PROMO_CODES.length <= 4);
    const codes = STARTER_PROMO_CODES.map((c) => c.code);
    assert.equal(new Set(codes).size, codes.length);
    for (const c of STARTER_PROMO_CODES) {
      assert.equal(isValidPromoCodeFormat(c.code), true, c.code);
      assert.equal(normalizePromoCode(c.code), c.code);
    }
  });

  it("у каждого — назначение, срок и лимит; проценты в пределах", () => {
    for (const c of STARTER_PROMO_CODES) {
      assert.ok(c.note.length > 10, c.code);
      assert.ok(c.endsAt instanceof Date, `${c.code}: срок`);
      assert.ok(c.maxUses !== null && c.maxUses > 0, `${c.code}: лимит`);
      if (c.kind === "percent") assert.ok(c.value >= 1 && c.value <= 100, c.code);
      else assert.ok(c.value > 0 && c.value < 1990, c.code);
      if (c.startsAt && c.endsAt) assert.ok(c.endsAt > c.startsAt, c.code);
    }
  });

  it("переходный код — после бесплатного периода, по 31 октября включительно (МСК)", () => {
    const october = STARTER_PROMO_CODES.find((c) => c.code === "OCTOBER20");
    assert.ok(october);
    assert.equal(formatMskDateTime(october.startsAt!), "11.10.2026, 00:00");
    assert.equal(formatMskDateTime(october.endsAt!), "31.10.2026, 23:59");
    assert.equal(october.newClientsOnly, true);
  });
});
