/* eslint-disable react/no-children-prop -- Providers are composed with createElement for server rendering. */
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "node:test";
import { NextIntlClientProvider } from "next-intl";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";

import { BalanceClient } from "@/components/balance/balance-client";
import { loadMessages, pickMessages } from "@/i18n/messages";
import { parseTopupAmount } from "@/lib/balance/constants";
import type { BalanceOverview } from "@/lib/balance/overview";
import { createTranslator } from "use-intl/core";

const router = {
  back() {}, forward() {}, refresh() {}, hmrRefresh() {}, push() {}, replace() {}, prefetch() {},
};

test("top-up receipts and pending invoices retain rubles and ungrouped payment identifiers", async () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    const t = createTranslator({ locale, messages: await loadMessages(locale), namespace: "settingsManagement.balanceTopup", onError: error => { throw error; } });
    const receipt = t("paymentReceived", { amount: 12345, invoiceId: "987654321" });
    const pending = t("invoicePending", { amount: 12345, invoiceId: "987654321", dueDatePart: "" });
    for (const value of [receipt, pending]) {
      assert.ok(value.includes("₽"), `${locale}: currency must remain RUB`);
      assert.ok(value.includes("987654321"), `${locale}: identifiers must not be number-formatted`);
      assert.ok(value.includes(new Intl.NumberFormat(locale).format(12345)));
    }
  }
});

const rejectedReason = "Модератор просил сохранить это пояснение дословно";
const initial: BalanceOverview = {
  organizationName: "Cafe Example",
  userName: "Anna Example",
  canSeeBalance: true,
  balanceRub: 12_345,
  myEarnedRub: 900,
  referralCode: "ABCD2345",
  reviewPrefill: { authorName: "Anna Example", place: "Cafe Example, Kazan" },
  transactions: [],
  invites: [{ id: "invite-1", email: "colleague@example.com", createdAt: "2026-10-01T00:00:00.000Z", status: "paid", rewardRub: 597 }],
  myReview: {
    id: "review-1", organizationId: "org-1", organizationName: "Cafe Example", userId: "user-1",
    authorName: "Anna Example", place: "Cafe Example, Kazan", text: "A review that was returned for edits.",
    kind: "text", mediaUrl: null, mediaMime: null, rating: 4, consentPublic: true, anonymous: false,
    organizationSphere: "cafe", status: "rejected", rewardRub: 0, suggestedRewardRub: 300,
    rejectReason: rejectedReason, showOnLanding: false, createdAt: "2026-10-01T00:00:00.000Z", moderatedAt: "2026-10-02T00:00:00.000Z",
  },
};

const topup = {
  cardReady: true,
  invoiceReady: true,
  organizationName: "Cafe Example",
  organizationInn: "1234567890",
  pendingInvoice: { id: 42, amountRub: 5_000, dueAt: "2026-10-20T00:00:00.000Z" },
  recurringActive: true,
};

async function render(locale: "ru" | "en" | "uz", props: { variant?: "site" | "mini"; inApp?: boolean } = {}) {
  const messages = pickMessages(await loadMessages(locale), ["settingsManagement", "publicSupport", "journalControls", "common"]);
  const errors: string[] = [];
  const html = renderToStaticMarkup(createElement(AppRouterContext.Provider, {
    value: router,
    children: createElement(NextIntlClientProvider, {
      locale, messages, timeZone: "Europe/Moscow", onError: (error) => errors.push(error.message),
      children: createElement(BalanceClient, {
        initial, variant: props.variant ?? "site", inApp: props.inApp ?? false,
        topup: props.inApp ? null : topup,
      }),
    }),
  }));
  assert.deepEqual(errors, [], `${locale}: all balance namespaces and ICU arguments resolve`);
  return html;
}

test("balance, referral, review and top-up sections render in RU, EN, and Uzbek", async () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    const html = await render(locale);
    assert.match(html, /data-testid="topup-section"/, `${locale}: top-up block is visible`);
    assert.match(html, /Cafe Example/);
    assert.match(html, /5[,.\u00a0 ]000/);
    assert.ok(html.includes(rejectedReason), `${locale}: preserve moderator-authored rejection reason verbatim`);
    if (locale === "en") {
      assert.match(html, /Add funds/);
      assert.match(html, /Points history|Your link|Leave a review/);
    }
    if (locale === "uz") {
      assert.match(html, /Balans|Taklif|Izoh|Hisob/);
    }
  }
});

test("Mini App balance hides website-only top-up, referrals, and review rewards", async () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    const html = await render(locale, { variant: "mini", inApp: true });
    assert.doesNotMatch(html, /data-testid="topup-section"/);
    assert.doesNotMatch(html, /Invite a colleague|Leave a review|Share in Telegram/);
  }
});

test("top-up parser exposes stable validation codes while preserving legacy error strings and bounds", () => {
  const cases = [
    ["", "required"], ["bad", "numeric"], ["1990.50", "wholeRubles"],
    [499, "minimum"], [300_001, "maximum"],
  ] as const;
  for (const [value, code] of cases) {
    const result = parseTopupAmount(value);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, code);
      assert.ok(result.error.length > 0, "legacy callers retain the previous human-readable error field");
    }
  }
});
