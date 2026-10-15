import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { validateCatalog } from "./catalog-validation";
import { pricingTranslator } from "./pricing-messages";
import ru from "./messages/pricing/ru.json";
import en from "./messages/pricing/en.json";
import uz from "./messages/pricing/uz.json";
import { discountLabel, type AppliedDiscount } from "@/lib/promo/discounts";
import { promotionBadgeLabel, promotionEndHint, promotionEndLabel } from "@/lib/promo/promotions";
import { formatPriceRub } from "@/components/pricing/promo-price";

describe("pricing localization", () => {
  it("keeps all three pricing catalogs in ICU parity", () => {
    assert.deepEqual(validateCatalog(ru, en), []);
    assert.deepEqual(validateCatalog(ru, uz), []);
  });

  it("formats reusable price labels in each explicit locale", () => {
    const expected = {
      ru: ["Обычная цена до акции", "Обычная цена до скидки", "Цена со скидкой"],
      en: ["Regular price before promotion", "Regular price before discount", "Discounted price"],
      uz: ["Aksiya boshlanishidan oldingi odatiy narx", "Chegirmadan oldingi odatiy narx", "Chegirmali narx"],
    } as const;
    for (const locale of ["ru", "en", "uz"] as const) {
      const t = pricingTranslator(locale);
      assert.deepEqual([
        t("price.regularBeforePromotion"),
        t("price.regularBeforeDiscount"),
        t("price.discountedPrice"),
      ], expected[locale]);
    }
  });

  it("localizes promotion and discount labels without changing user codes", () => {
    const endings = {
      ru: "до 10 октября",
      en: "until 10 October",
      uz: "10-oktabrgacha",
    };
    const promotion = { percent: 25, endsAt: "2026-10-10T21:00:00.000Z" };
    const discount: AppliedDiscount = {
      source: "code", code: "PARTNER500", kind: "fixed", value: 500,
      lifetime: true, discountRub: 500, lifetimeDiscountId: null,
    };
    for (const locale of ["ru", "en", "uz"] as const) {
      assert.equal(promotionEndLabel(promotion.endsAt, locale), endings[locale]);
      assert.ok(promotionBadgeLabel(promotion, locale).includes(endings[locale]));
      assert.ok(promotionEndHint(promotion, locale).length > 0);
      assert.ok(discountLabel(discount, locale).includes("PARTNER500"));
    }
    assert.equal(discountLabel(discount, "ru"), "Промокод PARTNER500: −500 ₽ навсегда");
  });

  it("formats Uzbekistan prices with the Uzbek Latin number locale", () => {
    assert.equal(
      formatPriceRub(1_234_567, "uz"),
      `${new Intl.NumberFormat("uz-Latn-UZ").format(1_234_567)} ₽`,
    );
  });
});
