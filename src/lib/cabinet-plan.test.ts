import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_FREE_PERIOD,
  computeAccountBilling,
  voluntaryDowngradeCheck,
  type AccountBillingState,
} from "@/lib/billing-period";
import {
  buildCabinetPlanCard,
  overageBreakdown,
  planBreakdownRows,
  subscriptionTotal,
} from "@/lib/cabinet-plan";
import type { AppliedPromotion } from "@/lib/promo/promotions";

const TARIFF = 1990;
/** Пробелы Intl (неразрывные) → обычные: сравниваем текст, а не символ. */
const plain = (s: string | null) => (s ?? "").replace(/\s/g, " ");

const PROMO: AppliedPromotion = {
  id: "p1",
  title: "Осень",
  percent: 20,
  startsAt: "2026-10-01T00:00:00.000Z",
  endsAt: "2026-11-01T00:00:00.000Z",
};

describe("subscriptionTotal — итог в месяц", () => {
  it("≤ 10 сотрудников — только подписка, без превышения", () => {
    const t = subscriptionTotal({ employees: 7, tariffRub: TARIFF, promotion: null, personal: null });
    assert.equal(t.quote.isFree, false);
    assert.equal(t.quote.extraEmployees, 0);
    assert.equal(t.finalRub, 1990);
    assert.equal(t.discounted, false);
    assert.equal(overageBreakdown(t.quote), null);
    assert.deepEqual(
      planBreakdownRows(t.quote).map((r) => [plain(r.label), r.amountRub]),
      [["Подписка до 10 сотрудников", 1990]]
    );
  });

  it("> 10 — подписка + 100 ₽ за каждого сверх 10 (пример владельца: 38 → 4 790 ₽)", () => {
    const t = subscriptionTotal({ employees: 38, tariffRub: TARIFF, promotion: null, personal: null });
    assert.equal(t.quote.extraEmployees, 28);
    assert.equal(t.quote.extraRub, 2800);
    assert.equal(t.finalRub, 4790);
    assert.equal(plain(overageBreakdown(t.quote)), "1 990 ₽ + 28 × 100 ₽ сверх 10");
    assert.deepEqual(
      planBreakdownRows(t.quote).map((r) => [plain(r.label), r.amountRub]),
      [
        ["Подписка до 10 сотрудников", 1990],
        ["Сверх 10: 28 × 100 ₽", 2800],
      ]
    );
  });

  it("со скидкой: акция на всю сумму, скидка навсегда — поверх цены с акцией", () => {
    const promo = subscriptionTotal({ employees: 38, tariffRub: TARIFF, promotion: PROMO, personal: null });
    assert.equal(promo.withPromotion.baseRub, 4790);
    assert.equal(promo.finalRub, 4790 - 958);
    assert.equal(promo.discounted, true);

    const both = subscriptionTotal({
      employees: 38,
      tariffRub: TARIFF,
      promotion: PROMO,
      personal: { kind: "percent", value: 10 },
    });
    // 3 832 − 10 % = 3 832 − 383 = 3 449
    assert.equal(both.personalRub, 383);
    assert.equal(both.finalRub, 3449);

    const fixed = subscriptionTotal({
      employees: 5,
      tariffRub: TARIFF,
      promotion: null,
      personal: { kind: "fixed", value: 500 },
    });
    assert.equal(fixed.finalRub, 1490);
  });

  it("бесплатный (1 сотрудник) — 0 ₽, скидка не применяется, строк расчёта нет", () => {
    const t = subscriptionTotal({
      employees: 1,
      tariffRub: TARIFF,
      promotion: PROMO,
      personal: { kind: "fixed", value: 500 },
    });
    assert.equal(t.quote.isFree, true);
    assert.equal(t.finalRub, 0);
    assert.equal(t.personalRub, 0);
    assert.deepEqual(planBreakdownRows(t.quote), []);
  });
});

function state(kind: AccountBillingState["kind"], extra: Partial<AccountBillingState> = {}): AccountBillingState {
  return {
    kind,
    phase: "after",
    enforcement: true,
    inactive: false,
    activeUsers: 38,
    paidUntil: null,
    reason: null,
    graceEndsAt: null,
    graceExpired: false,
    seatLimit: null,
    paidFeatures: true,
    ...extra,
  };
}

