import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  resolveCheckoutDiscountWith,
  type CheckoutDeps,
  type CheckoutTarget,
  type PromoCodeRecord,
} from "@/lib/promo/checkout-core";
import type { LifetimeDiscountView } from "@/lib/promo/discounts";
import { applyPromotion, computeCheckoutAmounts, type AppliedPromotion } from "@/lib/promo/promotions";

/**
 * Скидка на оплату — ядро, которое зовут создание заказа (карта), счёт
 * по безналу и проверка кода. Хранилище — в памяти.
 */

const now = new Date("2026-10-12T09:00:00.000Z");

function code(partial: Partial<PromoCodeRecord> & { code: string }): PromoCodeRecord {
  return {
    id: `id_${partial.code}`,
    kind: "percent",
    value: 10,
    active: true,
    startsAt: null,
    endsAt: null,
    maxUses: null,
    newClientsOnly: false,
    lifetime: false,
    personalEmail: null,
    organizationId: null,
    ...partial,
  };
}

/** Аккаунт «Ромашки»: две точки, владелец owner@romashka.ru. */
const ROMASHKA: CheckoutTarget = {
  organizationId: "org_rom_1",
  accountId: "acc_rom",
  emails: ["owner@romashka.ru"],
  organizationIds: ["org_rom_1", "org_rom_2"],
};

function fakeDeps(input: {
  codes?: PromoCodeRecord[];
  uses?: Record<string, number>;
  lifetime?: Record<string, LifetimeDiscountView | null>;
  targets?: Record<string, CheckoutTarget>;
  paidBefore?: boolean;
}) {
  const calls = { findCode: 0 };
  const deps: CheckoutDeps = {
    async findCode(value) {
      calls.findCode += 1;
      return input.codes?.find((c) => c.code === value) ?? null;
    },
    async countCodeUses(value) {
      return input.uses?.[value] ?? 0;
    },
    async hasPaidOrders() {
      return input.paidBefore ?? false;
    },
    async resolveTarget({ organizationId, email }) {
      const key = organizationId ?? email ?? "";
      return (
        input.targets?.[key] ?? {
          organizationId: null,
          accountId: null,
          emails: email ? [email] : [],
          organizationIds: [],
        }
      );
    },
    async activeLifetime(accountId) {
      return input.lifetime?.[accountId] ?? null;
    },
  };
  return { deps, calls };
}

const LIFETIME_10: LifetimeDiscountView = {
  id: "ld_rom",
  code: "ROMASHKA10",
  kind: "percent",
  value: 10,
  boundAt: "2026-10-01T10:00:00.000Z",
};

