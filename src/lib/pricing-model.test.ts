import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { paidPlansHint } from "@/lib/billing-period";
import { VIP_HOTLINE_HOURS } from "@/lib/plan-catalog";
import {
  DEFAULT_PLAN_RATES,
  POINTS_INDIVIDUAL_FROM,
  needsIndividualOffer,
  planMonthlyRub,
  pointsDiscountPercent,
} from "@/lib/tariff-plans";

/**
 * Финансовая модель владельца (06.11.2026) — один тест на всё, что видит клиент:
 * цены за месяц (за год / помесячно), шкала скидок за точки и «ВИП» везде, где
 * перечислены тарифы.
 */

const src = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("цены за месяц: Стандарт 1990/2990, Премиум 3990/4990, ВИП 8990/12990", () => {
  assert.deepEqual(DEFAULT_PLAN_RATES, {
    standard: { year: 1990, month: 2990 },
    premium: { year: 3990, month: 4990 },
    vip: { year: 8990, month: 12990 },
  });
});

test("шкала за организации и точки: 1–4 по прайсу, 5 −5 %, 10 −10 %, 15 −20 %, 35 −25 %, от 50 — индивидуально", () => {
  const expected: Array<[number, number]> = [
    [1, 0], [4, 0], [5, 5], [9, 5], [10, 10], [14, 10], [15, 20], [34, 20], [35, 25], [49, 25],
  ];
  for (const [points, percent] of expected) assert.equal(pointsDiscountPercent(points), percent, `${points}`);
  assert.equal(POINTS_INDIVIDUAL_FROM, 50);
  assert.equal(needsIndividualOffer(49), false);
  assert.equal(needsIndividualOffer(50), true);
  // −5 % на 5 точках «Стандарта» за год: 1990 × 5 × 0,95.
  assert.equal(planMonthlyRub(DEFAULT_PLAN_RATES, "standard", "year", 5), 9453);
});

test("подсказка после пробного называет все три платных тарифа с ценой «от»", () => {
  const hint = paidPlansHint({ standardFromRub: 1990, premiumFromRub: 3990, vipFromRub: 8990 });
  assert.match(hint, /«Стандарт» — от 1\s990 ₽\/мес, «Премиум» — от 3\s990 ₽\/мес, «ВИП» — от 8\s990 ₽\/мес при оплате за год\./);
});

test("главная: «Четыре тарифа», «ВИП» в разметке, шкала до «от 50» в подсказке выбора точек", () => {
  const page = src("app/page.tsx");
  assert.match(page, /name: copy\("landingComponents\.tariffs\.tiers\.vip\.name"\),\s*price: vipFrom,/);
  assert.match(page, /hotlineHours: VIP_HOTLINE_HOURS,/);
  assert.equal(VIP_HOTLINE_HOURS, 10);
  const titles = { ru: /^Четыре тарифа\./, en: /^Four plans\./, uz: /^To‘rtta tarif\./ };
  for (const locale of ["ru", "en", "uz"] as const) {
    const m = JSON.parse(src(`i18n/messages/${locale}.json`)) as {
      landing: { pricingTitle: string; seo: { vipDescription?: string } };
      landingComponents: { tariffs: { pointsPicker: { hint: string } } };
      rootTariffs: { paidHint: string };
    };
    assert.match(m.landing.pricingTitle, titles[locale], locale);
    assert.ok(m.landing.seo.vipDescription?.includes("{hotlineHours, number}"), locale);
    assert.match(m.landingComponents.tariffs.pointsPicker.hint, /50/, locale);
    assert.match(m.rootTariffs.paidHint, /\{vip, number\}/, locale);
  }
});

test("где перечислены платные тарифы, «ВИП» не забыт (ru/en/uz и тексты в коде)", () => {
  const keys = [
    "common.billing.journalLimit",
    "common.billing.storageClosed",
    "productionControl.package.storageClosed",
    "publicJournalIndex.cta.description",
    "billingUi.billingTransitionGate.restoreHint",
    "settingsUi.subscriptionPage.legacyNote",
    "settingsUi.subscriptionPage.ruleSeats",
    "rootOrganizationManagement.errors.freeWithEnd",
    "settingsManagement.organizationProfile.partnerConversion.consequences.seatLimit",
  ];
  const vip = { ru: "«ВИП»", en: "VIP", uz: "«VIP»" };
  for (const locale of ["ru", "en", "uz"] as const) {
    const messages = JSON.parse(src(`i18n/messages/${locale}.json`)) as Record<string, unknown>;
    for (const key of keys) {
      const value = key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown>)[part], messages);
      assert.ok(typeof value === "string" && value.includes(vip[locale]), `${locale} ${key}`);
    }
  }
  for (const file of [
    "lib/billing-period.ts",
    "lib/billing.server.ts",
    "lib/partners/org-conversion-core.ts",
    "content/seo-landings.ts",
    "app/api/settings/subscription/upgrade/route.ts",
  ]) {
    assert.ok(!src(file).includes("«Стандарт» или «Премиум»"), file);
  }
});
