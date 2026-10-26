import assert from "node:assert/strict";
import test from "node:test";
import { billingErrorPresentation } from "./billing-limit-toast";
import { BILLING_LIMIT_CODE, BILLING_PAY_HREF } from "./billing-period";
import { translatorFor } from "@/i18n/translator";

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