describe("скидка навсегда — автоприменение", () => {
  it("аккаунт со скидкой навсегда: без кода скидка применяется сама", async () => {
    const { deps } = fakeDeps({ lifetime: { acc_rom: LIFETIME_10 }, targets: { org_rom_1: ROMASHKA } });
    const result = await resolveCheckoutDiscountWith(deps, {
      promoRaw: null,
      organizationId: "org_rom_1",
      email: "owner@romashka.ru",
      offerRub: 1990,
      now,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.applied?.source, "lifetime");
    assert.equal(result.applied?.lifetimeDiscountId, "ld_rom");
    assert.equal(result.applied?.discountRub, 199);
    // Сумма к оплате — та же функция, что у заказа: 1990 − 199.
    const amounts = computeCheckoutAmounts({
      baseRub: 1990,
      promotion: null,
      promo: { kind: result.applied!.kind, value: result.applied!.value },
    });
    assert.equal(amounts.grossRub, 1791);
  });

  it("аноним без входа: скидку навсегда находим по почте заказа (её аккаунт и продлится)", async () => {
    const { deps } = fakeDeps({ lifetime: { acc_rom: LIFETIME_10 }, targets: { "owner@romashka.ru": ROMASHKA } });
    const result = await resolveCheckoutDiscountWith(deps, {
      promoRaw: "",
      organizationId: null,
      email: "Owner@Romashka.ru",
      offerRub: 1990,
      now,
    });
    assert.equal(result.ok && result.applied?.source, "lifetime");
  });

  it("порядок с акцией: скидка навсегда от цены по акции", async () => {
    const promotion: AppliedPromotion = {
      id: "pr1",
      title: "Осень",
      percent: 20,
      startsAt: "2026-10-01T00:00:00.000Z",
      endsAt: "2026-10-20T00:00:00.000Z",
    };
    const offer = applyPromotion(1990, promotion);
    const { deps } = fakeDeps({ lifetime: { acc_rom: LIFETIME_10 }, targets: { org_rom_1: ROMASHKA } });
    const result = await resolveCheckoutDiscountWith(deps, {
      promoRaw: null,
      organizationId: "org_rom_1",
      email: "owner@romashka.ru",
      offerRub: offer.priceRub,
      now,
    });
    assert.equal(result.ok && result.applied?.discountRub, 159);
    const amounts = computeCheckoutAmounts({ baseRub: 1990, promotion, promo: { kind: "percent", value: 10 } });
    assert.equal(amounts.grossRub, 1990 - 398 - 159);
  });

  it("отменённая скидка (activeLifetime → null) больше не применяется", async () => {
    const { deps } = fakeDeps({ lifetime: { acc_rom: null }, targets: { org_rom_1: ROMASHKA } });
    const result = await resolveCheckoutDiscountWith(deps, {
      promoRaw: null,
      organizationId: "org_rom_1",
      email: "owner@romashka.ru",
      offerRub: 1990,
      now,
    });
    assert.equal(result.ok, true);
    assert.equal(result.ok && result.applied, null);
  });
});

describe("выгоднейший из двух: скидка навсегда против введённого кода", () => {
  const targets = { org_rom_1: ROMASHKA };
  const input = { organizationId: "org_rom_1", email: "owner@romashka.ru", offerRub: 1592, now };

  it("код −500 ₽ выгоднее −10 % (159 ₽) — применяется код, без скидки навсегда", async () => {
    const { deps } = fakeDeps({
      codes: [code({ code: "SUPPORT500", kind: "fixed", value: 500 })],
      lifetime: { acc_rom: LIFETIME_10 },
      targets,
    });
    const result = await resolveCheckoutDiscountWith(deps, { ...input, promoRaw: "support500" });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.applied?.source, "code");
    assert.equal(result.applied?.code, "SUPPORT500");
    assert.equal(result.applied?.discountRub, 500);
    assert.equal(result.applied?.lifetimeDiscountId, null);
    assert.match(result.notice ?? "", /выгоднее вашей скидки навсегда/);
  });

  it("код −5 % слабее — применяется скидка навсегда, код не тратится", async () => {
    const { deps } = fakeDeps({ codes: [code({ code: "START5", value: 5 })], lifetime: { acc_rom: LIFETIME_10 }, targets });
    const result = await resolveCheckoutDiscountWith(deps, { ...input, promoRaw: "START5" });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.applied?.source, "lifetime");
    assert.equal(result.applied?.code, "ROMASHKA10");
    assert.equal(result.applied?.discountRub, 159);
    assert.equal(result.typedCode, "START5");
    assert.match(result.notice ?? "", /выгоднее промокода START5 — применили её/);
  });

  it("не складываются: к оплате только одна скидка", async () => {
    const { deps } = fakeDeps({ codes: [code({ code: "BIG20", value: 20 })], lifetime: { acc_rom: LIFETIME_10 }, targets });
    const result = await resolveCheckoutDiscountWith(deps, { ...input, promoRaw: "BIG20" });
    assert.equal(result.ok && result.applied?.discountRub, 318);
  });

  it("свой же код, исчерпанный первой оплатой, — не ошибка: работает скидка навсегда", async () => {
    const { deps, calls } = fakeDeps({
      codes: [code({ code: "ROMASHKA10", lifetime: true, maxUses: 1, personalEmail: "owner@romashka.ru" })],
      uses: { ROMASHKA10: 1 },
      lifetime: { acc_rom: LIFETIME_10 },
      targets,
    });
    const result = await resolveCheckoutDiscountWith(deps, { ...input, promoRaw: "romashka10" });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.applied?.source, "lifetime");
    assert.match(result.notice ?? "", /уже работает у вас как скидка навсегда/);
    assert.equal(calls.findCode, 0);
  });

  it("неподходящий код при скидке навсегда — отказ (скидка навсегда видна в ответе)", async () => {
    const { deps } = fakeDeps({ codes: [code({ code: "OLD10", active: false })], lifetime: { acc_rom: LIFETIME_10 }, targets });
    const result = await resolveCheckoutDiscountWith(deps, { ...input, promoRaw: "OLD10" });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.message, "Промокод отключён");
    assert.equal(result.lifetime?.code, "ROMASHKA10");
  });
});

