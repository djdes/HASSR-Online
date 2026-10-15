/* eslint-disable react/no-children-prop -- NextIntlClientProvider's React 19 typings require children in props for createElement. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { test } from "node:test";

import { PublicBadgeCard } from "@/components/settings/public-badge-card";
import { ConversionBlockers, ConversionConsequences } from "@/components/partner/conversion-consequences";
import { validateCatalog } from "@/i18n/catalog-validation";
import type { Blocker, Consequences } from "@/lib/partners/org-conversion-core";

const catalogs = Object.fromEntries(
  (["ru", "en", "uz"] as const).map((locale) => [
    locale,
    JSON.parse(readFileSync(`src/i18n/messages/${locale}.json`, "utf8")),
  ]),
);

test("organization profile catalogs match and badge UI renders for each locale", () => {
  for (const locale of ["en", "uz"] as const) {
    assert.deepEqual(
      validateCatalog(catalogs.ru.settingsManagement.organizationProfile, catalogs[locale].settingsManagement.organizationProfile),
      [],
      `${locale} organization profile catalog parity`,
    );
  }

  for (const locale of ["ru", "en", "uz"] as const) {
    const messages = catalogs[locale];
    const badge = messages.settingsManagement.organizationProfile.badge;
    const html = renderToStaticMarkup(
      createElement(
        NextIntlClientProvider,
        {
          locale,
          messages,
          timeZone: "Europe/Moscow",
          onError: (error) => { throw error; },
          children: createElement(PublicBadgeCard, {
            organizationName: "North Café",
            initial: {
              enabled: false,
              code: "fixture-code",
              publicUrl: "https://example.test/status/fixture-code",
              imageUrl: null,
              embedHtml: null,
              percent: null,
              previewSvgDataUrl: "data:image/svg+xml,<svg></svg>",
            },
          }),
        },
      ),
    );
    assert.ok(html.includes(badge.title), `${locale} title was not rendered`);
    assert.ok(html.includes(badge.description), `${locale} description was not rendered`);
    assert.ok(html.includes("North Café"), "customer organization name should remain unchanged");
  }
});

test("partner consequence presentation renders localized sentences and preserves dynamic data", () => {
  const consequences: Consequences = {
    payment: ["legacy Russian payment copy"],
    seats: [],
    commission: [],
    access: ["legacy Russian access copy"],
    next: [],
    presentation: {
      payment: [
        { key: "subscriptionPaid", params: { date: "2026-12-01T09:00:00.000Z" } },
        { key: "balanceRetained", params: { amount: 1500 } },
      ],
      seats: [],
      commission: [],
      access: [{ key: "organizationRemoved", params: { organizationName: "Кафе Ромашка" } }],
      next: [],
    },
  };

  for (const locale of ["ru", "en", "uz"] as const) {
    const messages = catalogs[locale];
    const copy = messages.settingsManagement.organizationProfile.partnerConversion.consequences;
    const html = renderToStaticMarkup(
      createElement(
        NextIntlClientProvider,
        {
          locale,
          messages,
          timeZone: "Europe/Moscow",
          onError: (error) => { throw error; },
          children: createElement(ConversionConsequences, { consequences }),
        },
      ),
    );
    assert.ok(html.includes(copy.subscriptionPaid.split("{date}")[0].trim()), `${locale} paid-term sentence missing`);
    assert.ok(html.includes("Кафе Ромашка"), "organization name must remain customer data");
    if (locale !== "ru") {
      assert.ok(!html.includes("legacy Russian"));
      assert.ok(!html.includes("уйдёт из вашего списка организаций"));
    }
  }
});

test("partner blockers render structured invoice data with localized dates and generic legacy fallback", () => {
  const blockers: Blocker[] = [
    {
      code: "pending_invoice",
      message: "legacy Russian invoice text with private amount/date",
      presentation: {
        key: "pending_invoice_due",
        params: { invoiceId: "INV-42", amountRub: 5970, dueDate: "2026-11-20T09:00:00.000Z" },
      },
    },
    { code: "pending_invoice", message: "legacy Russian text must not leak" },
  ];

  for (const locale of ["ru", "en", "uz"] as const) {
    const messages = catalogs[locale];
    const copy = messages.settingsManagement.organizationProfile.partnerConversion.blockers;
    const html = renderToStaticMarkup(
      createElement(NextIntlClientProvider, {
        locale,
        messages,
        timeZone: "Europe/Moscow",
        onError: (error) => { throw error; },
        children: createElement(ConversionBlockers, { blockers, title: "Blockers" }),
      }),
    );
    assert.ok(html.includes("INV-42"), `${locale} should preserve invoice identifier`);
    assert.ok(html.includes(new Intl.DateTimeFormat(locale, {
      timeZone: "Europe/Moscow", day: "numeric", month: "long", year: "numeric",
    }).format(new Date("2026-11-20T09:00:00.000Z"))), `${locale} should render due date including year`);
    assert.ok(html.includes(copy.unknown), `${locale} should localize legacy dynamic blocker without leaking source text`);
    if (locale !== "ru") assert.ok(!html.includes("legacy Russian"));
  }
});
