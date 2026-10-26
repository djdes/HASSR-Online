import assert from "node:assert/strict";
import test from "node:test";
import { billingErrorPresentation } from "./billing-limit-toast";
import { BILLING_LIMIT_CODE, BILLING_PAY_HREF } from "./billing-period";
import { translatorFor } from "@/i18n/translator";
import { loadMessages } from "@/i18n/messages";
import { formatNumber } from "@/i18n/locales";

test("billing limit copy follows the caller locale, keeps native payment suppression and ignores legacy error text", async () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    const t = await translatorFor(locale);
    for (const count of [1, 2, 5, 21]) {
      const copy = { limit: t("common.billing.limit", { count }), limitAction: t("common.billing.limitAction", { count }), pay: t("common.billing.pay") };
      const data = { code: BILLING_LIMIT_CODE, error: "Старое русское сообщение", payUrl: "/settings/billing?pay=1" };
      const web = billingErrorPresentation(data, "fallback", copy, false);
      const native = billingErrorPresentation(data, "fallback", copy, true);
      assert.equal(web.href, data.payUrl);
      assert.equal(web.actionLabel, copy.pay);
      assert.equal(native.href, undefined);
      assert.equal(native.actionLabel, undefined);
      assert.ok(web.message.includes(String(count)));
      assert.ok(native.message.includes(String(count)));
      assert.ok(!web.message.includes(data.error));
      if (locale !== "ru") assert.doesNotMatch(web.message + native.message + web.actionLabel, /\p{Script=Cyrillic}/u);
      assert.deepEqual(billingErrorPresentation({ error: data.error }, "localized fallback", copy, false), { message: "localized fallback" });
      for (const payUrl of ["//external.example", "/\\external.example", "https://external.example"]) {
        assert.equal(billingErrorPresentation({ ...data, payUrl }, "fallback", copy, false).href, BILLING_PAY_HREF);
      }
    }
  }
});

test("tariff limit refusals (points, journals, storage, Premium) get localized copy and a plan link", async () => {
  const { tariffLimitPresentation } = await import("./billing-limit-toast");
  const { POINT_LIMIT_CODE, JOURNAL_LIMIT_CODE, STORAGE_LIMIT_CODE, FEATURE_LOCKED_CODE } = await import("./billing-period");
  for (const locale of ["ru", "en", "uz"] as const) {
    const t = await translatorFor(locale);
    const copy = {
      seats: (count: number) => t("common.billing.limitAction", { count }),
      points: (count: number) => t("common.billing.pointLimit", { count }),
      journals: (count: number) => t("common.billing.journalLimit", { count }),
      storageFull: t("common.billing.storageFull"),
      storageClosed: t("common.billing.storageClosed"),
      feature: t("common.billing.featureLocked"),
      seatsInApp: (count: number) => t("common.billing.limit", { count }),
      unavailableInApp: t("common.billing.unavailable"),
      pay: t("common.billing.pay"),
    };
    const legacy = "Старое русское сообщение";
    const points = tariffLimitPresentation({ code: POINT_LIMIT_CODE, limit: 2, error: legacy }, copy, false);
    assert.equal(points?.message, copy.points(2));
    assert.equal(points?.href, BILLING_PAY_HREF);
    assert.equal(points?.actionLabel, copy.pay);
    assert.equal(tariffLimitPresentation({ code: JOURNAL_LIMIT_CODE, limit: 1 }, copy, false)?.message, copy.journals(1));
    assert.equal(tariffLimitPresentation({ code: STORAGE_LIMIT_CODE, limit: 0 }, copy, false)?.message, copy.storageClosed);
    assert.equal(tariffLimitPresentation({ code: STORAGE_LIMIT_CODE, limit: 10485760 }, copy, false)?.message, copy.storageFull);
    assert.equal(tariffLimitPresentation({ code: FEATURE_LOCKED_CODE, limit: null }, copy, false)?.message, copy.feature);
    assert.equal(tariffLimitPresentation({ code: BILLING_LIMIT_CODE, limit: 50 }, copy, false)?.message, copy.seats(50));
    // В приложении — без ссылки на оплату.
    const native = tariffLimitPresentation({ code: POINT_LIMIT_CODE, limit: 2 }, copy, true);
    assert.equal(native?.href, undefined);
    assert.equal(native?.message, copy.unavailableInApp);
    assert.equal(tariffLimitPresentation({ code: "other", error: legacy }, copy, false), null);
    assert.equal(tariffLimitPresentation({ code: POINT_LIMIT_CODE, payUrl: "//evil.example" }, copy, false)?.href, BILLING_PAY_HREF);
    if (locale !== "ru") {
      assert.doesNotMatch([copy.points(3), copy.journals(1), copy.storageFull, copy.storageClosed, copy.feature, copy.pay].join(" "), /\p{Script=Cyrillic}/u);
    }
  }
});

