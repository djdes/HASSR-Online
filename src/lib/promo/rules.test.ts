import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  computeDiscountRub,
  describeDiscount,
  isPersonalPromo,
  isValidPromoCodeFormat,
  normalizePromoCode,
  personalCodeMatches,
  PROMO_REJECT_MESSAGES,
  validatePromo,
  type PromoRule,
} from "@/lib/promo/rules";

const base: PromoRule = {
  code: "WELCOME10",
  kind: "percent",
  value: 10,
  active: true,
  startsAt: null,
  endsAt: null,
  maxUses: null,
  newClientsOnly: false,
};
const now = new Date("2026-09-09T12:00:00.000Z");
const ctx = { now, paidUses: 0, organizationHasPaidOrders: false };

describe("normalizePromoCode", () => {
  it("верхний регистр, без пробелов", () => {
    assert.equal(normalizePromoCode("  welcome 10 "), "WELCOME10");
    assert.equal(isValidPromoCodeFormat("WELCOME10"), true);
    assert.equal(isValidPromoCodeFormat("AB"), false);
    assert.equal(isValidPromoCodeFormat("ПРИВЕТ"), false);
  });
});

describe("validatePromo", () => {
  it("рабочий код проходит", () => {
    assert.deepEqual(validatePromo(base, ctx), { ok: true });
  });
  it("нет / отключён / рано / поздно / исчерпан / только новым", () => {
    assert.equal((validatePromo(null, ctx) as { reason: string }).reason, "not-found");
    assert.equal((validatePromo({ ...base, active: false }, ctx) as { reason: string }).reason, "inactive");
    assert.equal((validatePromo({ ...base, startsAt: new Date("2026-10-01") }, ctx) as { reason: string }).reason, "not-started");
    assert.equal((validatePromo({ ...base, endsAt: new Date("2026-09-01") }, ctx) as { reason: string }).reason, "expired");
    assert.equal((validatePromo({ ...base, maxUses: 3 }, { ...ctx, paidUses: 3 }) as { reason: string }).reason, "exhausted");
    assert.equal((validatePromo({ ...base, newClientsOnly: true }, { ...ctx, organizationHasPaidOrders: true }) as { reason: string }).reason, "new-clients-only");
    assert.deepEqual(validatePromo({ ...base, newClientsOnly: true }, ctx), { ok: true });
  });
});

describe("computeDiscountRub", () => {
  it("процент от подписки, целые рубли, не больше цены", () => {
    assert.equal(computeDiscountRub({ kind: "percent", value: 10 }, 1990), 199);
    assert.equal(computeDiscountRub({ kind: "percent", value: 100 }, 1990), 1990);
    assert.equal(computeDiscountRub({ kind: "percent", value: 150 }, 1990), 1990);
    assert.equal(computeDiscountRub({ kind: "fixed", value: 500 }, 1990), 500);
    assert.equal(computeDiscountRub({ kind: "fixed", value: 5000 }, 1990), 1990);
    assert.equal(computeDiscountRub({ kind: "fixed", value: 500 }, 0), 0);
  });
  it("подпись скидки", () => {
    assert.equal(describeDiscount({ kind: "percent", value: 10 }), "−10 %");
    assert.equal(describeDiscount({ kind: "fixed", value: 1500 }).replace(/[\u202f\u00a0]/g, " "), "−1 500 ₽");
  });
});

describe("персональный код", () => {
  const personal: PromoRule = { ...base, code: "ROMASHKA10", personalEmail: "owner@romashka.ru", organizationId: "org_romashka" };
  const own = { emails: ["owner@romashka.ru"], organizationIds: ["org_other"] };
  const ownOrg = { emails: ["manager@romashka.ru"], organizationIds: ["org_romashka", "org_romashka_2"] };
  const foreign = { emails: ["boss@lavka.ru"], organizationIds: ["org_lavka"] };

  it("свой: совпала почта или организация (в т. ч. другая точка того же аккаунта)", () => {
    assert.equal(personalCodeMatches(personal, own), true);
    assert.equal(personalCodeMatches(personal, ownOrg), true);
    assert.equal(personalCodeMatches({ personalEmail: "Owner@Romashka.RU " }, own), true);
    assert.deepEqual(validatePromo(personal, { ...ctx, payer: own }), { ok: true });
    assert.deepEqual(validatePromo(personal, { ...ctx, payer: ownOrg }), { ok: true });
  });

  it("чужой: другая почта и другая организация — отказ с понятной причиной", () => {
    const verdict = validatePromo(personal, { ...ctx, payer: foreign });
    assert.deepEqual(verdict, {
      ok: false,
      reason: "personal-foreign",
      message: "Этот промокод персональный — он выдан другой организации",
    });
    assert.equal(PROMO_REJECT_MESSAGES["personal-foreign"], "Этот промокод персональный — он выдан другой организации");
  });

  it("чужая организация: код только на организацию, плательщик из другой", () => {
    const orgOnly: PromoRule = { ...base, organizationId: "org_romashka" };
    const verdict = validatePromo(orgOnly, { ...ctx, payer: { emails: ["owner@romashka.ru"], organizationIds: ["org_lavka"] } });
    assert.equal((verdict as { reason: string }).reason, "personal-foreign");
  });

  it("чужому «исчерпан» не показываем — важнее, что код не его", () => {
    const verdict = validatePromo({ ...personal, maxUses: 1 }, { ...ctx, paidUses: 1, payer: foreign });
    assert.equal((verdict as { reason: string }).reason, "personal-foreign");
  });

  it("плательщик ещё неизвестен (аноним на проверке кода) — не отклоняем, решит оплата", () => {
    assert.deepEqual(validatePromo(personal, { ...ctx, payer: null }), { ok: true });
    assert.deepEqual(validatePromo(personal, ctx), { ok: true });
  });

  it("обычный код — не персональный, подходит всем", () => {
    assert.equal(isPersonalPromo(base), false);
    assert.equal(isPersonalPromo(personal), true);
    assert.equal(personalCodeMatches(base, foreign), true);
    assert.deepEqual(validatePromo(base, { ...ctx, payer: foreign }), { ok: true });
  });
});
