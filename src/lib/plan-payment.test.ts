import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { changeKindNote, planAfterPayment, planOrderTitle } from "@/lib/plan-payment";

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-11-20T10:00:00.000Z");
const days = (n: number, from = NOW) => new Date(from.getTime() + n * DAY);

describe("оплата заказа тарифа 2026-10 → подписка аккаунта", () => {
  it("заказ прежней «Подписки» и пополнение — не тариф 2026-10 (продлевают по-старому)", () => {
    assert.equal(planAfterPayment({ order: { tariffKey: "monthly" }, currentEnd: null, now: NOW }), null);
    assert.equal(planAfterPayment({ order: { tariffKey: "balance_topup" }, currentEnd: null, now: NOW }), null);
  });

  it("новая подписка: срок с момента оплаты на ту же длину, что при оформлении", () => {
    const created = days(-2);
    const update = planAfterPayment({
      order: { tariffKey: "premium_year", points: 2, changeKind: "new", createdAt: created, periodEndsAt: days(365, created) },
      currentEnd: null,
      now: NOW,
    });
    assert.deepEqual(update, { tier: "premium", cycle: "year", points: 2, kind: "new", subscriptionEnd: days(365) });
  });

  it("продление: от текущего конца, а если он прошёл — с сегодня", () => {
    const active = planAfterPayment({ order: { tariffKey: "standard_month", changeKind: "renew" }, currentEnd: days(5), now: NOW });
    assert.equal(active?.subscriptionEnd.getTime(), days(35).getTime());
    const expired = planAfterPayment({ order: { tariffKey: "standard_month", changeKind: "renew" }, currentEnd: days(-1), now: NOW });
    assert.equal(expired?.subscriptionEnd.getTime(), days(30).getTime());
  });

  it("повышение: конец срока не меняется", () => {
    const update = planAfterPayment({
      order: { tariffKey: "premium_month", changeKind: "upgrade", createdAt: days(-1), periodEndsAt: days(14) },
      currentEnd: days(14),
      now: NOW,
    });
    assert.equal(update?.kind, "upgrade");
    assert.equal(update?.tier, "premium");
    assert.equal(update?.subscriptionEnd.getTime(), days(14).getTime());
  });

  it("повышение по счёту, оплаченному после конца срока: оставшиеся при оформлении дни — с сегодня", () => {
    const created = days(-20);
    const update = planAfterPayment({
      order: { tariffKey: "premium_month", changeKind: "upgrade", createdAt: created, periodEndsAt: days(12, created) },
      currentEnd: days(-8),
      now: NOW,
    });
    assert.equal(update?.subscriptionEnd.getTime(), days(12).getTime());
  });

  it("переход на год с зачётом остатка: новый срок с момента оплаты, включая дни из зачёта", () => {
    const created = days(-1);
    const update = planAfterPayment({
      order: { tariffKey: "standard_year", changeKind: "switch", createdAt: created, periodEndsAt: days(370, created) },
      currentEnd: days(9),
      now: NOW,
    });
    assert.equal(update?.subscriptionEnd.getTime(), days(370).getTime());
  });

  it("вид перехода не указан — продление; запланированный в заказе не бывает — тоже продление", () => {
    assert.equal(planAfterPayment({ order: { tariffKey: "standard_year" }, currentEnd: null, now: NOW })?.kind, "renew");
    assert.equal(planAfterPayment({ order: { tariffKey: "standard_year", changeKind: "scheduled" }, currentEnd: null, now: NOW })?.kind, "renew");
  });

  it("описание заказа", () => {
    assert.equal(planOrderTitle("standard", "year", 1), "Тариф «Стандарт» за год");
    assert.equal(planOrderTitle("premium", "month", 3), "Тариф «Премиум» на месяц, 3 точки");
    assert.equal(planOrderTitle("premium", "month", 5), "Тариф «Премиум» на месяц, 5 точек");
    assert.equal(changeKindNote("upgrade", { remainingDays: 17, creditRub: 0 }), "доплата за 17 дн. до конца оплаченного срока");
    assert.equal(changeKindNote("switch", { remainingDays: 9, creditRub: 1000 }), "зачтён остаток 1000 ₽");
    assert.equal(changeKindNote("new", { remainingDays: 0, creditRub: 0 }), null);
  });
});
