import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CARD_PROMO_CODE,
  CARD_PROMO_RECORD,
  cardOrderHref,
  cardTierPrice,
  cardVcard,
} from "@/lib/promo/card-offer";
import { isValidPromoCodeFormat, normalizePromoCode } from "@/lib/promo/rules";
import type { PlanRates } from "@/lib/tariff-plans";

const RATES: PlanRates = { standard: { month: 2490, year: 1990 }, premium: { month: 4990, year: 3990 } };
const TEN = { kind: "percent" as const, value: 10 };

describe("акция по визитке", () => {
  it("код уже нормализован и проходит формат", () => {
    assert.equal(normalizePromoCode(CARD_PROMO_CODE), CARD_PROMO_CODE);
    assert.equal(isValidPromoCodeFormat(CARD_PROMO_CODE), true);
    assert.equal(CARD_PROMO_RECORD.code, CARD_PROMO_CODE);
    assert.equal(CARD_PROMO_RECORD.value, 10);
    assert.equal(CARD_PROMO_RECORD.endsAt, null);
    assert.equal(CARD_PROMO_RECORD.newClientsOnly, true);
  });

  it("−10 % от годовой цены, в месяц — округлённо", () => {
    const p = cardTierPrice(RATES, "premium", "year", null, TEN);
    assert.equal(p.periodBaseRub, 3990 * 12);
    assert.equal(p.savingRub, 4788);
    assert.equal(p.periodFinalRub, 47880 - 4788);
    assert.equal(p.monthlyBaseRub, 3990);
    assert.equal(p.monthlyFinalRub, Math.round((47880 - 4788) / 12));
  });

  it("код считается от цены по ценовой акции", () => {
    const promotion = { id: "p", title: "Осень", percent: 20, startsAt: "2026-11-01T00:00:00Z", endsAt: "2026-12-01T00:00:00Z" };
    const p = cardTierPrice(RATES, "standard", "month", promotion, TEN);
    assert.equal(p.periodBaseRub, 2490 - Math.round(2490 * 0.2));
    assert.equal(p.savingRub, Math.round(p.periodBaseRub * 0.1));
  });

  it("без кода — без скидки", () => {
    const p = cardTierPrice(RATES, "standard", "year", null, null);
    assert.equal(p.savingRub, 0);
    assert.equal(p.periodFinalRub, p.periodBaseRub);
  });

  it("ссылка оплаты: тариф, период и код — только если он действует", () => {
    assert.equal(cardOrderHref("premium", "year", true), "/order?plan=premium&cycle=year&promo=VIZITKA10");
    assert.equal(cardOrderHref("standard", "month", false), "/order?plan=standard&cycle=month");
  });

  it("vCard с обоими телефонами и CRLF", () => {
    const v = cardVcard();
    assert.match(v, /^BEGIN:VCARD\r\n/);
    assert.match(v, /TEL;TYPE=WORK:\+74951096543\r\n/);
    assert.match(v, /TEL;TYPE=CELL:\+79253058077\r\n/);
    assert.match(v, /END:VCARD\r\n$/);
  });
});
