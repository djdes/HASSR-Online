import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_PLAN_RATES,
  MAX_POINTS,
  SEATS_PER_POINT,
  STORAGE_BYTES,
  TRIAL_DAYS,
  countPointsInUse,
  entitlementsFor,
  maxYearlySavingsPercent,
  normalizePoints,
  paidTierFromPlan,
  parsePlanTariffKey,
  parseScheduledPlan,
  planMonthlyRub,
  planPeriodFullRub,
  planPeriodPriceRub,
  planTariffKey,
  pointsFactor,
  quotePlanChange,
  resolvePlanTariffKey,
  seatLimitFor,
  seatUpgradeTarget,
  tierForHeadcount,
  yearlySavingsPercent,
  yearlySavingsRub,
  type CurrentSubscription,
  type PlanTarget,
} from "@/lib/tariff-plans";

const R = DEFAULT_PLAN_RATES;
const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-10-26T09:00:00.000Z");
const days = (n: number) => new Date(NOW.getTime() + n * DAY);

function quote(current: CurrentSubscription | null, target: PlanTarget) {
  return quotePlanChange({ rates: R, legacyMonthlyRub: 1990, current, target, now: NOW });
}

describe("цены тарифов (владелец, 2026-10)", () => {
  it("Стандарт: 3 000 ₽ помесячно, 1 990 ₽/мес за год; Премиум: 5 000 и 3 990", () => {
    assert.equal(planPeriodPriceRub(R, "standard", "month"), 3000);
    assert.equal(planPeriodPriceRub(R, "standard", "year"), 23_880);
    assert.equal(planMonthlyRub(R, "standard", "year"), 1990);
    assert.equal(planPeriodPriceRub(R, "premium", "month"), 5000);
    assert.equal(planPeriodPriceRub(R, "premium", "year"), 47_880);
    assert.equal(planMonthlyRub(R, "premium", "year"), 3990);
  });

  it("выгода годовой оплаты: Стандарт 34 %, Премиум 20 %", () => {
    assert.equal(yearlySavingsPercent(R, "standard"), 34);
    assert.equal(yearlySavingsPercent(R, "premium"), 20);
    assert.equal(maxYearlySavingsPercent(R), 34);
    assert.equal(yearlySavingsRub(R, "standard"), 36_000 - 23_880);
  });

  it("каждая точка — как ещё один тариф, от 3 точек минус 5 % на каждую", () => {
    assert.equal(pointsFactor(1), 1);
    assert.equal(pointsFactor(2), 2);
    assert.equal(pointsFactor(3), 2.85);
    assert.equal(pointsFactor(10), 9.5);
    assert.equal(planPeriodPriceRub(R, "standard", "month", 2), 6000);
    assert.equal(planPeriodPriceRub(R, "standard", "month", 3), 8550);
    assert.equal(planPeriodFullRub(R, "standard", "month", 3), 9000);
    assert.equal(planPeriodPriceRub(R, "premium", "year", 3), 136_458);
    assert.equal(planMonthlyRub(R, "premium", "year", 3), 11_372);
  });

  it("число точек — целое от 1 до 50", () => {
    assert.equal(normalizePoints("3"), 3);
    assert.equal(normalizePoints(0), 1);
    assert.equal(normalizePoints(-4), 1);
    assert.equal(normalizePoints(2.7), 2);
    assert.equal(normalizePoints("abc"), 1);
    assert.equal(normalizePoints(999), MAX_POINTS);
  });

  it("ключи тарифов и старые ключи", () => {
    assert.equal(planTariffKey("premium", "year"), "premium_year");
    assert.deepEqual(parsePlanTariffKey("standard_month"), { tier: "standard", cycle: "month" });
    assert.equal(parsePlanTariffKey("monthly"), null);
    assert.equal(parsePlanTariffKey("balance_topup"), null);
    assert.equal(parsePlanTariffKey("premium_year_x"), null);
    assert.equal(resolvePlanTariffKey("monthly"), "standard_month");
    assert.equal(resolvePlanTariffKey("bundle"), "premium_month");
    assert.equal(resolvePlanTariffKey("premium_year"), "premium_year");
  });
});

