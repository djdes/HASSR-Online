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
  hasPointsDiscount,
  isPaidTier,
  maxYearlySavingsPercent,
  needsIndividualOffer,
  normalizePoints,
  paidTierFromPlan,
  parsePlanTariffKey,
  parseScheduledPlan,
  planMonthlyRub,
  planPeriodFullRub,
  planPeriodPriceRub,
  planPointMonthlyRub,
  planTariffKey,
  pointsDiscountPercent,
  pointsEffectiveDiscountPercent,
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

describe("цены тарифов (владелец, 2026-11-05)", () => {
  it("Стандарт: 2 990 ₽ помесячно, 1 990 ₽/мес за год; Премиум: 4 990 и 3 990; ВИП: 12 990 и 8 990", () => {
    assert.equal(planPeriodPriceRub(R, "standard", "month"), 2990);
    assert.equal(planPeriodPriceRub(R, "standard", "year"), 23_880);
    assert.equal(planMonthlyRub(R, "standard", "year"), 1990);
    assert.equal(planPeriodPriceRub(R, "premium", "month"), 4990);
    assert.equal(planPeriodPriceRub(R, "premium", "year"), 47_880);
    assert.equal(planMonthlyRub(R, "premium", "year"), 3990);
    assert.equal(planPeriodPriceRub(R, "vip", "month"), 12_990);
    assert.equal(planPeriodPriceRub(R, "vip", "year"), 107_880);
    assert.equal(planMonthlyRub(R, "vip", "year"), 8990);
  });

  it("выгода годовой оплаты: Стандарт 33 %, Премиум 20 %, ВИП 31 %", () => {
    assert.equal(yearlySavingsPercent(R, "standard"), 33);
    assert.equal(yearlySavingsPercent(R, "premium"), 20);
    assert.equal(yearlySavingsPercent(R, "vip"), 31);
    assert.equal(maxYearlySavingsPercent(R), 33);
    assert.equal(yearlySavingsRub(R, "standard"), 35_880 - 23_880);
    assert.equal(yearlySavingsRub(R, "vip"), 155_880 - 107_880);
  });

  it("скидка за точки ступенчатая: 5+ → 5 %, 10+ → 10 %, 15+ → 20 %, 35+ → 25 %", () => {
    const cases: Array<[number, number]> = [
      [1, 0],
      [4, 0],
      [5, 5],
      [9, 5],
      [10, 10],
      [14, 10],
      [15, 20],
      [34, 20],
      [35, 25],
      [49, 25],
      [50, 25],
    ];
    for (const [points, percent] of cases) {
      assert.equal(pointsDiscountPercent(points), percent, `${points} точек`);
      assert.equal(hasPointsDiscount(points), percent > 0, `${points} точек`);
    }
    // Ввод нормализуется так же, как число точек в заказе.
    assert.equal(pointsDiscountPercent(0), 0);
    assert.equal(pointsDiscountPercent(9.9), 5);
  });

  it("от 50 точек — индивидуальное предложение", () => {
    assert.equal(needsIndividualOffer(1), false);
    assert.equal(needsIndividualOffer(49), false);
    assert.equal(needsIndividualOffer(50), true);
    assert.equal(needsIndividualOffer(MAX_POINTS), true);
    assert.equal(needsIndividualOffer(10_000), true);
  });

  it("каждая точка — как ещё один тариф, скидка — на все точки заказа", () => {
    assert.equal(pointsFactor(1), 1);
    assert.equal(pointsFactor(2), 2);
    assert.equal(pointsFactor(4), 4);
    assert.equal(pointsFactor(5), 4.75);
    assert.equal(pointsFactor(9), 8.55);
    assert.equal(pointsFactor(10), 9);
    // Перед ступенью цена дотянута до неё: 14 точек не дороже 15, 33–34 — не дороже 35.
    assert.equal(pointsFactor(13), 11.7);
    assert.equal(pointsFactor(14), 12);
    assert.equal(pointsFactor(15), 12);
    assert.equal(pointsFactor(32), 25.6);
    assert.equal(pointsFactor(33), 26.25);
    assert.equal(pointsFactor(34), 26.25);
    assert.equal(pointsFactor(35), 26.25);
    assert.equal(pointsFactor(49), 36.75);
    assert.equal(planPeriodPriceRub(R, "standard", "month", 2), 5980);
    assert.equal(planPeriodPriceRub(R, "standard", "month", 4), 11_960);
    // 2 990 × 4,75 = 14 202,5 → 14 203.
    assert.equal(planPeriodPriceRub(R, "standard", "month", 5), 14_203);
    assert.equal(planPeriodFullRub(R, "standard", "month", 5), 14_950);
    assert.equal(planPeriodPriceRub(R, "premium", "year", 10), 430_920);
    assert.equal(planMonthlyRub(R, "premium", "year", 10), 35_910);
    assert.equal(planPeriodPriceRub(R, "vip", "month", 35), Math.round(12_990 * 26.25));
  });

  it("больше точек никогда не дешевле меньшего числа (до индивидуального предложения)", () => {
    for (const tier of ["standard", "premium", "vip"] as const) {
      for (const cycle of ["month", "year"] as const) {
        for (let n = 1; n < 50; n += 1) {
          assert.ok(
            planPeriodPriceRub(R, tier, cycle, n) <= planPeriodPriceRub(R, tier, cycle, n + 1),
            `${tier}/${cycle}: ${n} точек не дороже ${n + 1}`,
          );
        }
      }
    }
  });

  it("фактическая скидка — по шкале, перед ступенью больше", () => {
    assert.equal(pointsEffectiveDiscountPercent(1), 0);
    assert.equal(pointsEffectiveDiscountPercent(5), 5);
    assert.equal(pointsEffectiveDiscountPercent(10), 10);
    assert.equal(pointsEffectiveDiscountPercent(13), 10);
    // 14 точек по цене 15: 1 − 12 / 14 = 14,3 %.
    assert.equal(pointsEffectiveDiscountPercent(14), 14);
    assert.equal(pointsEffectiveDiscountPercent(15), 20);
    assert.equal(pointsEffectiveDiscountPercent(34), 23);
    assert.equal(pointsEffectiveDiscountPercent(35), 25);
    assert.equal(pointsEffectiveDiscountPercent(49), 25);
  });

  it("цена одной точки в месяц — со скидкой за точки, целые рубли", () => {
    assert.equal(planPointMonthlyRub(R, "standard", "month", 1), 2990);
    assert.equal(planPointMonthlyRub(R, "standard", "month", 4), 2990);
    // 10 точек помесячно: 2 990 × 0,9 = 2 691 (итог — 26 910 ₽ в месяц).
    assert.equal(planPointMonthlyRub(R, "standard", "month", 10), 2691);
    assert.equal(planPointMonthlyRub(R, "standard", "month", 10) * 10, planPeriodPriceRub(R, "standard", "month", 10));
    // 14 точек — по цене 15: 2 990 × 12 / 14 = 2 562,9 → 2 563.
    assert.equal(planPointMonthlyRub(R, "standard", "month", 14), 2563);
    // 1 990 × 0,95 = 1 890,5 → 1 891 (без потери на дробях).
    assert.equal(planPointMonthlyRub(R, "standard", "year", 5), 1891);
    assert.equal(planPointMonthlyRub(R, "standard", "year", 14), 1706);
    assert.equal(planPointMonthlyRub(R, "standard", "month", 15), 2392);
    assert.equal(planPointMonthlyRub(R, "premium", "year", 3), 3990);
    assert.equal(planPointMonthlyRub(R, "premium", "month", 14), 4277);
    // 12 990 × 0,75 = 9 742,5 → 9 743.
    assert.equal(planPointMonthlyRub(R, "vip", "month", 35), 9743);
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
    assert.equal(planTariffKey("vip", "month"), "vip_month");
    assert.deepEqual(parsePlanTariffKey("vip_year"), { tier: "vip", cycle: "year" });
    assert.equal(isPaidTier("vip"), true);
    assert.equal(isPaidTier("gold"), false);
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

  it("Премиум — 40 сотрудников на точку, 1 ГБ, автоввод с фото, оборудование, типовой пакет, «Меркурий»", () => {
    const e = entitlementsFor("premium", 1);
    assert.equal(e.seatLimit, 40);
    assert.equal(entitlementsFor("premium", 3).seatLimit, 120);
    assert.equal(e.storageBytes, 1024 * 1024 * 1024);
    assert.deepEqual(e.features, {
      photoAutofill: true,
      equipmentConnect: true,
      equipmentDelivery: true,
      typicalPackage: true,
      mercury: true,
    });
  });

  it("ВИП — лимиты и возможности как у Премиума", () => {
    const e = entitlementsFor("vip", 2);
    const premium = entitlementsFor("premium", 2);
    assert.equal(e.tier, "vip");
    assert.equal(SEATS_PER_POINT.vip, 40);
    assert.equal(e.seatLimit, 80);
    assert.equal(e.pointLimit, 2);
    assert.equal(e.journalLimit, null);
    assert.equal(e.storageBytes, 1024 * 1024 * 1024);
    assert.deepEqual(e.features, premium.features);
    assert.equal(seatLimitFor("vip", 3), 120);
  });

  it("места кончились — следующий тариф, а не точка; у «Премиума» — по согласованию", () => {
    assert.equal(seatUpgradeTarget("free"), "standard");
    assert.equal(seatUpgradeTarget("standard"), "premium");
    assert.equal(seatUpgradeTarget("premium"), null);
    assert.equal(seatUpgradeTarget("vip"), null);
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
    assert.equal(paidTierFromPlan("vip"), "vip");
  });

  it("точки в работе: организация без зданий — одна точка", () => {
    assert.equal(countPointsInUse([0]), 1);
    assert.equal(countPointsInUse([3]), 3);
    assert.equal(countPointsInUse([0, 2, 1]), 4);
    assert.equal(seatLimitFor("standard", 3), 75);
    assert.equal(seatLimitFor("premium", 2), 80);
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
    assert.equal(q.amountRub, 2990);
  });

  it("тот же тариф — продление от текущего конца", () => {
    const end = days(10);
    const q = quote(standardMonth(end), { tier: "standard", cycle: "month", points: 1 });
    assert.equal(q.kind, "renew");
    assert.equal(q.amountRub, 2990);
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

  it("с 4 до 5 точек — разница уже со скидкой 5 % на все точки", () => {
    const q = quote(standardMonth(days(30), 4), { tier: "standard", cycle: "month", points: 5 });
    assert.equal(q.kind, "upgrade");
    assert.equal(q.differenceRub, 14_203 - 11_960);
    assert.equal(q.amountRub, 2243);
  });

  it("Премиум → ВИП в середине месяца: доплата за оставшиеся дни; ВИП → Премиум — с конца срока", () => {
    const end = days(15);
    const premiumMonth: CurrentSubscription = { paidUntil: end, tier: "premium", cycle: "month", points: 1 };
    const up = quote(premiumMonth, { tier: "vip", cycle: "month", points: 1 });
    assert.equal(up.kind, "upgrade");
    assert.equal(up.differenceRub, 12_990 - 4990);
    assert.equal(up.amountRub, 4000);
    assert.equal(up.periodEnd.getTime(), end.getTime());

    const down = quote({ ...premiumMonth, tier: "vip" }, { tier: "premium", cycle: "month", points: 1 });
    assert.equal(down.kind, "scheduled");
    assert.equal(down.amountRub, 0);
    assert.equal(down.periodStart.getTime(), end.getTime());
  });

  it("помесячно → за год: цена года минус неиспользованный остаток, новый срок с сегодня", () => {
    const q = quote(standardMonth(days(10)), { tier: "premium", cycle: "year", points: 1 });
    assert.equal(q.kind, "switch");
    // Остаток: 2 990 × 10/30 = 996,67 → 997 ₽.
    assert.equal(q.creditRub, 997);
    assert.equal(q.amountRub, 47_880 - 997);
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
    assert.equal(q.amountRub, 2990 - 995);
  });

  it("остаток дороже нового периода — лишнее продлевает срок, к оплате 0", () => {
    const q = quote({ paidUntil: days(60), tier: "legacy", cycle: "month", points: 1 }, { tier: "standard", cycle: "month", points: 1 });
    assert.equal(q.kind, "switch");
    // Остаток: 1 990 × 60/30 = 3 980 ₽ при цене месяца 2 990 ₽.
    assert.equal(q.amountRub, 0);
    assert.equal(q.creditRub, 2990);
    assert.equal(q.periodEnd.getTime(), NOW.getTime() + 30 * DAY + Math.round(((3980 - 2990) / 2990) * (30 * DAY)));
  });

  it("меньше суток до конца — новая подписка, а не доплата в 0 ₽", () => {
    const q = quote(standardMonth(new Date(NOW.getTime() + 3 * 60 * 60 * 1000)), { tier: "premium", cycle: "month", points: 1 });
    assert.equal(q.kind, "new");
    assert.equal(q.amountRub, 4990);
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
