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

const available = { standard: { month: true, year: true }, premium: { month: true, year: true }, vip: { month: true, year: true } };
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

test("public pricing renders four columns, points, PPK and the comparison table in every locale", async () => {
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
        ppkHref: "/uslugi",
        showTable: true,
      })
    );
    for (const id of ["tariff-card-free", "tariff-card-standard", "tariff-card-premium", "tariff-card-vip", "tariff-ppk", "tariff-table"]) {
      assert.ok(html.includes(`data-testid="${id}"`), `${locale}: ${id}`);
    }
    for (const name of [t("tiers.free.name"), t("tiers.standard.name"), t("tiers.premium.name"), t("tiers.vip.name"), t("table.title")]) {
      assert.ok(html.includes(name), `${locale}: ${name}`);
    }
    // За год по умолчанию: крупно 1 990, 3 990 и 8 990 за точку в месяц, ниже — итог за год.
    assert.ok(html.includes(formatNumber(locale, 1990)), `${locale}: standard yearly price`);
    assert.ok(html.includes(formatNumber(locale, 3990)), `${locale}: premium yearly price`);
    assert.ok(html.includes(formatNumber(locale, 8990)), `${locale}: vip yearly price`);
    assert.ok(html.includes("/order?plan=vip&amp;cycle=year&amp;points=1"), `${locale}: vip order link`);
    assert.ok(html.includes(t("price.perPointMonth")), `${locale}: per point suffix`);
    assert.ok(html.includes(t("price.yearTotal", { amount: `${formatNumber(locale, 23_880)}\u00a0₽` })), `${locale}: year total`);
    // ППК индивидуально — без цены: «Свяжитесь с нами» и «по запросу» в таблице (2026-10-29).
    const contact = createTranslator({ locale, messages, namespace: "sharedUi.contactUs" });
    const ppkBlock = html.slice(html.indexOf('data-testid="tariff-ppk"'), html.indexOf('data-testid="tariff-table"'));
    assert.ok(ppkBlock.includes('data-testid="tariff-ppk-contact"'), `${locale}: PPK contact button`);
    assert.ok(ppkBlock.includes(contact("cta")), `${locale}: PPK contact label`);
    assert.doesNotMatch(visibleText(ppkBlock), /₽|\d[\d\s\u00a0\u202f.,]*000/u, `${locale}: PPK price leaked`);
    assert.ok(html.includes(t("cells.ppkOnRequest")), `${locale}: PPK table cell`);
    // Блок ППК + по четыре ячейки «по запросу» у ППК и у «Плана ХАССП» (четыре тарифа, 05.11.2026).
    assert.equal(html.match(/data-contact-us-trigger/g)?.length, 9, `${locale}: PPK block + eight table cells`);
    // Колонка «ВИП» в таблице: заголовок и строки «Сопровождения» (только у ВИП).
    const table = html.slice(html.indexOf('data-testid="tariff-table"'));
    assert.ok(table.includes(t("tiers.vip.name")), `${locale}: vip column header`);
    assert.ok(table.includes(t("groups.service")), `${locale}: service group`);
    for (const row of ["checklists", "ppkElectronic", "hotline", "dataBank", "consultant"]) {
      assert.ok(table.includes(t(`rows.${row}` as never)), `${locale}: row ${row}`);
    }
    assert.ok(table.includes(t("cells.hotlineVip", { hours: 10 })), `${locale}: vip hotline cell`);
    assert.ok(table.includes(t("cells.pointsPaidScale")), `${locale}: points scale cell`);
    assert.ok(html.includes("/order?plan=standard&amp;cycle=year&amp;points=1"), `${locale}: order link`);
    if (locale !== "ru") assert.doesNotMatch(visibleText(html), /\p{Script=Cyrillic}/u, `${locale}: Cyrillic leaked`);
  }
});

