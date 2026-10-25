import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_TRIAL_SETTINGS,
  computeAccountBilling,
  voluntaryDowngradeCheck,
  type AccountBillingInput,
  type TrialSettings,
} from "@/lib/billing-period";
import { buildCabinetPlanCard, cabinetPlanTitle, planTotal } from "@/lib/cabinet-plan";
import type { AppliedPromotion } from "@/lib/promo/promotions";
import { DEFAULT_PLAN_RATES } from "@/lib/tariff-plans";

/** Пробелы Intl (неразрывные) → обычные: сравниваем текст, а не символ. */
const plain = (s: string | null) => (s ?? "").replace(/\s/g, " ");
const R = DEFAULT_PLAN_RATES;
const DAY = 24 * 60 * 60 * 1000;
const S: TrialSettings = { ...DEFAULT_TRIAL_SETTINGS, launchedAt: new Date("2026-10-25T21:00:00.000Z") };
const CREATED = new Date("2026-05-01T10:00:00.000Z");
const AFTER_TRIAL = new Date("2026-11-20T09:00:00.000Z");

const PROMO: AppliedPromotion = {
  id: "p1",
  title: "Осень",
  percent: 20,
  startsAt: "2026-10-01T00:00:00.000Z",
  endsAt: "2026-12-01T00:00:00.000Z",
};

function state(input: Partial<AccountBillingInput>, now = AFTER_TRIAL) {
  return computeAccountBilling(
    { plan: "free", subscriptionEnd: null, activeUsers: 1, enabledJournals: 1, createdAt: CREATED, ...input },
    S,
    now
  );
}

describe("planTotal — итог по тарифу", () => {
  it("Премиум за год, 1 точка: 47 880 ₽ = 3 990 ₽/мес", () => {
    const t = planTotal({ rates: R, tier: "premium", cycle: "year", points: 1, promotion: null, personal: null });
    assert.equal(t.periodRub, 47_880);
    assert.equal(t.monthlyFinalRub, 3990);
    assert.equal(t.discounted, false);
  });

  it("акция на сумму периода, скидка навсегда — поверх цены с акцией", () => {
    const t = planTotal({ rates: R, tier: "standard", cycle: "month", points: 2, promotion: PROMO, personal: { kind: "percent", value: 10 } });
    // 6 000 − 20 % = 4 800; −10 % = 4 320
    assert.equal(t.withPromotion.priceRub, 4800);
    assert.equal(t.personalRub, 480);
    assert.equal(t.finalRub, 4320);
    assert.equal(t.discounted, true);
  });
});

describe("buildCabinetPlanCard — карточка «Мой кабинет»", () => {
  const base = {
    plan: "premium",
    exempt: false,
    employees: 38,
    rates: R,
    promotion: null,
    personal: null,
    canManagePlan: true,
    inMobileApp: false,
    testMode: false,
  };

  it("Премиум за год на 2 точки: точки, сотрудники из лимита, сумма в месяц, «Изменить тариф»", () => {
    const s = state({
      plan: "premium",
      subscriptionEnd: new Date("2027-03-03T09:00:00Z"),
      planCycle: "year",
      planPoints: 2,
      pointsInUse: 2,
      activeUsers: 38,
    });
    const card = buildCabinetPlanCard({ ...base, state: s });
    assert.equal(card.title, "Премиум до 3 марта");
    assert.equal(plain(card.counts), "2 точки · 38 сотрудников из 50");
    assert.equal(card.price?.finalRub, 7980);
    assert.equal(card.price?.breakdown, "оплата за год");
    assert.deepEqual(card.link, { href: "/settings/subscription", label: "Изменить тариф" });
  });

  it("пробный период: без суммы, «Выбрать тариф», сотрудники без лимита", () => {
    const s = state({ activeUsers: 12, enabledJournals: 30 }, new Date("2026-10-30T09:00:00Z"));
    const card = buildCabinetPlanCard({ ...base, plan: "free", employees: 12, state: s });
    assert.equal(card.title, "Пробный период — по 8 ноября");
    assert.equal(plain(card.counts), "1 точка · 12 сотрудников");
    assert.equal(card.price, null);
    assert.equal(card.link?.label, "Выбрать тариф");
  });

  it("бесплатный после пробного: «Бесплатный», 1 сотрудник из 1", () => {
    const card = buildCabinetPlanCard({ ...base, plan: "free", employees: 1, state: state({}) });
    assert.equal(card.title, "Бесплатный");
    assert.equal(plain(card.counts), "1 точка · 1 сотрудник из 1");
    assert.equal(card.link?.label, "Выбрать тариф");
  });

  it("сотрудник без права на тариф и приложение WeSetup — только название", () => {
    const s = state({ plan: "standard", subscriptionEnd: new Date("2026-12-03T09:00:00Z") });
    for (const who of [{ canManagePlan: false, inMobileApp: false }, { canManagePlan: true, inMobileApp: true }]) {
      const card = buildCabinetPlanCard({ ...base, ...who, state: s });
      assert.deepEqual(card, { title: "Стандарт до 3 декабря", counts: null, price: null, link: null });
    }
  });

  it("прежняя «Подписка» — название и срок, без суммы по новым тарифам", () => {
    const s = state({ plan: "paid", subscriptionEnd: new Date("2026-12-03T09:00:00Z") });
    assert.equal(cabinetPlanTitle(s, "paid"), "Подписка (прежний тариф) до 3 декабря");
    assert.equal(buildCabinetPlanCard({ ...base, plan: "paid", state: s }).price, null);
  });
});

describe("voluntaryDowngradeCheck — добровольный переход на бесплатный", () => {
  it("разрешён: оплачено, пробный, нужно решение", () => {
    const cases = [
      state({ plan: "premium", subscriptionEnd: new Date(AFTER_TRIAL.getTime() + 10 * DAY) }),
      state({ activeUsers: 5 }, new Date("2026-10-30T09:00:00Z")),
      state({ activeUsers: 5 }),
    ];
    assert.deepEqual(cases.map((s) => s.kind), ["paid", "free_period", "needs_decision"]);
    for (const s of cases) assert.deepEqual(voluntaryDowngradeCheck(s), { ok: true });
  });

  it("запрещён: нет тарифа (демо, мастер-кабинет, платформа) и организация на паузе", () => {
    const e = voluntaryDowngradeCheck(state({ exempt: true }));
    const p = voluntaryDowngradeCheck(state({ plan: "paused" }));
    assert.equal(e.ok, false);
    assert.equal(p.ok, false);
    if (!e.ok) assert.equal(e.status, 409);
    if (!p.ok) assert.match(p.error, /приостановлена/);
  });
});
