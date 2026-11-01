import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { DEFAULT_PLAN_RATES, planPeriodPriceRub } from "@/lib/tariff-plans";
import { clampClients, partnerFirstYearIncome } from "@/lib/partners/income-calculator";
import { DEFAULT_REWARD_RULE, REWARD_TERMS_2026_11 } from "@/lib/partners/rewards";

const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");
const rule = REWARD_TERMS_2026_11;

describe("калькулятор дохода партнёра", () => {
  it("«Стандарт» помесячно: 12 платежей × 900 ₽ + бонус 3 000 ₽ = 13 800 ₽ с клиента", () => {
    const price = planPeriodPriceRub(DEFAULT_PLAN_RATES, "standard", "month", 1);
    assert.equal(price, 3000);
    const one = partnerFirstYearIncome(rule, { clients: 1, cycle: "month", periodPriceRub: price });
    assert.deepEqual(
      { payments: one.paymentsPerClient, perPayment: one.perPaymentRub, subscription: one.subscriptionRub, bonus: one.bonusRub, total: one.totalRub, later: one.bonusLater },
      { payments: 12, perPayment: 900, subscription: 10800, bonus: 3000, total: 13800, later: false },
    );
    assert.equal(partnerFirstYearIncome(rule, { clients: 10, cycle: "month", periodPriceRub: price }).totalRub, 138000);
  });

  it("за год: доля с годового платежа сразу, бонус — со вторым платежом, на второй год", () => {
    const price = planPeriodPriceRub(DEFAULT_PLAN_RATES, "standard", "year", 1);
    assert.equal(price, 23880);
    const one = partnerFirstYearIncome(rule, { clients: 1, cycle: "year", periodPriceRub: price });
    assert.equal(one.paymentsPerClient, 1);
    assert.equal(one.subscriptionRub, 7164);
    assert.equal(one.bonusRub, 0);
    assert.equal(one.bonusLater, true);
  });

  it("«Премиум» помесячно — 21 000 ₽; старые 20 % дают меньше; ввод зажат в границы", () => {
    const premium = planPeriodPriceRub(DEFAULT_PLAN_RATES, "premium", "month", 1);
    assert.equal(partnerFirstYearIncome(rule, { clients: 1, cycle: "month", periodPriceRub: premium }).totalRub, 21000);
    assert.equal(partnerFirstYearIncome(DEFAULT_REWARD_RULE, { clients: 1, cycle: "month", periodPriceRub: 3000 }).totalRub, 10200);
    assert.equal(clampClients("0"), 1);
    assert.equal(clampClients("abc"), 1);
    assert.equal(clampClients(9999), 500);
    // Окно правил короче года — платежи вне окна не считаются.
    assert.equal(partnerFirstYearIncome({ ...rule, subscriptionMonths: 6 }, { clients: 1, cycle: "month", periodPriceRub: 1000 }).paymentsPerClient, 7);
  });

  it("на /partners — калькулятор от действующих правил и цен ROOT; письмо сходится с расчётом", () => {
    const page = read("src/app/partners/page.tsx");
    assert.match(page, /<PartnerIncomeCalculator\s+rule=\{\{/);
    assert.match(page, /rates=\{pricing\.rates\}/);
    assert.match(page, /href="#calculator"/);
    const letter = read("docs/partners-30-announcement.md");
    for (const figure of ["13 800 ₽", "7 164 ₽", "21 000 ₽", "138 000 ₽", "900 ₽", "1 500 ₽"]) {
      assert.ok(letter.includes(figure), figure);
    }
  });
});
