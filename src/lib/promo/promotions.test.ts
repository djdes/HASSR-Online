import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  applyPromotion,
  computeCheckoutAmounts,
  dateToMskInput,
  describePromotion,
  describePromotionChange,
  formatMskDateTime,
  mskInputToDate,
  orderDiscountNote,
  pickActivePromotion,
  promotionBadgeLabel,
  promotionEndHint,
  promotionEndLabel,
  promotionPhase,
  toAppliedPromotion,
  validatePromotionInput,
  type PromotionWindow,
} from "@/lib/promo/promotions";

/** Время в тестах задаём по Москве — как вводит ROOT. */
const msk = (value: string): Date => {
  const date = mskInputToDate(value);
  if (!date) throw new Error(`bad msk ${value}`);
  return date;
};

const rule = (over: Partial<PromotionWindow> = {}): PromotionWindow => ({
  id: "p1",
  title: "Осень",
  percent: 20,
  startsAt: msk("2026-10-01T00:00"),
  endsAt: msk("2026-10-11T00:00"),
  active: true,
  ...over,
});

const NOW = msk("2026-10-05T12:00");
const normalize = (s: string) => s.replace(/[\u00a0\u202f]/g, " ");

describe("pickActivePromotion", () => {
  it("нет акций / выключенная / будущая / прошедшая — null", () => {
    assert.equal(pickActivePromotion([], NOW), null);
    assert.equal(pickActivePromotion([rule({ active: false })], NOW), null);
    assert.equal(pickActivePromotion([rule({ startsAt: msk("2026-10-06T00:00") })], NOW), null);
    assert.equal(pickActivePromotion([rule({ endsAt: msk("2026-10-05T11:59") })], NOW), null);
  });

  it("одна идущая акция — она", () => {
    assert.equal(pickActivePromotion([rule()], NOW)?.id, "p1");
  });

  it("пересечение — наибольший процент; равные — та, что кончается позже", () => {
    const small = rule({ id: "small", percent: 10 });
    const big = rule({ id: "big", percent: 25, endsAt: msk("2026-10-07T00:00") });
    const future = rule({ id: "future", percent: 50, startsAt: msk("2026-10-09T00:00") });
    const off = rule({ id: "off", percent: 90, active: false });
    assert.equal(pickActivePromotion([small, big, future, off], NOW)?.id, "big");

    const early = rule({ id: "early", percent: 20, endsAt: msk("2026-10-08T00:00") });
    const late = rule({ id: "late", percent: 20, endsAt: msk("2026-10-20T00:00") });
    assert.equal(pickActivePromotion([early, late], NOW)?.id, "late");
    assert.equal(pickActivePromotion([late, early], NOW)?.id, "late");
  });

  it("граница: начало включительно, конец — нет", () => {
    const r = rule();
    assert.equal(pickActivePromotion([r], r.startsAt)?.id, "p1");
    assert.equal(pickActivePromotion([r], new Date(r.startsAt.getTime() - 1)), null);
    assert.equal(pickActivePromotion([r], new Date(r.endsAt.getTime() - 1))?.id, "p1");
    assert.equal(pickActivePromotion([r], r.endsAt), null);
  });
});

describe("promotionPhase", () => {
  it("запланирована / идёт / завершена", () => {
    const r = rule();
    assert.equal(promotionPhase(r, msk("2026-09-30T23:59")), "scheduled");
    assert.equal(promotionPhase(r, r.startsAt), "running");
    assert.equal(promotionPhase(r, r.endsAt), "finished");
  });
});

describe("applyPromotion", () => {
  const p20 = toAppliedPromotion(rule());
  it("−20 % от 1 990 — 1 592, целые рубли", () => {
    assert.deepEqual(applyPromotion(1990, p20), {
      baseRub: 1990,
      priceRub: 1592,
      discountRub: 398,
      promotion: p20,
    });
  });
  it("округление — как у промокода: скидка округляется, цена = база − скидка", () => {
    const p15 = toAppliedPromotion(rule({ percent: 15 }));
    // 1990 × 15 % = 298,5 → скидка 299 → цена 1691.
    assert.equal(applyPromotion(1990, p15).discountRub, 299);
    assert.equal(applyPromotion(1990, p15).priceRub, 1691);
    const p33 = toAppliedPromotion(rule({ percent: 33 }));
    assert.equal(applyPromotion(2490, p33).priceRub, 2490 - Math.round(2490 * 0.33));
  });
  it("без акции — цена как есть; ноль и мусор — ноль", () => {
    assert.deepEqual(applyPromotion(1990, null), { baseRub: 1990, priceRub: 1990, discountRub: 0, promotion: null });
    assert.equal(applyPromotion(0, p20).priceRub, 0);
    assert.equal(applyPromotion(0, p20).promotion, null);
    assert.equal(applyPromotion(Number.NaN, p20).priceRub, 0);
    assert.equal(applyPromotion(-5, p20).priceRub, 0);
  });
  it("процент вне 1–90 не даёт больше 90 % скидки", () => {
    const crazy = { ...p20, percent: 150 };
    assert.equal(applyPromotion(1000, crazy).priceRub, 100);
  });
});

