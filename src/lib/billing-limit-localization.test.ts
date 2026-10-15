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
