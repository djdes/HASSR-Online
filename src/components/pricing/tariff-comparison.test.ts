/* eslint-disable react/no-children-prop -- typed SSR fixtures pass children explicitly. */
import assert from "node:assert/strict";
import test from "node:test";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { createTranslator } from "use-intl/core";

import { TariffComparison, type TariffCabinetState } from "./tariff-comparison";
import { loadMessages } from "@/i18n/messages";
import { formatNumber, type Locale } from "@/i18n/locales";
import { DEFAULT_PLAN_RATES } from "@/lib/tariff-plans";

const available = { standard: { month: true, year: true }, premium: { month: true, year: true } };
const DAY = 24 * 60 * 60 * 1000;

async function render(locale: Locale, children: ReactNode) {
  return renderToStaticMarkup(
    createElement(NextIntlClientProvider, {
      locale,
      timeZone: "Europe/Moscow",
      messages: await loadMessages(locale),
      // Пропущенный перевод — падение теста, а не ключ на экране.
      onError: (error) => {
        throw error;
      },
      children,
    })
  );
}

/** Видимый текст без тегов и атрибутов. */
function visibleText(html: string): string {
  return html.replace(/<[^>]+>/g, " ");
}

test("public pricing renders three columns, points, PPK and the comparison table in every locale", async () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    const messages = await loadMessages(locale);
    const t = createTranslator({ locale, messages, namespace: "landingComponents.tariffs" });
    const html = await render(
      locale,
      createElement(TariffComparison, {
        mode: "public",
        rates: DEFAULT_PLAN_RATES,
        available,
        promotion: null,
        ppkFromRub: 10_000,
        ppkHref: "/uslugi",
        showTable: true,
      })
    );
    for (const id of ["tariff-card-free", "tariff-card-standard", "tariff-card-premium", "tariff-ppk", "tariff-table"]) {
      assert.ok(html.includes(`data-testid="${id}"`), `${locale}: ${id}`);
    }
    for (const name of [t("tiers.free.name"), t("tiers.standard.name"), t("tiers.premium.name"), t("table.title")]) {
      assert.ok(html.includes(name), `${locale}: ${name}`);
    }
    // За год по умолчанию: «от» 1 990 и 3 990 в месяц, итог за год.
    assert.ok(html.includes(formatNumber(locale, 1990)), `${locale}: standard yearly price`);
    assert.ok(html.includes(formatNumber(locale, 3990)), `${locale}: premium yearly price`);
    assert.ok(html.includes(t("price.yearTotal", { amount: `${formatNumber(locale, 23_880)}\u00a0₽` })), `${locale}: year total`);
    assert.ok(html.includes(t("ppk.price", { price: `${formatNumber(locale, 10_000)}\u00a0₽` })), `${locale}: PPK price`);
    assert.ok(html.includes("/order?plan=standard&amp;cycle=year&amp;points=1"), `${locale}: order link`);
    if (locale !== "ru") assert.doesNotMatch(visibleText(html), /\p{Script=Cyrillic}/u, `${locale}: Cyrillic leaked`);
  }
});