describe("лимиты и возможности", () => {
  it("пробный — без ограничений, всё как в Премиуме", () => {
    const e = entitlementsFor("trial");
    assert.equal(e.seatLimit, null);
    assert.equal(e.pointLimit, null);
    assert.equal(e.journalLimit, null);
    assert.equal(e.storageBytes, STORAGE_BYTES.premium);
    assert.equal(Object.values(e.features).every(Boolean), true);
    assert.equal(TRIAL_DAYS, 14);
  });

  it("бесплатный после пробного — 1 сотрудник, 1 журнал, 1 точка, без загрузок и без Премиума", () => {
    const e = entitlementsFor("free");
    assert.deepEqual([e.seatLimit, e.journalLimit, e.pointLimit, e.storageBytes], [1, 1, 1, 0]);
    assert.equal(Object.values(e.features).some(Boolean), false);
  });

  it("Стандарт — 25 сотрудников на точку, 10 МБ, без возможностей Премиума", () => {
    const e = entitlementsFor("standard", 2);
    assert.equal(e.seatLimit, 2 * SEATS_PER_POINT.standard);
    assert.equal(e.seatLimit, 50);
    assert.equal(e.pointLimit, 2);
    assert.equal(e.journalLimit, null);
    assert.equal(e.storageBytes, 10 * 1024 * 1024);
    assert.equal(Object.values(e.features).some(Boolean), false);
  });

  it("Премиум — 100 сотрудников на точку, 1 ГБ, автоввод с фото, оборудование, типовой пакет, «Меркурий»", () => {
    const e = entitlementsFor("premium", 1);
    assert.equal(e.seatLimit, 100);
    assert.equal(entitlementsFor("premium", 3).seatLimit, 300);
    assert.equal(e.storageBytes, 1024 * 1024 * 1024);
    assert.deepEqual(e.features, {
      photoAutofill: true,
      equipmentConnect: true,
      equipmentDelivery: true,
      typicalPackage: true,
      mercury: true,
    });
  });

  it("места кончились — следующий тариф, а не точка; у «Премиума» — по согласованию", () => {
    assert.equal(seatUpgradeTarget("free"), "standard");
    assert.equal(seatUpgradeTarget("standard"), "premium");
    assert.equal(seatUpgradeTarget("premium"), null);
    assert.equal(seatUpgradeTarget("trial"), null);
    assert.equal(tierForHeadcount(1), "standard");
    assert.equal(tierForHeadcount(25), "standard");
    assert.equal(tierForHeadcount(26), "premium");
    assert.equal(tierForHeadcount(120), "premium");
  });

  it("прежняя «Подписка» — как раньше: без новых лимитов, с возможностями", () => {
    const e = entitlementsFor("legacy_paid");
    assert.equal(e.seatLimit, null);
    assert.equal(e.pointLimit, null);
    assert.equal(e.features.photoAutofill, true);
    assert.equal(paidTierFromPlan("paid"), "legacy");
    assert.equal(paidTierFromPlan("premium"), "premium");
  });

  it("точки в работе: организация без зданий — одна точка", () => {
    assert.equal(countPointsInUse([0]), 1);
    assert.equal(countPointsInUse([3]), 3);
    assert.equal(countPointsInUse([0, 2, 1]), 4);
    assert.equal(seatLimitFor("standard", 3), 75);
    assert.equal(seatLimitFor("premium", 2), 200);
  });
});

