/* eslint-disable react/no-children-prop -- React 19 provider typings require children in props. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider, createTranslator } from "next-intl";
import { AppRouterContext, type AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { LossForm } from "./loss-form";
import { LOSS_CATEGORIES, LOSS_UNITS, lossErrorKey, lossUnitCode, readLossFormData } from "./loss-presentation";
import { loadMessages } from "@/i18n/messages";
import type { MessageContract } from "@/i18n/message-contract";
import { formatNumber } from "@/i18n/locales";

const router: AppRouterInstance = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} };

test("loss form renders localized fields with and without production areas", async () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    const messages = await loadMessages(locale);
    for (const areas of [[], [{ id: "area-original-id", name: "Customer area" }]]) {
      const html = renderToStaticMarkup(createElement(NextIntlClientProvider, {
        locale, messages, timeZone: "Europe/Moscow", onError: error => { throw error; },
        children: createElement(AppRouterContext.Provider, { value: router, children: createElement(LossForm, { areas }) }),
      }));
      for (const text of [messages.productionLosses.form.category, messages.productionLosses.form.product,
        messages.productionLosses.form.quantity, messages.productionLosses.form.cost, messages.productionLosses.form.save]) assert.ok(html.includes(text), text);
      assert.ok(html.includes('name="costRub"'));
      assert.ok(html.includes('name="productName"'));
      assert.equal(html.includes('id="loss-area"'), areas.length > 0);
      if (locale !== "ru") assert.doesNotMatch(html, /\p{Script=Cyrillic}/u);
    }
  }
});

test("loss presentation translates category and unit codes while keeping currency RUB", async () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    const messages = await loadMessages(locale);
    const t = createTranslator({ locale, messages: messages as MessageContract, namespace: "productionLosses", onError: error => { throw error; } });
    for (const code of LOSS_CATEGORIES) assert.ok(t(`categories.${code}`));
    for (const code of LOSS_UNITS) assert.ok(t(`units.${code}`));
    const amount = formatNumber(locale, 1234.56789, { maximumFractionDigits: 20 });
    const cost = t("rubles", { amount });
    assert.ok(cost.includes(amount));
    assert.ok(cost.includes("₽"));
    const summary = t("quantityCostSummary", { quantity: "4.5", cost });
    assert.ok(summary.includes(cost));
    assert.ok(summary.includes("4.5"));
    if (locale !== "ru") assert.doesNotMatch(summary, /\p{Script=Cyrillic}/u);
    assert.ok(t("fromWriteoff", { date: "2026-10-15" }).includes("2026-10-15"));
  }
  assert.equal(lossUnitCode("KG"), "kg");
  assert.equal(lossUnitCode("пользовательская мера"), null);
  assert.equal(lossUnitCode("__proto__"), null);
});

test("loss request preserves raw names, decimal values, category and area identity", () => {
  const form = new FormData();
  form.set("productName", "Продукт O‘zbekcha");
  form.set("quantity", "12.50");
  form.set("costRub", "150.75");
  form.set("cause", "Исходная причина\nCustomer text");
  assert.deepEqual(readLossFormData(form, { category: "packaging_defect", unit: "kg", areaId: "area-original-id" }), {
    category: "packaging_defect", productName: "Продукт O‘zbekcha", quantity: "12.50", unit: "kg",
    costRub: "150.75", cause: "Исходная причина\nCustomer text", areaId: "area-original-id",
  });
  form.set("costRub", "0");
  assert.equal(readLossFormData(form, { category: "other", unit: "custom", areaId: "" }).costRub, "0");
  form.set("costRub", "");
  assert.equal(readLossFormData(form, { category: "other", unit: "custom", areaId: "" }).costRub, null);
});

test("loss API validation failures use stable local message keys", async () => {
  const cases = [
    ["Не авторизован", "unauthorized"], ["productName обязателен", "productRequired"],
    ["quantity должен быть положительным числом", "quantityInvalid"], ["costRub должен быть положительным числом", "costInvalid"],
    ["Некорректная дата", "dateInvalid"], ["Помещение не найдено", "areaNotFound"],
  ] as const;
  for (const [source, key] of cases) assert.equal(lossErrorKey(source), key);
  assert.equal(lossErrorKey("Database failure"), "saveFailed");
  assert.equal(lossErrorKey("__proto__"), "saveFailed");
  for (const locale of ["ru", "en", "uz"] as const) {
    const messages = await loadMessages(locale);
    for (const [, key] of cases) {
      assert.ok(messages.productionLosses.errors[key]);
      if (locale !== "ru") assert.doesNotMatch(messages.productionLosses.errors[key], /\p{Script=Cyrillic}/u);
    }
  }
});
