import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Prisma } from "@prisma/client";

import { pointsToSpend } from "@/lib/balance/constants";
import { splitOrderAmount } from "@/lib/partners/accruals";
import {
  DEFAULT_REWARD_RULE,
  computePaymentAccruals,
  roundRub,
  type AccrualDraft,
} from "@/lib/partners/rewards";

/**
 * Комиссия партнёру с пополнения и отсутствие двойного счёта.
 *
 * Как устроено (lib/partners/accruals.ts → accrueForPaidOrder): база
 * начисления — `splitOrderAmount(order).subscriptionRub`, то есть
 * `PaymentOrder.amountRub` без оборудования. А `amountRub` — это деньги,
 * пришедшие в кассу: у заказа, частично закрытого баллами, он уже
 * уменьшен на `pointsSpent`. Счётчик «какой по счёту платёж» (бонус)
 * тоже считает только заказы с денежной частью.
 *
 * Пополнение — такой же заказ: деньги пришли → начисление по
 * computePaymentAccruals. Подписка, оплаченная баллами этого пополнения,
 * — заказ с amountRub = 0 → начисления нет. Здесь это проверено на тех же
 * функциях, которыми считает accrueForPaidOrder.
 */

type Payment = {
  label: string;
  /** Деньги в кассу (для подписки — цена минус баллы). */
  amountRub: number;
  pointsSpent: number;
  paidAt: Date;
};

const RULE = DEFAULT_REWARD_RULE; // 20 % подписки 12 месяцев, бонус 3 000 ₽ за 2-й платёж

/** Шаг accrueForPaidOrder для одного платежа в истории клиента партнёра. */
function accrue(history: Payment[], index: number, firstPaymentAt: Date | null): AccrualDraft[] {
  const toOrder = (p: Payment) => ({ amountRub: new Prisma.Decimal(p.amountRub), bundleConfig: null });
  const current = history[index];
  const { subscriptionRub } = splitOrderAmount(toOrder(current));
  if (subscriptionRub <= 0) return [];
  const paidSubscriptionPaymentsBefore = history
    .slice(0, index)
    .filter((p) => splitOrderAmount(toOrder(p)).subscriptionRub > 0).length;
  return computePaymentAccruals(RULE, {
    paidAt: current.paidAt,
    subscriptionRub,
    firstPaymentAt: firstPaymentAt && firstPaymentAt < current.paidAt ? firstPaymentAt : null,
    paidSubscriptionPaymentsBefore,
  });
}

function runHistory(history: Payment[]) {
  let firstPaymentAt: Date | null = null;
  return history.map((payment, index) => {
    const drafts = accrue(history, index, firstPaymentAt);
    if (drafts.length > 0 && !firstPaymentAt) firstPaymentAt = payment.paidAt;
    return { label: payment.label, drafts };
  });
}

const day = (n: number) => new Date(Date.UTC(2026, 9, n, 10));

describe("комиссия партнёру с пополнения", () => {
  it("пополнение 5 000 ₽ — платёж: 20 % = 1 000 ₽", () => {
    const [topup] = runHistory([{ label: "пополнение", amountRub: 5000, pointsSpent: 0, paidAt: day(1) }]);
    assert.deepEqual(
      topup.drafts.map((d) => [d.kind, d.baseAmountRub, d.amountRub]),
      [["subscription", 5000, 1000]],
    );
  });

  it("подписка 1 990 ₽ целиком баллами из пополнения — второго начисления нет", () => {
    const points = pointsToSpend({ balanceRub: 5000, subscriptionRub: 1990, usePoints: true });
    assert.equal(points, 1990);
    const result = runHistory([
      { label: "пополнение", amountRub: 5000, pointsSpent: 0, paidAt: day(1) },
      { label: "подписка баллами", amountRub: 1990 - points, pointsSpent: points, paidAt: day(2) },
    ]);
    assert.deepEqual(result[1].drafts, []);
  });

  it("подписка частично баллами — начисление только с денежной части", () => {
    const points = pointsToSpend({ balanceRub: 1000, subscriptionRub: 1990, usePoints: true });
    const result = runHistory([
      { label: "пополнение", amountRub: 1000, pointsSpent: 0, paidAt: day(1) },
      { label: "подписка: 990 деньгами + 1 000 баллами", amountRub: 1990 - points, pointsSpent: points, paidAt: day(2) },
    ]);
    const subscription = result[1].drafts.find((d) => d.kind === "subscription");
    assert.equal(subscription?.baseAmountRub, 990);
    assert.equal(subscription?.amountRub, 198);
  });

  it("за весь сценарий база комиссии равна деньгам, которые реально пришли", () => {
    const history: Payment[] = [
      { label: "пополнение картой", amountRub: 5000, pointsSpent: 0, paidAt: day(1) },
      { label: "подписка баллами", amountRub: 0, pointsSpent: 1990, paidAt: day(2) },
      { label: "подписка баллами", amountRub: 0, pointsSpent: 1990, paidAt: day(3) },
      { label: "подписка: остаток 1 020 баллами + 970 деньгами", amountRub: 970, pointsSpent: 1020, paidAt: day(4) },
    ];
    const moneyIn = history.reduce((sum, p) => sum + p.amountRub, 0);
    const subscriptionBase = runHistory(history)
      .flatMap((r) => r.drafts)
      .filter((d) => d.kind === "subscription")
      .reduce((sum, d) => sum + d.baseAmountRub, 0);
    assert.equal(moneyIn, 5970);
    assert.equal(subscriptionBase, moneyIn);
    const subscriptionTotal = runHistory(history)
      .flatMap((r) => r.drafts)
      .filter((d) => d.kind === "subscription")
      .reduce((sum, d) => roundRub(sum + d.amountRub), 0);
    assert.equal(subscriptionTotal, roundRub(moneyIn * 0.2));
  });

  it("бонус за 2-й платёж считает денежные платежи: пополнение — платёж, подписка баллами — нет", () => {
    const result = runHistory([
      { label: "пополнение", amountRub: 5000, pointsSpent: 0, paidAt: day(1) },
      { label: "подписка баллами", amountRub: 0, pointsSpent: 1990, paidAt: day(2) },
      { label: "подписка картой", amountRub: 1990, pointsSpent: 0, paidAt: day(3) },
    ]);
    assert.deepEqual(result[1].drafts, []);
    assert.deepEqual(
      result[2].drafts.map((d) => [d.kind, d.amountRub]),
      [
        ["subscription", 398],
        ["bonus", 3000],
      ],
    );
  });

  it("как было до пополнений: подписка бонусными баллами (отзыв, рекомендация) тоже без комиссии", () => {
    const [bonusPaid] = runHistory([{ label: "подписка баллами за отзыв", amountRub: 0, pointsSpent: 1990, paidAt: day(1) }]);
    assert.deepEqual(bonusPaid.drafts, []);
  });
});
