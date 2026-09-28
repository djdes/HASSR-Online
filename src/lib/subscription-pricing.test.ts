import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { FREE_MAX_USERS } from "@/lib/plan-limits";
import { EXTRA_USER_PRICE_RUB, SUBSCRIPTION_MAX_USERS } from "@/lib/plan-catalog";
import { pricingScaleRows, quoteSubscription } from "@/lib/subscription-pricing";

const BASE = 1990;

describe("quoteSubscription", () => {
  it("до FREE_MAX_USERS (1) — бесплатно, все суммы 0", () => {
    for (const n of [1, FREE_MAX_USERS]) {
      const q = quoteSubscription(n, BASE);
      assert.equal(q.isFree, true);
      assert.equal(q.baseRub, 0);
      assert.equal(q.extraEmployees, 0);
      assert.equal(q.extraRub, 0);
      assert.equal(q.monthlyRub, 0);
      assert.equal(q.yearlyRub, 0);
      assert.equal(q.tierLabel, "бесплатно");
    }
  });

  it("FREE_MAX_USERS + 1 (2) — только подписка, без доплаты", () => {
    const q = quoteSubscription(FREE_MAX_USERS + 1, BASE);
    assert.equal(q.isFree, false);
    assert.equal(q.baseRub, BASE);
    assert.equal(q.extraEmployees, 0);
    assert.equal(q.extraRub, 0);
    assert.equal(q.monthlyRub, BASE);
    assert.equal(q.tierLabel, "подписка");
  });

  it("SUBSCRIPTION_MAX_USERS (10) — граница подписки, доплаты ещё нет", () => {
    const q = quoteSubscription(SUBSCRIPTION_MAX_USERS, BASE);
    assert.equal(q.monthlyRub, BASE);
    assert.equal(q.extraEmployees, 0);
    assert.equal(q.tierLabel, "подписка");
  });

  it("SUBSCRIPTION_MAX_USERS + 1 (11) — подписка + одна доплата", () => {
    const q = quoteSubscription(SUBSCRIPTION_MAX_USERS + 1, BASE);
    assert.equal(q.extraEmployees, 1);
    assert.equal(q.extraRub, EXTRA_USER_PRICE_RUB);
    assert.equal(q.monthlyRub, BASE + EXTRA_USER_PRICE_RUB);
    assert.equal(q.tierLabel, `подписка + 1 сверх ${SUBSCRIPTION_MAX_USERS}`);
  });

  it("SUBSCRIPTION_MAX_USERS + 5 (15) — подписка + 5 доплат, год = ×12 без скидки", () => {
    const q = quoteSubscription(SUBSCRIPTION_MAX_USERS + 5, BASE);
    assert.equal(q.extraEmployees, 5);
    assert.equal(q.extraRub, 5 * EXTRA_USER_PRICE_RUB);
    assert.equal(q.monthlyRub, BASE + 5 * EXTRA_USER_PRICE_RUB);
    assert.equal(q.yearlyRub, q.monthlyRub * 12);
    assert.equal(q.tierLabel, `подписка + 5 сверх ${SUBSCRIPTION_MAX_USERS}`);
  });

  it("цена подписки берётся у вызывающего, а не зашита в модуль", () => {
    const q = quoteSubscription(10, 2500);
    assert.equal(q.baseRub, 2500);
    assert.equal(q.monthlyRub, 2500);
  });

  it("0, отрицательные и NaN — бесплатно", () => {
    for (const n of [0, -5, Number.NaN, Number.NEGATIVE_INFINITY]) {
      const q = quoteSubscription(n, BASE);
      assert.equal(q.isFree, true);
      assert.equal(q.employees, 0);
      assert.equal(q.monthlyRub, 0);
    }
  });

  it("дробное число сотрудников округляется вниз", () => {
    assert.equal(quoteSubscription(FREE_MAX_USERS + 0.9, BASE).isFree, true);
    assert.equal(quoteSubscription(4.2, BASE).employees, 4);
  });

  it("тариф 2026-10: 1 бесплатно, 2–10 за подписку, 11-й — доплата", () => {
    assert.equal(FREE_MAX_USERS, 1);
    assert.equal(SUBSCRIPTION_MAX_USERS, 10);
    assert.equal(quoteSubscription(1, BASE).monthlyRub, 0);
    assert.equal(quoteSubscription(2, BASE).monthlyRub, BASE);
    assert.equal(quoteSubscription(10, BASE).monthlyRub, BASE);
    assert.equal(quoteSubscription(11, BASE).monthlyRub, BASE + EXTRA_USER_PRICE_RUB);
  });
});

describe("pricingScaleRows", () => {
  it("три строки шкалы с константами модели", () => {
    const rows = pricingScaleRows(BASE);
    assert.equal(rows.length, 3);

    assert.equal(rows[0].range, "1 сотрудник");
    assert.equal(rows[0].price, "бесплатно");

    assert.equal(rows[1].range, `${FREE_MAX_USERS + 1}–${SUBSCRIPTION_MAX_USERS}`);
    assert.ok(rows[1].price.includes(BASE.toLocaleString("ru-RU")));
    assert.ok(rows[1].price.includes("за всю команду"));

    assert.equal(rows[2].range, `${SUBSCRIPTION_MAX_USERS + 1} и больше`);
    assert.ok(rows[2].price.includes(`+${EXTRA_USER_PRICE_RUB}`));
    assert.ok(rows[2].price.includes(`сверх ${SUBSCRIPTION_MAX_USERS}`));
  });
});
