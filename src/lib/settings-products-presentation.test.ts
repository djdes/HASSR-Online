import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createTranslator } from "use-intl/core";
import ru from "@/i18n/messages/ru.json";
import en from "@/i18n/messages/en.json";
import uz from "@/i18n/messages/uz.json";
import { formatMeasureUnit, parseMeasureUnitInput } from "./measure-units";
import { productPageUnit, productEditorUnit, parseProductUnitInput, productErrorKey, productUsageMessages } from "./settings-products-presentation";

const locales = ["ru", "en", "uz"] as const;
const messages = { ru, en, uz };

test("six exact page codes remain distinct from eight normalized editor codes", () => {
  for (const locale of locales) {
    const t = createTranslator({ locale, messages: messages[locale], namespace: "settingsProducts" });
    for (const code of ["kg", "l", "pcs", "g", "ml", "pack"] as const) {
      assert.equal(productPageUnit(code, t), t(`units.${code}`));
    }
    for (const raw of ["pc", "bottle", " KG ", " kg ", "custom Сыр", "constructor", "__proto__", "toString", "hasOwnProperty", ""]) {
      assert.equal(productPageUnit(raw, t), raw);
    }
    for (const code of ["kg", "g", "l", "ml", "pcs", "pc", "bottle", "pack"] as const) {
      assert.equal(productEditorUnit(` ${code.toUpperCase()} `, t), t(`units.${code}`));
      if (locale === "ru") assert.equal(productEditorUnit(code, t), formatMeasureUnit(code));
    }
    for (const raw of [" Custom Сыр ", " constructor ", "__proto__", "toString", "hasOwnProperty", "   "]) {
      assert.equal(productEditorUnit(raw, t), raw.trim());
    }
  }
});

test("only actual typing parses aliases; canonical pc identity and selected-locale boundaries remain exact", () => {
  for (const locale of locales) {
    for (const code of ["kg", "g", "l", "ml", "pcs", "pc", "bottle", "pack"]) {
      assert.equal(parseProductUnitInput(` ${code} `, locale), code);
    }
    for (const alias of ["кг", "г", "л", "мл", "шт", "фл", "уп", " ШТ "]) {
      assert.equal(parseProductUnitInput(alias, locale), parseMeasureUnitInput(alias));
    }
    for (const raw of [" Customer Blend ", "PC", "KG", "constructor", "__proto__", "toString", "hasOwnProperty", ""]) {
      assert.equal(parseProductUnitInput(raw, locale), raw.trim());
    }
  }
  assert.equal(parseProductUnitInput("btl", "en"), "bottle");
  assert.equal(parseProductUnitInput("btl", "uz"), "btl");
  for (const [label, code] of [["dona", "pcs"], ["flakon", "bottle"], ["qadoq", "pack"]]) {
    assert.equal(parseProductUnitInput(label, "uz"), code);
    assert.equal(parseProductUnitInput(label, "en"), label);
  }
});

test("error adapter accepts only own finite method and status applicable producer codes", () => {
  const cases = [
    ["PRODUCT_UNAUTHORIZED", "errors.unauthorized", 401, ["POST", "PUT", "DELETE"]],
    ["PRODUCT_MANAGEMENT_REQUIRED", "errors.managementRequired", 403, ["POST", "PUT", "DELETE"]],
    ["PRODUCT_ID_REQUIRED", "errors.idRequired", 400, ["PUT", "DELETE"]],
    ["PRODUCT_NOT_FOUND", "errors.notFound", 404, ["PUT", "DELETE"]],
    ["PRODUCT_NAME_REQUIRED_CREATE", "errors.nameRequiredCreate", 400, ["POST"]],
    ["PRODUCT_NAME_REQUIRED_UPDATE", "errors.nameRequiredUpdate", 400, ["PUT"]],
    ["PRODUCT_DUPLICATE_NAME", "errors.duplicateName", 400, ["POST"]],
    ["PRODUCT_FAILED", "errors.failed", 500, ["POST", "PUT", "DELETE"]],
  ] as const;
  for (const [code, key, status, allowed] of cases) {
    for (const method of ["POST", "PUT", "DELETE"] as const) {
      assert.equal(productErrorKey({ errorCode: code, error: "Never show this" }, method, status),
        (allowed as readonly string[]).includes(method) ? key : null);
      assert.equal(productErrorKey({ errorCode: code }, method, status + 1), null);
    }
  }
  for (const value of [null, [], "PRODUCT_FAILED", { error: "Ошибка" }, { errorCode: null },
    { errorCode: "constructor" }, { errorCode: "__proto__" }, { errorCode: "UNKNOWN" },
    Object.create({ errorCode: "PRODUCT_FAILED" }), Object.assign([], { errorCode: "PRODUCT_FAILED" })]) {
    assert.equal(productErrorKey(value, "POST", 500), null);
  }
  assert.equal(productErrorKey(Object.assign(Object.create(null), { errorCode: "PRODUCT_FAILED" }), "POST", 500), "errors.failed");
});