test("cabinet pricing shows the change kind and the server-equal surcharge for an upgrade", async () => {
  const now = new Date("2026-10-26T09:00:00.000Z");
  const cabinet: TariffCabinetState = {
    status: "paid",
    current: { paidUntil: new Date(now.getTime() + 15 * DAY).toISOString(), tier: "standard", cycle: "month", points: 1 },
    trialUntilLabel: null,
    trialDaysLeft: null,
    pointsInUse: 1,
    scheduled: null,
    legacyMonthlyRub: 1990,
    nowIso: now.toISOString(),
  };
  for (const locale of ["ru", "en", "uz"] as const) {
    const messages = await loadMessages(locale);
    const t = createTranslator({ locale, messages, namespace: "landingComponents.tariffs" });
    const rub = (value: number) => `${formatNumber(locale, value)}\u00a0₽`;
    const html = await render(
      locale,
      createElement(TariffComparison, {
        mode: "cabinet",
        rates: DEFAULT_PLAN_RATES,
        available,
        promotion: null,
        ppkFromRub: 10_000,
        ppkHref: "/settings/services?order=ppk-development",
        cabinet,
        showTable: false,
      })
    );
    // «Стандарт» помесячно — текущий: продление на полную цену месяца.
    assert.ok(html.includes(t("badges.current")), `${locale}: current badge`);
    assert.ok(html.includes(t("cta.renew", { amount: rub(3000) })), `${locale}: renew`);
    // «Премиум» помесячно: (5 000 − 3 000) × 15/30 = 1 000 ₽, срок не меняется.
    assert.ok(html.includes(t("cta.upgrade", { amount: rub(1000) })), `${locale}: upgrade`);
    assert.ok(html.includes(t("explain.upgrade", { days: 15, difference: rub(2000) })), `${locale}: upgrade note`);
    assert.ok(!html.includes('data-testid="tariff-table"'), `${locale}: table hidden`);
    if (locale !== "ru") assert.doesNotMatch(visibleText(html), /\p{Script=Cyrillic}/u, `${locale}: Cyrillic leaked`);
  }
});

test("cabinet buttons show the amount after an active promotion, as the order page charges", async () => {
  const now = new Date("2026-10-26T09:00:00.000Z");
  const cabinet: TariffCabinetState = {
    status: "paid",
    current: { paidUntil: new Date(now.getTime() + 15 * DAY).toISOString(), tier: "standard", cycle: "month", points: 1 },
    trialUntilLabel: null,
    trialDaysLeft: null,
    pointsInUse: 1,
    scheduled: null,
    legacyMonthlyRub: 1990,
    nowIso: now.toISOString(),
  };
  const promotion = { id: "autumn", title: "Осень", percent: 20, startsAt: "2026-10-01T00:00:00.000Z", endsAt: "2026-11-01T00:00:00.000Z" };
  const messages = await loadMessages("ru");
  const t = createTranslator({ locale: "ru", messages, namespace: "landingComponents.tariffs" });
  const rub = (value: number) => `${formatNumber("ru", value)}\u00a0₽`;
  const html = await render(
    "ru",
    createElement(TariffComparison, {
      mode: "cabinet",
      rates: DEFAULT_PLAN_RATES,
      available,
      promotion,
      ppkFromRub: 10_000,
      ppkHref: "/settings/services?order=ppk-development",
      cabinet,
      showTable: false,
    })
  );
  // −20 %: продление 3 000 → 2 400 ₽, доплата за повышение 1 000 → 800 ₽.
  assert.ok(html.includes(t("cta.renew", { amount: rub(2400) })));
  assert.ok(html.includes(t("cta.upgrade", { amount: rub(800) })));
});

test("trial cabinet offers new subscriptions at full price and marks the trial", async () => {
  const now = new Date("2026-10-26T09:00:00.000Z");
  const cabinet: TariffCabinetState = {
    status: "trial",
    current: null,
    trialUntilLabel: "8 ноября",
    trialDaysLeft: 5,
    pointsInUse: 2,
    scheduled: null,
    legacyMonthlyRub: 1990,
    nowIso: now.toISOString(),
  };
  const messages = await loadMessages("ru");
  const t = createTranslator({ locale: "ru", messages, namespace: "landingComponents.tariffs" });
  const html = await render(
    "ru",
    createElement(TariffComparison, {
      mode: "cabinet",
      rates: DEFAULT_PLAN_RATES,
      available,
      promotion: null,
      ppkFromRub: 10_000,
      ppkHref: "/settings/services?order=ppk-development",
      cabinet,
      showTable: false,
    })
  );
  assert.ok(html.includes(t("badges.trial", { days: 5 })));
  assert.ok(html.includes(t("cta.trialNow")));
  // Две точки в работе — меньше выбрать нельзя: «Стандарт» за год × 2.
  assert.ok(html.includes(t("cta.newPlan", { amount: `${formatNumber("ru", 1990 * 12 * 2)}\u00a0₽` })));
  assert.ok(html.includes("/order?plan=premium&amp;cycle=year&amp;points=2"));
});