test("seat refusals name the next plan (free → Standard, Standard → Premium) or offer a contact on Premium", async () => {
  const { tariffLimitPresentation, billingErrorPresentation, seatOfferFrom } = await import("./billing-limit-toast");
  assert.equal(seatOfferFrom({ code: BILLING_LIMIT_CODE }), "generic");
  assert.equal(seatOfferFrom({ code: BILLING_LIMIT_CODE, nextTier: "standard" }), "standard");
  assert.equal(seatOfferFrom({ code: BILLING_LIMIT_CODE, nextTier: "premium" }), "premium");
  assert.equal(seatOfferFrom({ code: BILLING_LIMIT_CODE, nextTier: null }), "contact");
  for (const locale of ["ru", "en", "uz"] as const) {
    const t = await translatorFor(locale);
    const copy = {
      seats: (count: number) => t("common.billing.limitAction", { count }),
      seatsToStandard: (count: number) => t("common.billing.limitToStandard", { count, seats: 25 }),
      seatsToPremium: (count: number) => t("common.billing.limitToPremium", { count, seats: 100 }),
      seatsContact: (count: number) => t("common.billing.limitContact", { count, seats: 100 }),
      contact: t("common.billing.contact"),
      points: (count: number) => t("common.billing.pointLimit", { count }),
      journals: (count: number) => t("common.billing.journalLimit", { count }),
      storageFull: t("common.billing.storageFull"),
      storageClosed: t("common.billing.storageClosed"),
      feature: t("common.billing.featureLocked"),
      seatsInApp: (count: number) => t("common.billing.limit", { count }),
      unavailableInApp: t("common.billing.unavailable"),
      pay: t("common.billing.pay"),
    };
    const free = tariffLimitPresentation({ code: BILLING_LIMIT_CODE, limit: 1, nextTier: "standard" }, copy, false);
    assert.equal(free?.message, copy.seatsToStandard(1));
    assert.equal(free?.href, BILLING_PAY_HREF);
    const standard = tariffLimitPresentation({ code: BILLING_LIMIT_CODE, limit: 50, nextTier: "premium" }, copy, false);
    assert.equal(standard?.message, copy.seatsToPremium(50));
    assert.ok(standard?.message.includes(formatNumber(locale, 100)), `${locale}: Premium seats named`);
    const premium = tariffLimitPresentation({ code: BILLING_LIMIT_CODE, limit: 100, nextTier: null }, copy, false);
    assert.equal(premium?.message, copy.seatsContact(100));
    assert.equal(premium?.contact, true);
    assert.equal(premium?.href, undefined, "Premium: contact, not the plan page");
    assert.equal(premium?.actionLabel, copy.contact);
    // В приложении — только факт, без призыва к оплате и без «связаться».
    assert.deepEqual(tariffLimitPresentation({ code: BILLING_LIMIT_CODE, limit: 100, nextTier: null }, copy, true), { message: copy.seatsInApp(100) });

    const errorCopy = {
      limit: t("common.billing.limit", { count: 25 }),
      limitAction: t("common.billing.limitAction", { count: 25 }),
      pay: t("common.billing.pay"),
      toStandard: t("common.billing.limitToStandard", { count: 25, seats: 25 }),
      toPremium: t("common.billing.limitToPremium", { count: 25, seats: 100 }),
      contact: t("common.billing.limitContact", { count: 25, seats: 100 }),
      contactLabel: t("common.billing.contact"),
    };
    assert.equal(billingErrorPresentation({ code: BILLING_LIMIT_CODE, nextTier: "premium" }, "x", errorCopy, false).message, errorCopy.toPremium);
    const contact = billingErrorPresentation({ code: BILLING_LIMIT_CODE, nextTier: null }, "x", errorCopy, false);
    assert.equal(contact.message, errorCopy.contact);
    assert.equal(contact.contact, true);
    assert.equal(contact.href, undefined);
  }
});

test("no text offers a location (or money) for more employees — catalogs, bot, server refusals, What's new", async () => {
  const { FREE_LIMIT_MESSAGE, FREE_LIMIT_INVITEE_MESSAGE, paidSeatLimitMessage, paidSeatLimitInviteeMessage } = await import("./billing-period");
  const { WHATS_NEW_NOTES } = await import("./whats-new-notes");
  const addLocation = /добав\S* точк|добавлени\S* точк|точку на странице|add a location|adding a location|nuqta qo‘sh/i;
  for (const locale of ["ru", "en", "uz"] as const) {
    const messages = await loadMessages(locale);
    const seatTexts = [
      ...Object.entries(messages.common.billing).filter(([key]) => key.startsWith("limit")).map(([, value]) => value),
      messages.telegram.bot.errors.inviteSeatLimit,
      messages.telegram.bot.errors.inviteSeatLimitPremium,
      messages.telegram.bot.errors.inviteSeatLimitContact,
      messages.settingsUi.usersPage.seatsNote,
      messages.settingsUi.usersPage.seatsNotePremium,
      messages.settingsUi.usersPage.seatsNoteContact,
      messages.settingsUi.subscriptionPage.rulePoints,
      messages.settingsUi.subscriptionPage.ruleSeats,
    ];
    for (const text of seatTexts) assert.doesNotMatch(text, addLocation, `${locale}: ${text}`);
  }
  const server = [
    FREE_LIMIT_MESSAGE,
    FREE_LIMIT_INVITEE_MESSAGE,
    paidSeatLimitMessage("standard"),
    paidSeatLimitMessage("premium"),
    paidSeatLimitInviteeMessage("standard"),
    paidSeatLimitInviteeMessage("premium"),
  ];
  for (const text of server) assert.doesNotMatch(text, addLocation, text);
  const notes = JSON.stringify(WHATS_NEW_NOTES);
  assert.doesNotMatch(notes, /за каждого сотрудника|до 3 сотрудников|бесплатных мест/i);
});
