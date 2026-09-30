/**
 * Критерии приёмки B8 (п. 5, 6): 1 990 → 398; второй платёж → +398 и бонус
 * 3 000; возврат → сторно; оборудование 17 750 → 2 662,50; окно 12 месяцев.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_REWARD_RULE,
  buildPayoutSheet,
  computeHardwareAccrual,
  computePaymentAccruals,
  computeReversals,
  isWithinSubscriptionWindow,
  percentOf,
  periodMonthOf,
  previousPeriodMonth,
  roundRub,
} from "@/lib/partners/rewards";

const paidAt = new Date("2026-09-15T10:00:00Z");

test("первый платёж 1 990 ₽ → 398 ₽ по подписке, без бонуса", () => {
  const drafts = computePaymentAccruals(DEFAULT_REWARD_RULE, {
    paidAt,
    subscriptionRub: 1990,
    firstPaymentAt: null,
    paidSubscriptionPaymentsBefore: 0,
  });
  assert.deepEqual(
    drafts.map((d) => [d.kind, d.amountRub]),
    [["subscription", 398]],
  );
  assert.equal(drafts[0].ratePercent, 20);
  assert.equal(drafts[0].baseAmountRub, 1990);
});

test("второй платёж → +398 ₽ и разовый бонус 3 000 ₽", () => {
  const drafts = computePaymentAccruals(DEFAULT_REWARD_RULE, {
    paidAt,
    subscriptionRub: 1990,
    firstPaymentAt: new Date("2026-08-15T10:00:00Z"),
    paidSubscriptionPaymentsBefore: 1,
  });
  assert.deepEqual(
    drafts.map((d) => [d.kind, d.amountRub]),
    [
      ["subscription", 398],
      ["bonus", 3000],
    ],
  );
});

test("пополнение баланса вторым платежом — процент есть, бонуса нет", () => {
  const drafts = computePaymentAccruals(DEFAULT_REWARD_RULE, {
    paidAt,
    subscriptionRub: 500,
    firstPaymentAt: new Date("2026-08-15T10:00:00Z"),
    paidSubscriptionPaymentsBefore: 1,
    bonusEligible: false,
  });
  assert.deepEqual(
    drafts.map((d) => [d.kind, d.amountRub]),
    [["subscription", 100]],
  );
});

test("третий платёж — только подписка, бонус не повторяется", () => {
  const drafts = computePaymentAccruals(DEFAULT_REWARD_RULE, {
    paidAt,
    subscriptionRub: 1990,
    firstPaymentAt: new Date("2026-07-15T10:00:00Z"),
    paidSubscriptionPaymentsBefore: 2,
  });
  assert.deepEqual(drafts.map((d) => d.kind), ["subscription"]);
});

test("оборудование 17 750 ₽ → 2 662,50 ₽ (15 %)", () => {
  const draft = computeHardwareAccrual(DEFAULT_REWARD_RULE, 17750);
  assert.ok(draft);
  assert.equal(draft.amountRub, 2662.5);
  assert.equal(draft.ratePercent, 15);
});

test("возврат → сторно с отрицательными суммами, повторно не сторнируется", () => {
  const existing = [
    { kind: "subscription" as const, baseAmountRub: 1990, ratePercent: 20, amountRub: 398 },
    { kind: "bonus" as const, baseAmountRub: 1990, ratePercent: null, amountRub: 3000 },
  ];
  const reversals = computeReversals(existing);
  assert.deepEqual(
    reversals.map((d) => [d.kind, d.amountRub]),
    [
      ["subscription_reversal", -398],
      ["bonus_reversal", -3000],
    ],
  );
  const again = computeReversals([...existing, ...reversals]);
  assert.deepEqual(again, []);
});

test("окно 12 месяцев с первого платежа", () => {
  const first = new Date("2025-09-15T10:00:00Z");
  assert.equal(
    isWithinSubscriptionWindow(DEFAULT_REWARD_RULE, first, new Date("2026-09-15T10:00:00Z")),
    true,
  );
  assert.equal(
    isWithinSubscriptionWindow(DEFAULT_REWARD_RULE, first, new Date("2026-09-16T10:00:00Z")),
    false,
  );
  const drafts = computePaymentAccruals(DEFAULT_REWARD_RULE, {
    paidAt: new Date("2026-10-01T00:00:00Z"),
    subscriptionRub: 1990,
    firstPaymentAt: first,
    paidSubscriptionPaymentsBefore: 12,
  });
  assert.deepEqual(drafts, []);
});

test("новая версия правил применяется только к новым начислениям (ставка из правила)", () => {
  const v2 = { ...DEFAULT_REWARD_RULE, version: 2, subscriptionPercent: 25 };
  const drafts = computePaymentAccruals(v2, {
    paidAt,
    subscriptionRub: 1990,
    firstPaymentAt: null,
    paidSubscriptionPaymentsBefore: 0,
  });
  assert.equal(drafts[0].amountRub, 497.5);
  assert.equal(drafts[0].ratePercent, 25);
});

test("копеечная арифметика без ошибок плавающей точки", () => {
  assert.equal(percentOf(0.1 + 0.2, 100), 0.3);
  assert.equal(percentOf(1990, 20), 398);
  assert.equal(roundRub(2662.499999), 2662.5);
  assert.equal(roundRub(-398), -398);
});

test("ведомость: ниже минимума — перенос", () => {
  const sheet = buildPayoutSheet(
    [
      { partnerId: "a", payableRub: 398 },
      { partnerId: "b", payableRub: 3398 },
    ],
    DEFAULT_REWARD_RULE.minPayoutRub,
  );
  assert.deepEqual(
    sheet.map((row) => [row.partnerId, row.carryOver]),
    [
      ["b", false],
      ["a", true],
    ],
  );
});

test("ключ месяца считается по Москве; предыдущий месяц для закрытия 1-го числа", () => {
  assert.equal(periodMonthOf(new Date("2026-08-31T22:30:00Z")), "2026-09");
  assert.equal(previousPeriodMonth(new Date("2026-09-01T00:05:00+03:00")), "2026-08");
  assert.equal(previousPeriodMonth(new Date("2026-01-01T00:05:00+03:00")), "2025-12");
});