test("cabinet pricing shows the change kind and the server-equal surcharge for an upgrade", async () => {
  const now = new Date("2026-10-26T09:00:00.000Z");
  const cabinet: TariffCabinetState = {
    status: "paid",
    current: { paidUntil: new Date(now.getTime() + 15 * DAY).toISOString(), tier: "standard", cycle: "year", points: 1 },
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
        ppkHref: "/settings/services?order=ppk-development",
        cabinet,
        showTable: false,
      })
    );
    // «Стандарт» за год — текущий: продление на полную цену года.
    assert.ok(html.includes(t("badges.current")), `${locale}: current badge`);
    assert.ok(html.includes(t("cta.renew", { amount: rub(23_880) })), `${locale}: renew`);
    // «Премиум» за год: (47 880 − 23 880) × 15/365 = 986 ₽, срок не меняется.
    assert.ok(html.includes(t("cta.upgrade", { amount: rub(986) })), `${locale}: upgrade`);
    assert.ok(html.includes(t("explain.upgrade", { days: 15, difference: rub(24_000) })), `${locale}: upgrade note`);
    // «ВИП» за год: (107 880 − 23 880) × 15/365 = 3 452 ₽.
    assert.ok(html.includes(t("cta.upgrade", { amount: rub(3452) })), `${locale}: vip upgrade`);
    assert.ok(html.includes(t("explain.upgrade", { days: 15, difference: rub(84_000) })), `${locale}: vip upgrade note`);
    // Кабинет: четыре карточки в ряд и общие строки — только с 2xl (рядом меню).
    assert.equal(html.match(/2xl:row-span-6 2xl:grid 2xl:grid-cols-\[minmax\(0,1fr\)\] 2xl:grid-rows-subgrid/g)?.length, 4, `${locale}: cabinet subgrid`);
    assert.ok(html.includes("2xl:grid-cols-4"), `${locale}: cabinet four in a row`);
    assert.ok(!html.includes("xl:row-span-6 xl:grid "), `${locale}: no xl subgrid in cabinet`);
    assert.ok(!html.includes('data-testid="tariff-table"'), `${locale}: table hidden`);
    if (locale !== "ru") assert.doesNotMatch(visibleText(html), /\p{Script=Cyrillic}/u, `${locale}: Cyrillic leaked`);
  }
});

test("cabinet buttons show the amount after an active promotion, as the order page charges", async () => {
  const now = new Date("2026-10-26T09:00:00.000Z");
  const cabinet: TariffCabinetState = {
    status: "paid",
    current: { paidUntil: new Date(now.getTime() + 15 * DAY).toISOString(), tier: "standard", cycle: "year", points: 1 },
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
      ppkHref: "/settings/services?order=ppk-development",
      cabinet,
      showTable: false,
    })
  );
  // −20 %: продление 23 880 → 19 104 ₽, доплата за повышение 986 → 789 ₽.
  assert.ok(html.includes(t("cta.renew", { amount: rub(19_104) })));
  assert.ok(html.includes(t("cta.upgrade", { amount: rub(789) })));
  // Итог за год под ценой — тоже с акцией, как спишет оплата.
  assert.ok(html.includes(t("price.yearTotal", { amount: rub(19_104) })));
});

