import assert from "node:assert/strict";
import test from "node:test";
import { createTranslator } from "next-intl";
import ru from "@/i18n/messages/ru.json";
import en from "@/i18n/messages/en.json";
import uz from "@/i18n/messages/uz.json";
import { formatServicePrice, SERVICE_CATEGORY_LABEL, SERVICE_CATEGORY_ORDER } from "@/lib/services/constants";
import { serviceCategoryLabel, servicePriceLabel, serviceSaveError } from "./service-presentation";

const catalogs = { ru, en, uz };
test("price copy retains original amounts, nullable/custom-identical units and all RU bytes", () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    const t = createTranslator({ locale, messages: catalogs[locale], namespace: "rootServices" });
    for (const priceRub of [null, 0, 1, 1000, 4000, 12500, 12500.25, -1, Number.NaN, Infinity]) {
      for (const priceFrom of [false, true]) for (const unit of [null, "", "за услугу", "в месяц", "Custom Oʻtkir", " "]) {
        const input = { priceRub, priceFrom, unit }, snapshot = { ...input };
        const actual = servicePriceLabel(input, t);
        if (locale === "ru") assert.equal(actual, formatServicePrice(input));
        else if (priceRub === null) assert.equal(actual, catalogs[locale].rootServices.priceOnRequest);
        else {
          const amount = priceRub.toLocaleString("ru-RU"), suffix = unit ? " " + unit : "";
          assert.equal(actual, locale === "en"
            ? `${priceFrom ? "from " : ""}${amount} ₽${suffix}`
            : `${amount} ₽${priceFrom ? " dan" : ""}${suffix}`);
        }
        assert.deepEqual(input, snapshot);
      }
    }
  }
});

test("categories translate only exact own stable codes, not raw names or prototype keys", () => {
  const keys = { setup: "categorySetup", consult: "categoryConsult", audit: "categoryAudit", docs: "categoryDocs" } as const;
  for (const locale of ["ru", "en", "uz"] as const) {
    const t = createTranslator({ locale, messages: catalogs[locale], namespace: "rootServices" });
    for (const code of SERVICE_CATEGORY_ORDER) {
      assert.equal(serviceCategoryLabel(code, t), t(keys[code]));
      if (locale === "ru") assert.equal(serviceCategoryLabel(code, t), SERVICE_CATEGORY_LABEL[code]);
    }
    for (const code of ["__proto__", "constructor", "unknown", "Настройка и запуск", ""]) assert.equal(serviceCategoryLabel(code, t), code);
  }
});

test("known endpoint errors translate and all unproved server/network prose uses a safe fallback", () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    const t = createTranslator({ locale, messages: catalogs[locale], namespace: "rootServices" });
    assert.equal(serviceSaveError("Услуга не найдена", t), t("notFound"));
    assert.equal(serviceSaveError("Нечего менять", t), t("noChanges"));
    assert.equal(serviceSaveError("Некорректный запрос", t), t("invalidRequest"));
    for (const error of [null, undefined, 0, {}, "constructor", "__proto__", "PRIVATE RAW", "Название клиента"]) assert.equal(serviceSaveError(error, t), t("saveFailed"));
  }
});
