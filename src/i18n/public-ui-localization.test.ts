import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { AppStoresTeaser } from "@/components/public/app-stores-teaser";
import { PricingCalculator } from "@/components/public/pricing-calculator";
import { loadMessages } from "./messages";

test("public store teaser and pricing calculator render real localized catalogs", async () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    const messages = await loadMessages(locale);
    const failures: string[] = [];
    const html = renderToStaticMarkup(createElement(NextIntlClientProvider, {
      locale,
      messages,
      timeZone: "Europe/Moscow",
      onError: error => failures.push(error.message),
      children: createElement(Fragment, null,
        createElement(AppStoresTeaser),
        createElement(PricingCalculator, { subscriptionMonthly: 12900 }),
      ),
    }));

    assert.deepEqual(failures, [], locale);
    assert.ok(html.includes(messages.publicUi.appStores.title));
    assert.ok(html.includes(messages.publicUi.appStores.description));
    // Прошедшая дата запуска («1 октября») на витрине больше не показывается.
    assert.doesNotMatch(html, /1 октября|1 October|1-oktabr/);
    assert.ok(html.includes(messages.publicUi.pricing.title));
    assert.ok(html.includes(messages.publicUi.pricing.bundles.standard.name));
    assert.ok(html.includes("₽"), "pricing remains in RUB");
    if (locale !== "ru") assert.doesNotMatch(html, /\p{Script=Cyrillic}/u);
  }
});
