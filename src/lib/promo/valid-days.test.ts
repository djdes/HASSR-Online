import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { promotionEndLabel } from "./promotions";
import { isValidPromoValidDays, promoEndsAfterDays } from "./valid-days";

describe("срок промокода «N дней»", () => {
  it("14 дней от 29.09 (день по Москве) → до 13.10 23:59:59 МСК", () => {
    const end = promoEndsAfterDays(new Date("2026-09-29T12:00:00+03:00"), 14);
    assert.equal(end.toISOString(), "2026-10-13T20:59:59.999Z");
    assert.equal(promotionEndLabel(end), "до 13\u00a0октября");
  });

  it("граница суток — по Москве, а не по UTC", () => {
    // 29.09 23:30 МСК = 20:30 UTC — ещё 29-е; 30.09 00:30 МСК = 29.09 21:30 UTC — уже 30-е.
    assert.equal(promoEndsAfterDays(new Date("2026-09-29T20:30:00Z"), 1).toISOString(), "2026-09-30T20:59:59.999Z");
    assert.equal(promoEndsAfterDays(new Date("2026-09-29T21:30:00Z"), 1).toISOString(), "2026-10-01T20:59:59.999Z");
  });

  it("значения вне 1–90 не ломают расчёт, проверка — отдельно", () => {
    const now = new Date("2026-09-29T09:00:00Z");
    assert.equal(promoEndsAfterDays(now, 0).getTime(), promoEndsAfterDays(now, 1).getTime());
    assert.equal(promoEndsAfterDays(now, 500).getTime(), promoEndsAfterDays(now, 90).getTime());
    assert.equal(isValidPromoValidDays(14), true);
    assert.equal(isValidPromoValidDays(0), false);
    assert.equal(isValidPromoValidDays(91), false);
    assert.equal(isValidPromoValidDays(1.5), false);
    assert.equal(isValidPromoValidDays("14"), false);
  });
});