describe("buildCabinetPlanCard — карточка «Мой кабинет»", () => {
  const base = {
    settings: DEFAULT_FREE_PERIOD,
    plan: "paid",
    exempt: false,
    organizationsCount: 5,
    employees: 38,
    tariffRub: TARIFF,
    promotion: null,
    personal: null,
    canManagePlan: true,
    inMobileApp: false,
    testMode: false,
  };

  it("подписка: организации, сотрудники, сумма с расшифровкой, «Изменить тариф»", () => {
    const card = buildCabinetPlanCard({ ...base, state: state("paid", { paidUntil: new Date("2026-11-03T09:00:00Z") }) });
    assert.equal(card.title, "Подписка до 3 ноября");
    assert.equal(plain(card.counts), "5 организаций · 38 сотрудников");
    assert.equal(card.price?.finalRub, 4790);
    assert.equal(plain(card.price?.breakdown ?? null), "1 990 ₽ + 28 × 100 ₽ сверх 10");
    assert.deepEqual(card.link, { href: "/settings/subscription", label: "Изменить тариф" });
  });

  it("бесплатный: без суммы, «Подключить подписку»; одна организация — «1 организация»", () => {
    const card = buildCabinetPlanCard({
      ...base,
      plan: "free",
      organizationsCount: 1,
      employees: 1,
      state: state("free", { activeUsers: 1 }),
    });
    assert.equal(card.title, "Бесплатный");
    assert.equal(plain(card.counts), "1 организация · 1 сотрудник");
    assert.equal(card.price, null);
    assert.equal(card.link?.label, "Подключить подписку");
  });

  it("сотрудник без права на тариф и приложение WeSetup — только название", () => {
    for (const who of [{ canManagePlan: false, inMobileApp: false }, { canManagePlan: true, inMobileApp: true }]) {
      const card = buildCabinetPlanCard({ ...base, ...who, state: state("paid") });
      assert.deepEqual(card, { title: "Подписка", counts: null, price: null, link: null });
    }
  });

  it("бесплатный период: «Подписка — бесплатно по 10 октября», сумма с 11 октября", () => {
    const card = buildCabinetPlanCard({ ...base, state: state("free_period", { phase: "free_period", enforcement: false }) });
    assert.equal(card.title, "Подписка — бесплатно по 10 октября");
    assert.equal(card.price?.note, "с 11 октября");
  });
});

describe("voluntaryDowngradeCheck — добровольный переход на бесплатный", () => {
  const settings = DEFAULT_FREE_PERIOD;
  const at = (iso: string) => new Date(iso);

  it("разрешён: оплачено, бесплатный период, до периода, нужно решение", () => {
    const cases = [
      computeAccountBilling({ plan: "paid", subscriptionEnd: at("2026-12-01T00:00:00Z"), activeUsers: 38 }, settings, at("2026-11-01T00:00:00Z")),
      computeAccountBilling({ plan: "paid", subscriptionEnd: null, activeUsers: 5 }, settings, at("2026-10-05T00:00:00Z")),
      computeAccountBilling({ plan: "paid", subscriptionEnd: null, activeUsers: 5 }, settings, at("2026-09-20T00:00:00Z")),
      computeAccountBilling({ plan: "paid", subscriptionEnd: null, activeUsers: 5 }, settings, at("2026-10-12T00:00:00Z")),
    ];
    assert.deepEqual(cases.map((s) => s.kind), ["paid", "free_period", "legacy", "needs_decision"]);
    for (const s of cases) assert.deepEqual(voluntaryDowngradeCheck(s), { ok: true });
  });

  it("запрещён: нет тарифа (демо, мастер-кабинет, платформа) и организация на паузе", () => {
    const exempt = computeAccountBilling(
      { plan: "paid", subscriptionEnd: null, activeUsers: 5, exempt: true },
      settings,
      at("2026-11-01T00:00:00Z")
    );
    const paused = computeAccountBilling(
      { plan: "paused", subscriptionEnd: null, activeUsers: 5 },
      settings,
      at("2026-11-01T00:00:00Z")
    );
    const e = voluntaryDowngradeCheck(exempt);
    const p = voluntaryDowngradeCheck(paused);
    assert.equal(e.ok, false);
    assert.equal(p.ok, false);
    if (!e.ok) assert.equal(e.status, 409);
    if (!p.ok) assert.match(p.error, /приостановлена/);
  });
});