describe("персональный код на оплате", () => {
  const personal = code({ code: "ROMASHKA10", lifetime: true, personalEmail: "owner@romashka.ru", maxUses: 1 });
  const orgCode = code({ code: "ROMORG15", value: 15, organizationId: "org_rom_2" });
  const LAVKA: CheckoutTarget = {
    organizationId: "org_lavka",
    accountId: "acc_lavka",
    emails: ["boss@lavka.ru"],
    organizationIds: ["org_lavka"],
  };

  it("свой: почта владельца — код применяется", async () => {
    const { deps } = fakeDeps({ codes: [personal], targets: { org_rom_1: ROMASHKA } });
    const result = await resolveCheckoutDiscountWith(deps, {
      promoRaw: "ROMASHKA10",
      organizationId: "org_rom_1",
      email: "manager@romashka.ru",
      offerRub: 1990,
      now,
    });
    assert.equal(result.ok && result.applied?.code, "ROMASHKA10");
    assert.equal(result.ok && result.applied?.lifetime, true);
  });

  it("свой: организация того же аккаунта (другая точка) — код применяется", async () => {
    const { deps } = fakeDeps({ codes: [orgCode], targets: { org_rom_1: ROMASHKA } });
    const result = await resolveCheckoutDiscountWith(deps, {
      promoRaw: "ROMORG15",
      organizationId: "org_rom_1",
      email: "owner@romashka.ru",
      offerRub: 1990,
      now,
    });
    assert.equal(result.ok && result.applied?.discountRub, 299);
  });

  it("чужой: другая организация — отказ «выдан другой организации»", async () => {
    const { deps } = fakeDeps({ codes: [personal, orgCode], targets: { org_lavka: LAVKA } });
    for (const promoRaw of ["ROMASHKA10", "ROMORG15"]) {
      const result = await resolveCheckoutDiscountWith(deps, {
        promoRaw,
        organizationId: "org_lavka",
        email: "boss@lavka.ru",
        offerRub: 1990,
        now,
      });
      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.equal(result.reason, "personal-foreign");
      assert.equal(result.message, "Этот промокод персональный — он выдан другой организации");
    }
  });

  it("чужой без входа: почта заказа не та — отказ при создании заказа", async () => {
    const { deps } = fakeDeps({ codes: [personal] });
    const result = await resolveCheckoutDiscountWith(deps, {
      promoRaw: "ROMASHKA10",
      organizationId: null,
      email: "stranger@example.com",
      offerRub: 1990,
      now,
    });
    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.reason, "personal-foreign");
  });

  it("новый клиент по своей почте (организации ещё нет) — код применяется", async () => {
    const { deps } = fakeDeps({ codes: [personal] });
    const result = await resolveCheckoutDiscountWith(deps, {
      promoRaw: "ROMASHKA10",
      organizationId: null,
      email: "owner@romashka.ru",
      offerRub: 1990,
      now,
    });
    assert.equal(result.ok && result.applied?.source, "code");
  });

  it("проверка кода без входа и без почты — «проверим по почте при оплате»", async () => {
    const { deps } = fakeDeps({ codes: [personal] });
    const result = await resolveCheckoutDiscountWith(deps, {
      promoRaw: "ROMASHKA10",
      organizationId: null,
      email: null,
      offerRub: 1990,
      now,
    });
    assert.equal(result.ok, true);
    assert.equal(result.ok && result.personalPending, true);
  });
});

describe("прежние правила кода не сломались", () => {
  it("только новым: у клиента уже были оплаты — отказ", async () => {
    const { deps } = fakeDeps({ codes: [code({ code: "START30", value: 30, newClientsOnly: true })], paidBefore: true });
    const result = await resolveCheckoutDiscountWith(deps, {
      promoRaw: "START30",
      organizationId: null,
      email: "old@client.ru",
      offerRub: 1990,
      now,
    });
    assert.equal(!result.ok && result.reason, "new-clients-only");
  });

  it("лимит: оплат по коду столько же, сколько лимит, — исчерпан", async () => {
    const { deps } = fakeDeps({ codes: [code({ code: "ONE", maxUses: 1 })], uses: { ONE: 1 } });
    const result = await resolveCheckoutDiscountWith(deps, { promoRaw: "ONE", organizationId: null, email: "a@b.ru", offerRub: 1990, now });
    assert.equal(!result.ok && result.reason, "exhausted");
  });

  it("мусор вместо кода — «Такого промокода нет»", async () => {
    const { deps, calls } = fakeDeps({});
    const result = await resolveCheckoutDiscountWith(deps, { promoRaw: "ПРИВЕТ", organizationId: null, email: "a@b.ru", offerRub: 1990, now });
    assert.equal(!result.ok && result.message, "Такого промокода нет");
    assert.equal(calls.findCode, 0);
  });
});