test("usage warning parser requires versioned own descriptors and never guesses from old prose", () => {
  const wrap = (warnings: unknown) => ({ usagePresentation: { version: 1, warnings } });
  const valid = { code: "PRODUCT_USAGE_EXISTING_DOCUMENTS", params: { name: "Producer <raw> {name}", count: 21 } };
  assert.deepEqual(productUsageMessages(wrap([valid, { code: "PRODUCT_USAGE_REMOVED_FROM_CHOICES" }])), [
    { key: "usage.existingDocuments", params: { name: "Producer <raw> {name}", count: 21 } }, { key: "usage.removedFromChoices" },
  ]);
  for (const value of [null, [], { bullets: ["Продукт пока нигде не используется в журналах"] },
    { usagePresentation: { version: "1", warnings: [valid] } }, { usagePresentation: { version: 2, warnings: [valid] } },
    { usagePresentation: Object.create({ version: 1, warnings: [valid] }) },
    Object.create(wrap([valid])), { usagePresentation: { version: 1, warnings: {} } }]) {
    assert.deepEqual(productUsageMessages(value), []);
  }
  const invalid = [null, [], { code: "UNKNOWN" }, Object.create(valid),
    { code: "PRODUCT_USAGE_UNUSED", params: {} }, { code: "PRODUCT_USAGE_REMOVED_FROM_CHOICES", params: undefined },
    ...[0, -1, 1.2, "1", null, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1].map(count => ({ ...valid, params: { name: "raw", count } })),
    { ...valid, params: { count: 1 } }, { ...valid, params: { name: 1, count: 1 } },
    { ...valid, params: Object.create({ name: "raw", count: 1 }) }, { ...valid, params: { name: "raw", count: 1, extra: true } }];
  assert.deepEqual(productUsageMessages(wrap([...invalid, { code: "PRODUCT_USAGE_UNUSED" }, valid])), [
    { key: "usage.unused" }, { key: "usage.existingDocuments", params: valid.params },
  ]);
});

test("actual ICU whole warning sentences preserve safe ungrouped counts and escaped source names", () => {
  for (const locale of locales) {
    const t = createTranslator({ locale, messages: messages[locale], namespace: "settingsProducts" });
    for (const count of [0, 1, 2, 5, 21, 12500]) {
      const warnings = count === 0 ? [{ code: "PRODUCT_USAGE_UNUSED" }] : [
        { code: "PRODUCT_USAGE_EXISTING_DOCUMENTS", params: { name: "<raw> {count}", count } },
      ];
      const parsed = productUsageMessages({ usagePresentation: { version: 1, warnings } });
      assert.equal(parsed.length, 1);
      const warning = parsed[0];
      const text = warning.key === "usage.existingDocuments"
        ? t(warning.key, { name: warning.params.name, count: String(warning.params.count) }) : t(warning.key);
      assert.ok(!text.includes("settingsProducts."));
      if (count) {
        assert.ok(text.includes(String(count)));
        assert.ok(text.includes("<raw> {count}"));
        assert.ok(!text.includes("12,500") && !text.includes("12 500"));
        const html = renderToStaticMarkup(createElement("span", null, text));
        assert.ok(html.includes("&lt;raw&gt;"));
        assert.ok(!html.includes("<raw>"));
      } else assert.equal(text, messages[locale].settingsProducts.usage.unused);
    }
  }
});
