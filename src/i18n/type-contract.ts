// Compile-time assertions. Never imported by the application.
import type { translatorFor } from "./translator";
import type { pricingTranslator } from "./pricing-messages";

function _verifyMessageArguments(t: Awaited<ReturnType<typeof translatorFor>>) {
  t("journals.progress", { filled: 2, total: 5 });
  t("journals.entryCount", { count: 2 });
  // @ts-expect-error Unknown keys must not silently render a fallback.
  t("journals.unknownMessage");
  // @ts-expect-error A complete sentence requires both interpolation arguments.
  t("journals.progress", { filled: 2 });
  // @ts-expect-error Plural counts are numbers, not preformatted display strings.
  t("journals.entryCount", { count: "2" });
}
export type MessageArgumentCheck = typeof _verifyMessageArguments;

function _verifyPricingArguments(t: ReturnType<typeof pricingTranslator>) {
  t("discount.percent", { value: 25 });
  // @ts-expect-error The standalone pricing domain has the same strict key checks.
  t("discount.unknownMessage");
  // @ts-expect-error Amounts are numeric ICU arguments, not formatted strings.
  t("discount.percent", { value: "25" });
  // @ts-expect-error Promotion badges require their end label too.
  t("promotion.badge", { percent: 25 });
}
export type PricingArgumentCheck = typeof _verifyPricingArguments;