describe("computeCheckoutAmounts — сумма заказа", () => {
  const p20 = toAppliedPromotion(rule());
  it("без акции и промокода — база", () => {
    const a = computeCheckoutAmounts({ baseRub: 1990, promotion: null, promo: null });
    assert.equal(a.offerRub, 1990);
    assert.equal(a.subscriptionRub, 1990);
    assert.equal(a.grossRub, 1990);
    assert.equal(a.promotionDiscountRub, 0);
    assert.equal(a.promoDiscountRub, 0);
  });
  it("акция −20 % + промокод −10 % считается от цены с акцией", () => {
    const a = computeCheckoutAmounts({ baseRub: 1990, promotion: p20, promo: { kind: "percent", value: 10 } });
    assert.equal(a.offerRub, 1592);
    assert.equal(a.promotionDiscountRub, 398);
    assert.equal(a.promoDiscountRub, 159); // 1592 × 10 % = 159,2
    assert.equal(a.subscriptionRub, 1433);
    assert.equal(a.grossRub, 1433);
  });
  it("фиксированный промокод поверх акции", () => {
    const a = computeCheckoutAmounts({ baseRub: 1990, promotion: p20, promo: { kind: "fixed", value: 500 } });
    assert.equal(a.subscriptionRub, 1092);
  });
  it("промокод не опускает подписку ниже нуля", () => {
    const fixed = computeCheckoutAmounts({ baseRub: 1990, promotion: p20, promo: { kind: "fixed", value: 5000 } });
    assert.equal(fixed.promoDiscountRub, 1592);
    assert.equal(fixed.subscriptionRub, 0);
    const full = computeCheckoutAmounts({ baseRub: 1990, promotion: p20, promo: { kind: "percent", value: 100 } });
    assert.equal(full.subscriptionRub, 0);
    assert.equal(full.grossRub, 0);
  });
  it("оборудование прибавляется без скидок", () => {
    const a = computeCheckoutAmounts({
      baseRub: 1990,
      promotion: p20,
      promo: { kind: "percent", value: 10 },
      hardwareRub: 7490,
    });
    assert.equal(a.hardwareRub, 7490);
    assert.equal(a.grossRub, 1433 + 7490);
  });
});

describe("время по Москве", () => {
  it("ввод ROOT → UTC и обратно", () => {
    assert.equal(msk("2026-10-01T00:00").toISOString(), "2026-09-30T21:00:00.000Z");
    assert.equal(dateToMskInput(new Date("2026-09-30T21:00:00.000Z")), "2026-10-01T00:00");
    assert.equal(dateToMskInput(msk("2026-12-31T23:59")), "2026-12-31T23:59");
    assert.equal(formatMskDateTime(new Date("2026-10-10T20:59:00.000Z")), "10.10.2026, 23:59");
  });
  it("мусор не парсится", () => {
    assert.equal(mskInputToDate(""), null);
    assert.equal(mskInputToDate("2026-13-01T00:00"), null);
    assert.equal(mskInputToDate("2026-02-30T00:00"), null);
    assert.equal(mskInputToDate("завтра"), null);
  });
});