test("a monthly subscriber with 14 points opens on «per year»: price per point big, total for all points below", async () => {
  // Как на скриншоте владельца: «Стандарт» помесячно, 14 точек.
  const now = new Date("2026-10-26T09:00:00.000Z");
  const cabinet: TariffCabinetState = {
    status: "paid",
    current: { paidUntil: new Date(now.getTime() + 15 * DAY).toISOString(), tier: "standard", cycle: "month", points: 14 },
    trialUntilLabel: null,
    trialDaysLeft: null,
    pointsInUse: 14,
    scheduled: null,
    legacyMonthlyRub: 1990,
    nowIso: now.toISOString(),
  };
  for (const locale of ["ru", "en", "uz"] as const) {
    const messages = await loadMessages(locale);
    const t = createTranslator({ locale, messages, namespace: "landingComponents.tariffs" });
    const rub = (value: number) => `${formatNumber(locale, value)} ₽`;
    const html = await render(
      locale,
      createElement(TariffComparison, {
        mode: "cabinet",
        rates: DEFAULT_PLAN_RATES,
        available,
        promotion: null,
        ppkHref: "/settings/services",
        cabinet,
        showTable: false,
      })
    );
    // «За год» включён, хотя подписка помесячная.
    assert.match(html, /role="switch" aria-checked="true"/, `${locale}: year by default`);
    const norm = (text: string) => text.replace(/\s+/g, " ");
    // Блок цены карточки: от начала карточки до блока кнопки.
    const priceOf = (tier: string) => {
      const from = html.slice(html.indexOf(`data-testid="tariff-card-${tier}"`));
      return norm(visibleText(from.slice(0, from.indexOf(`data-testid="tariff-action-${tier}"`))));
    };
    // Крупно — одна точка в месяц, 14 точек — скидка 10 %: 1 990 × 0,9 = 1 791,
    // 3 990 × 0,9 = 3 591, 8 990 × 0,9 = 8 091.
    assert.ok(priceOf("standard").includes(norm(rub(1791))), `${locale}: standard per point`);
    assert.ok(priceOf("premium").includes(norm(rub(3591))), `${locale}: premium per point`);
    assert.ok(priceOf("vip").includes(norm(rub(8091))), `${locale}: vip per point`);
    assert.ok(priceOf("standard").includes(norm(t("price.perPointMonth"))), `${locale}: per point suffix`);
    // Мельче — за все 14 точек за год, экономия и скидка за точки.
    assert.ok(priceOf("standard").includes(norm(t("price.totalYear", { count: 14, amount: rub(300_888) }))), `${locale}: standard total`);
    assert.ok(priceOf("premium").includes(norm(t("price.totalYear", { count: 14, amount: rub(603_288) }))), `${locale}: premium total`);
    assert.ok(priceOf("vip").includes(norm(t("price.totalYear", { count: 14, amount: rub(1_359_288) }))), `${locale}: vip total`);
    // 37 674 × 12 − 300 888 = 151 200.
    assert.ok(priceOf("standard").includes(norm(t("price.yearSavings", { amount: rub(151_200) }))), `${locale}: savings`);
    assert.ok(priceOf("standard").includes(norm(t("price.pointsDiscount", { percent: 10 }))), `${locale}: points discount`);
    // Кнопка — переход на год с зачётом остатка месяца: 300 888 − 37 674 × 15/30.
    assert.ok(html.includes(t("cta.switchYear", { amount: rub(300_888 - 18_837) })), `${locale}: switch to year`);
    if (locale !== "ru") assert.doesNotMatch(visibleText(html), /\p{Script=Cyrillic}/u, `${locale}: Cyrillic leaked`);
  }
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

test("v2 layout: period switch, centered points with explanation, Premium 40 seats with contact link, Mercury and VIP service", async () => {
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
        ppkHref: "/uslugi",
        showTable: true,
      })
    );
    // Тумблер «За год»: switch, включён по умолчанию, подписи с обеих сторон.
    assert.match(html, /role="switch" aria-checked="true" aria-label="[^"]+" data-testid="tariff-cycle-switch"/, `${locale}: switch`);
    for (const id of ["tariff-cycle-month", "tariff-cycle-year", "tariff-points-picker", "tariff-points-hint"]) {
      assert.ok(html.includes(`data-testid="${id}"`), `${locale}: ${id}`);
    }
    assert.ok(html.includes(t("pointsPicker.hint")), `${locale}: points explanation`);
    // Одна точка — до индивидуального предложения далеко.
    assert.ok(!html.includes('data-testid="tariff-individual"'), `${locale}: no individual offer for 1 point`);
    // «Премиум»: 40 сотрудников на точку и короткая ссылка «связаться».
    assert.ok(html.includes(t("features.employeesPremium", { count: 40 })), `${locale}: premium seats`);
    assert.ok(html.includes('data-testid="tariff-premium-contact"'), `${locale}: contact link`);
    assert.ok(html.includes(t("contactLink")), `${locale}: contact label`);
    assert.ok(html.includes(t("features.employees", { count: 25 })), `${locale}: standard seats`);
    // «Меркурий» — пункт «Премиума» и строка таблицы.
    assert.ok(html.includes(t("features.mercury")), `${locale}: mercury point`);
    assert.ok(html.includes(t("rows.mercury")), `${locale}: mercury row`);
    assert.ok(html.includes(t("cells.employeesPremium", { count: 40 })), `${locale}: table premium seats`);
    // Пункты карточек: чек-листы у «Стандарта», электронная ППК у «Премиума»,
    // горячая линия, банк данных и консультант у «ВИП».
    const cardOf = (tier: string) => {
      const from = html.slice(html.indexOf(`data-testid="tariff-card-${tier}"`));
      const next = from.indexOf('data-testid="tariff-card-', 1);
      return next > 0 ? from.slice(0, next) : from;
    };
    assert.ok(cardOf("standard").includes(t("features.checklists")), `${locale}: standard checklists`);
    assert.ok(cardOf("premium").includes(t("features.ppkElectronic")), `${locale}: premium PPK`);
    assert.ok(cardOf("vip").includes(t("includes.vip")), `${locale}: vip intro`);
    assert.ok(cardOf("vip").includes(t("features.employeesPremium", { count: 40 })), `${locale}: vip seats`);
    for (const key of ["dataBank", "consultant"] as const) {
      assert.ok(cardOf("vip").includes(t(`features.${key}`)), `${locale}: vip ${key}`);
    }
    assert.ok(cardOf("vip").includes(t("features.hotline", { hours: 10 })), `${locale}: vip hotline`);
    // Строки карточек — общая сетка: каждая карточка занимает шесть строк, а её
    // колонка не шире карточки (minmax(0,1fr)) — длинная строка не растягивает остальные.
    // На сайте четыре в ряд — с xl, ниже — по две (sm).
    assert.equal(html.match(/xl:row-span-6 xl:grid xl:grid-cols-\[minmax\(0,1fr\)\] xl:grid-rows-subgrid/g)?.length, 4, `${locale}: subgrid cards`);
    assert.match(html, /grid gap-5 sm:grid-cols-2 xl:grid-cols-4 xl:grid-rows-\[repeat\(5,auto\)_1fr\]/, `${locale}: four in a row from xl`);
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
  assert.ok(!forty.includes('data-testid="tariff-headcount-vip"'), "VIP fits 40");
  assert.ok(forty.includes('data-testid="tariff-cta-standard"'), "Standard stays payable");

  const many = await render("ru", createElement(TariffComparison, props(140)));
  assert.ok(many.includes(t("headcount.contact", { count: 140, limit: 40 })));
  assert.ok(many.includes('data-testid="tariff-headcount-vip"'), "VIP: больше 40 — по согласованию");

  const fits = await render("ru", createElement(TariffComparison, props(20)));
  assert.ok(!fits.includes("tariff-headcount-"), "no note when the team fits");
});

