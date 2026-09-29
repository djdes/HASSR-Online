import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AppliedPromotion } from "@/lib/promo/promotions";

import { computeProposalPrice, formatProposalRub } from "./price";
import type { ProposalPromo } from "./types";

const NBSP = String.fromCharCode(0xa0);
const now = new Date("2026-09-29T09:00:00.000Z");
const lifetime: ProposalPromo = { code: "ROMASHKA10", kind: "percent", value: 10, lifetime: true, endsAt: null };
const until: ProposalPromo = {
  code: "OKT10",
  kind: "percent",
  value: 10,
  lifetime: false,
  // 1 ноября 00:00 МСК — последний день 31 октября.
  endsAt: new Date("2026-10-31T21:00:00.000Z"),
};
const fixed: ProposalPromo = { code: "MINUS500", kind: "fixed", value: 500, lifetime: false, endsAt: null };
const promotion: AppliedPromotion = {
  id: "p1",
  title: "Осень",
  percent: 20,
  startsAt: "2026-09-01T00:00:00.000Z",
  endsAt: "2026-10-10T21:00:00.000Z",
};

describe("цена КП", () => {
  it("без промокода и акции — цена тарифа, ничего не зачёркнуто", () => {
    const price = computeProposalPrice({ baseRub: 1990, promotion: null, promo: null, now });
    assert.equal(price.priceRub, 1990);
    assert.equal(price.oldRub, null);
    assert.equal(price.discountLabel, null);
    assert.equal(price.promoTerm, null);
  });

  it("промокод 10 % навсегда: 1 990 → 1 791, «навсегда»", () => {
    const price = computeProposalPrice({ baseRub: 1990, promotion: null, promo: lifetime, now });
    assert.equal(price.priceRub, 1791);
    assert.equal(price.oldRub, 1990);
    assert.equal(price.discountLabel, `−10${NBSP}%`);
    assert.equal(price.promoTerm, "навсегда");
    assert.equal(price.afterPromotionRub, null);
  });

  it("промокод до даты: подпись «до 31 октября»", () => {
    const price = computeProposalPrice({ baseRub: 1990, promotion: null, promo: until, now });
    assert.equal(price.priceRub, 1791);
    assert.equal(price.promoTerm, `до 31${NBSP}октября`);
  });

  it("фиксированная скидка — рублями, без срока", () => {
    const price = computeProposalPrice({ baseRub: 1990, promotion: null, promo: fixed, now });
    assert.equal(price.priceRub, 1490);
    assert.equal(price.discountLabel, `−500${NBSP}₽`);
    assert.equal(price.promoTerm, null);
  });

  it("истёкший промокод не применяется и помечается", () => {
    const expired = { ...until, endsAt: new Date("2026-09-01T00:00:00.000Z") };
    const price = computeProposalPrice({ baseRub: 1990, promotion: null, promo: expired, now });
    assert.equal(price.priceRub, 1990);
    assert.equal(price.promo, null);
    assert.equal(price.promoExpired, true);
  });

  it("акция и промокод: код от цены с акцией, после акции — база минус код", () => {
    const price = computeProposalPrice({ baseRub: 1990, promotion, promo: lifetime, now });
    // 1990 − 20 % = 1592; −10 % от 1592 = 159 → 1433.
    assert.equal(price.priceRub, 1433);
    assert.equal(price.oldRub, 1990);
    assert.equal(price.promotion?.percent, 20);
    assert.equal(price.afterPromotionRub, 1791);
  });

  it("только акция — зачёркнута база", () => {
    const price = computeProposalPrice({ baseRub: 1990, promotion, promo: null, now });
    assert.equal(price.priceRub, 1592);
    assert.equal(price.oldRub, 1990);
    assert.equal(price.promo, null);
  });

  it("скидка больше цены — не ниже нуля", () => {
    const price = computeProposalPrice({ baseRub: 1990, promotion: null, promo: { ...fixed, value: 5000 }, now });
    assert.equal(price.priceRub, 0);
  });

  it("формат рублей — с неразрывными пробелами", () => {
    assert.equal(formatProposalRub(1990), `1${NBSP}990${NBSP}₽`);
    assert.equal(formatProposalRub(0), `0${NBSP}₽`);
  });
});