describe("переход с тарифа на тариф — суммы", () => {
  const standardMonth = (paidUntil: Date, points = 1): CurrentSubscription => ({ paidUntil, tier: "standard", cycle: "month", points });

  it("без подписки — новая, полная цена, срок с сегодня", () => {
    const q = quote(null, { tier: "premium", cycle: "year", points: 1 });
    assert.equal(q.kind, "new");
    assert.equal(q.amountRub, 47_880);
    assert.equal(q.periodStart.getTime(), NOW.getTime());
    assert.equal(q.periodEnd.getTime(), days(365).getTime());
  });

  it("срок истёк — тоже новая подписка", () => {
    const q = quote(standardMonth(days(-3)), { tier: "standard", cycle: "month", points: 1 });
    assert.equal(q.kind, "new");
    assert.equal(q.amountRub, 3000);
  });

  it("тот же тариф — продление от текущего конца", () => {
    const end = days(10);
    const q = quote(standardMonth(end), { tier: "standard", cycle: "month", points: 1 });
    assert.equal(q.kind, "renew");
    assert.equal(q.amountRub, 3000);
    assert.equal(q.periodStart.getTime(), end.getTime());
    assert.equal(q.periodEnd.getTime(), end.getTime() + 30 * DAY);
  });

  it("Стандарт → Премиум в середине месяца: доплата за оставшиеся дни, конец не меняется", () => {
    const end = days(15);
    const q = quote(standardMonth(end), { tier: "premium", cycle: "month", points: 1 });
    assert.equal(q.kind, "upgrade");
    assert.equal(q.differenceRub, 2000);
    assert.equal(q.amountRub, 1000);
    assert.equal(q.remainingDays, 15);
    assert.equal(q.periodEnd.getTime(), end.getTime());
  });

  it("добавить точку посреди года: доплата за точку на остаток", () => {
    const end = days(73);
    const q = quote({ paidUntil: end, tier: "standard", cycle: "year", points: 1 }, { tier: "standard", cycle: "year", points: 2 });
    assert.equal(q.kind, "upgrade");
    assert.equal(q.differenceRub, 23_880);
    assert.equal(q.amountRub, Math.round((23_880 * 73) / 365));
  });

  it("с 2 до 3 точек — разница уже со скидкой 5 % на каждую", () => {
    const q = quote(standardMonth(days(30), 2), { tier: "standard", cycle: "month", points: 3 });
    assert.equal(q.kind, "upgrade");
    assert.equal(q.differenceRub, 8550 - 6000);
    assert.equal(q.amountRub, 2550);
  });

  it("помесячно → за год: цена года минус неиспользованный остаток, новый срок с сегодня", () => {
    const q = quote(standardMonth(days(10)), { tier: "premium", cycle: "year", points: 1 });
    assert.equal(q.kind, "switch");
    assert.equal(q.creditRub, 1000);
    assert.equal(q.amountRub, 47_880 - 1000);
    assert.equal(q.periodEnd.getTime(), days(365).getTime());
  });

  it("понижение (Премиум → Стандарт, меньше точек, год → месяц) — с конца срока, сейчас 0 ₽", () => {
    const end = days(40);
    const premiumYear: CurrentSubscription = { paidUntil: end, tier: "premium", cycle: "year", points: 2 };
    for (const target of [
      { tier: "standard", cycle: "year", points: 2 },
      { tier: "premium", cycle: "year", points: 1 },
      { tier: "premium", cycle: "month", points: 2 },
      { tier: "standard", cycle: "month", points: 1 },
    ] as PlanTarget[]) {
      const q = quote(premiumYear, target);
      assert.equal(q.kind, "scheduled", JSON.stringify(target));
      assert.equal(q.amountRub, 0);
      assert.equal(q.periodStart.getTime(), end.getTime());
    }
  });

  it("с прежней «Подписки» — сразу, с зачётом остатка по 1 990 ₽ за 30 дней", () => {
    const q = quote({ paidUntil: days(15), tier: "legacy", cycle: "month", points: 1 }, { tier: "standard", cycle: "month", points: 1 });
    assert.equal(q.kind, "switch");
    assert.equal(q.creditRub, 995);
    assert.equal(q.amountRub, 3000 - 995);
  });

  it("остаток дороже нового периода — лишнее продлевает срок, к оплате 0", () => {
    const q = quote({ paidUntil: days(60), tier: "legacy", cycle: "month", points: 1 }, { tier: "standard", cycle: "month", points: 1 });
    assert.equal(q.kind, "switch");
    // Остаток: 1 990 × 60/30 = 3 980 ₽ при цене месяца 3 000 ₽.
    assert.equal(q.amountRub, 0);
    assert.equal(q.creditRub, 3000);
    assert.equal(q.periodEnd.getTime(), days(30 + (980 / 3000) * 30).getTime());
  });

  it("меньше суток до конца — новая подписка, а не доплата в 0 ₽", () => {
    const q = quote(standardMonth(new Date(NOW.getTime() + 3 * 60 * 60 * 1000)), { tier: "premium", cycle: "month", points: 1 });
    assert.equal(q.kind, "new");
    assert.equal(q.amountRub, 5000);
  });
});

describe("запланированный переход", () => {
  it("читается из JSON, битое — null", () => {
    assert.deepEqual(parseScheduledPlan({ tier: "standard", cycle: "month", points: 2, at: "2026-11-30T00:00:00.000Z" }), {
      tier: "standard",
      cycle: "month",
      points: 2,
      at: "2026-11-30T00:00:00.000Z",
    });
    assert.equal(parseScheduledPlan({ tier: "gold", cycle: "month", at: "2026-11-30" }), null);
    assert.equal(parseScheduledPlan(null), null);
    assert.equal(parseScheduledPlan({ tier: "premium", cycle: "year" }), null);
  });
});