test("from 50 points the paid cards call the manager instead of the order page", async () => {
  const now = new Date("2026-10-26T09:00:00.000Z");
  const cabinetWith = (pointsInUse: number): TariffCabinetState => ({
    status: "trial",
    current: null,
    trialUntilLabel: "8 ноября",
    trialDaysLeft: 5,
    pointsInUse,
    scheduled: null,
    legacyMonthlyRub: 1990,
    nowIso: now.toISOString(),
  });
  const props = (pointsInUse: number) => ({
    mode: "cabinet" as const,
    rates: DEFAULT_PLAN_RATES,
    available,
    promotion: null,
    ppkHref: "/settings/services",
    cabinet: cabinetWith(pointsInUse),
    showTable: false,
  });
  for (const locale of ["ru", "en", "uz"] as const) {
    const messages = await loadMessages(locale);
    const t = createTranslator({ locale, messages, namespace: "landingComponents.tariffs" });
    const actionOf = (html: string, tier: string) => {
      const from = html.slice(html.indexOf(`data-testid="tariff-action-${tier}"`));
      return from.slice(0, from.indexOf('data-testid="tariff-card-', 1) > 0 ? from.indexOf('data-testid="tariff-card-', 1) : undefined);
    };

    // 49 точек — ещё обычная оплата со скидкой 25 %.
    const below = await render(locale, createElement(TariffComparison, props(49)));
    assert.ok(!below.includes('data-testid="tariff-individual"'), `${locale}: 49 — no individual offer`);
    assert.ok(below.includes(t("price.pointsDiscount", { percent: 25 })), `${locale}: 49 — 25 % discount`);
    assert.ok(below.includes("/order?plan=vip&amp;cycle=year&amp;points=49"), `${locale}: 49 — order link`);
    assert.ok(!below.includes(t("individual.cta")), `${locale}: 49 — no manager button`);

    // 50 точек — подсказка у счётчика и «Связаться с менеджером» во всех платных карточках.
    const html = await render(locale, createElement(TariffComparison, props(50)));
    assert.ok(html.includes('data-testid="tariff-individual"'), `${locale}: individual hint`);
    assert.ok(html.includes(t("individual.title")), `${locale}: individual title`);
    for (const tier of ["standard", "premium", "vip"]) {
      const action = actionOf(html, tier);
      assert.match(action, new RegExp(`data-testid="tariff-cta-${tier}" data-contact-us-trigger`), `${locale}: ${tier} contact trigger`);
      assert.ok(action.includes(t("individual.cta")), `${locale}: ${tier} manager label`);
      assert.ok(!action.includes("/order?"), `${locale}: ${tier} no order link`);
    }
    if (locale !== "ru") assert.doesNotMatch(visibleText(html), /\p{Script=Cyrillic}/u, `${locale}: Cyrillic leaked`);
  }
});
