import assert from "node:assert/strict";
import test from "node:test";

import { formatPromoDisplayDate, isPromoApiErrorKey, promoApiErrorKey } from "./promo-code-presentation";

test("promo API adapter maps exact known server strings and keeps unknown text untrusted", () => {
  assert.equal(promoApiErrorKey("Такой код уже есть"), "duplicateCode");
  assert.equal(promoApiErrorKey("Скидка уже отменена"), "alreadyRevoked");
  assert.equal(promoApiErrorKey("Unknown diagnostic with customer data"), null);
  assert.equal(promoApiErrorKey({ error: "Такой код уже есть" }), null);
  assert.equal(promoApiErrorKey("toString"), null);
  assert.equal(isPromoApiErrorKey("promoMissing"), true);
  assert.equal(isPromoApiErrorKey("toString"), false);
});

test("display date keeps fixed UTC+3, healthy Uzbek months and original invalid text", () => {
  const instant = "2026-09-30T21:00:00.000Z"; // 01.10.2026 in Moscow.
  assert.equal(formatPromoDisplayDate(instant, "ru"), "01.10.2026");
  assert.equal(formatPromoDisplayDate(instant, "en"), "01 Oct 2026");
  assert.equal(formatPromoDisplayDate(instant, "uz"), "01-okt, 2026");
  for (const locale of ["ru", "en", "uz"] as const) {
    assert.equal(formatPromoDisplayDate("not-a-date", locale), "NaN.NaN.Na");
  }
  assert.equal(formatPromoDisplayDate("2010-07-01T20:30:00Z", "ru"), "01.07.2010");
  assert.equal(formatPromoDisplayDate("2010-07-01T20:30:00Z", "en"), "01 Jul 2010");
  assert.equal(formatPromoDisplayDate("2024-02-29T21:30:00Z", "uz"), "01-mar, 2024");
  assert.equal(formatPromoDisplayDate("+275760-09-13T00:00:00.000Z", "uz"), "NaN.NaN.Na");
});

test("Uzbek two-digit short-month shape matches healthy native date-context data for every month", () => {
  for (let month = 0; month < 12; month++) {
    for (const day of [1, 9, 15, 28]) {
      const input = new Date(Date.UTC(2026, month, day, 20, 30));
      const shifted = new Date(input.getTime() + 3 * 60 * 60 * 1000);
      const expected = new Intl.DateTimeFormat("uz-Latn-UZ", {
        timeZone: "UTC", day: "2-digit", month: "short", year: "numeric",
      }).format(shifted);
      assert.equal(formatPromoDisplayDate(input.toISOString(), "uz"), expected);
    }
  }
});
