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

test("v2 layout: period switch, centered points with explanation, Premium 100 seats with contact link and Mercury", async () => {
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
    // Тумблер «За год»: switch, включён по умолчанию, подписи с обеих сторон.
    assert.match(html, /role="switch" aria-checked="true" aria-label="[^"]+" data-testid="tariff-cycle-switch"/, `${locale}: switch`);
    for (const id of ["tariff-cycle-month", "tariff-cycle-year", "tariff-points-picker", "tariff-points-hint"]) {
      assert.ok(html.includes(`data-testid="${id}"`), `${locale}: ${id}`);
    }
    assert.ok(html.includes(t("pointsPicker.hint", { from: 3, percent: 5 })), `${locale}: points explanation`);
    // «Премиум»: 100 сотрудников на точку и короткая ссылка «связаться».
    assert.ok(html.includes(t("features.employeesPremium", { count: 100 })), `${locale}: premium seats`);
    assert.ok(html.includes('data-testid="tariff-premium-contact"'), `${locale}: contact link`);
    assert.ok(html.includes(t("contactLink")), `${locale}: contact label`);
    assert.ok(html.includes(t("features.employees", { count: 25 })), `${locale}: standard seats`);
    // «Меркурий» — пункт «Премиума» и строка таблицы.
    assert.ok(html.includes(t("features.mercury")), `${locale}: mercury point`);
    assert.ok(html.includes(t("rows.mercury")), `${locale}: mercury row`);
    assert.ok(html.includes(t("cells.employeesPremium", { count: 100 })), `${locale}: table premium seats`);
    // Строки карточек — общая сетка: каждая карточка занимает шесть строк, а её
    // колонка не шире карточки (minmax(0,1fr)) — длинная строка не растягивает остальные.
    assert.equal(html.match(/lg:row-span-6 lg:grid lg:grid-cols-\[minmax\(0,1fr\)\] lg:grid-rows-subgrid/g)?.length, 3, `${locale}: subgrid cards`);
    // Ряд настроек: равные края, в центре — только счётчик.
    assert.match(html, /sm:grid-cols-\[minmax\(0,1fr\)_auto_minmax\(0,1fr\)\]/, `${locale}: equal side columns`);
    // «Помесячно ◯ За год» — одна неразрывная группа; переносится только плашка скидки.
    const trio = html.match(/<span class="inline-flex items-center gap-1">([\s\S]*?)<\/span><span class="whitespace-nowrap rounded-full/);
    assert.ok(trio, `${locale}: trio kept together, badge outside`);
    for (const id of ["tariff-cycle-month", "tariff-cycle-switch", "tariff-cycle-year"]) {
      assert.ok(trio[1].includes(`data-testid="${id}"`), `${locale}: ${id} in the trio`);
    }
  }
});

test("cabinet: a card that the headcount outgrows suggests the next plan, payment stays open", async () => {
  const now = new Date("2026-10-26T09:00:00.000Z");
  const base: TariffCabinetState = {
    status: "paid",
    current: { paidUntil: new Date(now.getTime() + 15 * DAY).toISOString(), tier: "standard", cycle: "month", points: 1 },
    trialUntilLabel: null,
    trialDaysLeft: null,
    pointsInUse: 1,
    scheduled: null,
    legacyMonthlyRub: 1990,
    nowIso: now.toISOString(),
  };
  const props = (activeUsers: number) => ({
    mode: "cabinet" as const,
    rates: DEFAULT_PLAN_RATES,
    available,
    promotion: null,
    ppkFromRub: 10_000,
    ppkHref: "/settings/services",
    cabinet: { ...base, activeUsers },
    showTable: false,
  });
  const messages = await loadMessages("ru");
  const t = createTranslator({ locale: "ru", messages, namespace: "landingComponents.tariffs" });

  const forty = await render("ru", createElement(TariffComparison, props(40)));
  assert.ok(forty.includes('data-testid="tariff-headcount-standard"'));
  assert.ok(forty.includes(t("headcount.toPremium", { count: 40, limit: 25 })));
  assert.ok(!forty.includes('data-testid="tariff-headcount-premium"'), "Premium fits 40");
  assert.ok(forty.includes('data-testid="tariff-cta-standard"'), "Standard stays payable");

  const many = await render("ru", createElement(TariffComparison, props(140)));
  assert.ok(many.includes(t("headcount.contact", { count: 140, limit: 100 })));

  const fits = await render("ru", createElement(TariffComparison, props(20)));
  assert.ok(!fits.includes("tariff-headcount-"), "no note when the team fits");
});