describe("подпись плашки", () => {
  it("конец в полночь — последний день акции без времени", () => {
    assert.equal(normalize(promotionEndLabel(msk("2026-10-11T00:00"))), "до 10 октября");
    assert.equal(normalize(promotionEndLabel(msk("2026-10-10T23:59"))), "до 10 октября");
    assert.equal(normalize(promotionEndLabel(msk("2026-10-10T18:00"))), "до 10 октября, 18:00");
    assert.equal(normalize(promotionEndLabel(msk("2027-01-01T00:00"))), "до 31 декабря");
  });
  it("подсказка с точным концом — в тон плашке", () => {
    assert.equal(promotionEndHint({ endsAt: msk("2026-10-11T00:00").toISOString() }), "Акция действует до 10.10.2026, 23:59 по Москве");
    assert.equal(promotionEndHint({ endsAt: msk("2026-10-10T18:30").toISOString() }), "Акция действует до 10.10.2026, 18:30 по Москве");
  });
  it("−N % до <дата>", () => {
    const applied = toAppliedPromotion(rule({ percent: 25 }));
    assert.equal(normalize(promotionBadgeLabel(applied)), "−25 % до 10 октября");
  });
  it("примечание к заказу: акция и промокод", () => {
    const applied = toAppliedPromotion(rule());
    assert.equal(
      normalize(orderDiscountNote({ promotion: applied, promotionDiscountRub: 398, promoCode: null, promoDiscountRub: 0 })),
      "акция «Осень» −20 %",
    );
    assert.equal(
      normalize(orderDiscountNote({ promotion: applied, promotionDiscountRub: 398, promoCode: "START10", promoDiscountRub: 159 })),
      "акция «Осень» −20 %; промокод START10: −159 ₽",
    );
    assert.equal(orderDiscountNote({ promotion: null, promotionDiscountRub: 0, promoCode: null, promoDiscountRub: 0 }), "");
  });

  it("скидка навсегда: введённый код и применившаяся сама", () => {
    const applied = toAppliedPromotion(rule());
    assert.equal(
      normalize(orderDiscountNote({ promotion: null, promotionDiscountRub: 0, promoCode: "ROMASHKA10", promoDiscountRub: 199, lifetime: "code" })),
      "промокод ROMASHKA10, скидка навсегда: −199 ₽",
    );
    assert.equal(
      normalize(orderDiscountNote({ promotion: applied, promotionDiscountRub: 398, promoCode: "ROMASHKA10", promoDiscountRub: 159, lifetime: "auto" })),
      "акция «Осень» −20 %; скидка навсегда по промокоду ROMASHKA10: −159 ₽",
    );
  });
});

describe("describePromotionChange — аудит ROOT", () => {
  const before = { title: "Осень", percent: 20, startsAt: msk("2026-10-01T00:00"), endsAt: msk("2026-10-11T00:00"), active: true, note: null };
  it("перечисляет изменения по-русски, время по Москве", () => {
    assert.equal(
      describePromotionChange(before, { ...before, percent: 25, endsAt: msk("2026-10-15T00:00"), active: false }),
      "скидка 20 → 25 %; конец 11.10.2026, 00:00 → 15.10.2026, 00:00; выключена",
    );
    assert.equal(describePromotionChange(before, { ...before }), "без изменений");
    assert.equal(describePromotion(before), "−20 % · 01.10.2026, 00:00 — 11.10.2026, 00:00 МСК");
  });
});

describe("validatePromotionInput", () => {
  const good = {
    title: "  Осень  ",
    percent: 20,
    startsAt: msk("2026-10-01T00:00"),
    endsAt: msk("2026-10-11T00:00"),
    note: "",
  };
  it("нормальная акция проходит, название обрезается", () => {
    const res = validatePromotionInput(good);
    assert.equal(res.ok, true);
    if (res.ok) assert.equal(res.value.title, "Осень");
  });
  it("процент 1–90, целый", () => {
    for (const percent of [0, 91, 12.5, Number.NaN]) {
      assert.equal(validatePromotionInput({ ...good, percent }).ok, false, `percent=${percent}`);
    }
    assert.equal(validatePromotionInput({ ...good, percent: 1 }).ok, true);
    assert.equal(validatePromotionInput({ ...good, percent: 90 }).ok, true);
  });
  it("конец позже начала, название не пустое", () => {
    assert.equal(validatePromotionInput({ ...good, endsAt: good.startsAt }).ok, false);
    assert.equal(validatePromotionInput({ ...good, endsAt: msk("2026-09-01T00:00") }).ok, false);
    assert.equal(validatePromotionInput({ ...good, title: "   " }).ok, false);
    assert.equal(validatePromotionInput({ ...good, startsAt: new Date("x") }).ok, false);
  });
});
