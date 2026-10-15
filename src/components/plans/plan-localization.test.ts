/* eslint-disable react/no-children-prop -- React 19 provider typings require children in props. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider, createTranslator } from "next-intl";
import { AppRouterContext, type AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { PlanForm } from "./plan-form";
import { PLAN_SHIFTS, PLAN_PRIORITIES, planErrorKey, readPlanFormData } from "./plan-presentation";
import { loadMessages } from "@/i18n/messages";
import type { MessageContract } from "@/i18n/message-contract";
import { localDayKey } from "@/lib/entry-defaults";

const router: AppRouterInstance = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} };

test("production plan form renders all locales with local date and accessible controls", async () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    const messages = await loadMessages(locale);
    const t = createTranslator({ locale, messages: messages as MessageContract, namespace: "productionPlans", onError: error => { throw error; } });
    const beforeDate = localDayKey();
    const html = renderToStaticMarkup(createElement(NextIntlClientProvider, {
      locale, messages, timeZone: "Europe/Moscow", onError: error => { throw error; },
      children: createElement(AppRouterContext.Provider, { value: router, children: createElement(PlanForm) }),
    }));
    assert.ok(html.includes(`value="${beforeDate}"`) || html.includes(`value="${localDayKey()}"`));
    for (const text of [t("form.date"), t("form.items"), t("form.create"), t("form.addItem")]) assert.ok(html.includes(text), text);
    assert.ok(html.includes(`aria-label="${t("form.removeItem", { index: 1 })}"`));
    assert.ok(html.includes(`aria-label="${t("form.productLabel", { index: 1 })}"`));
    assert.ok(html.includes(`aria-label="${t("form.quantityLabel", { index: 1 })}"`));
    if (locale !== "ru") assert.doesNotMatch(html, /\p{Script=Cyrillic}/u);
    for (const value of PLAN_SHIFTS) assert.ok(t(`shiftOptions.${value}`));
    for (const value of PLAN_PRIORITIES) assert.ok(t(`priorities.${value}`));
    for (const count of [0, 1, 2, 5, 21]) assert.ok(t("itemsCount", { count }).includes(String(count)));
    assert.ok(t("week", { start: "2026-10-12", end: "2026-10-18" }).includes("2026-10-18"));
  }
});

test("plan payload keeps original names, numeric quantities, shift and priority codes", () => {
  const form = new FormData();
  form.set("date", "2026-10-15");
  form.set("notes", "Пользовательская заметка\nO‘zbekcha");
  const items = [
    { sku: "Продукт <A>", targetQuantity: 12.125, priority: "P1" },
    { sku: "", targetQuantity: 100, priority: "P2" },
    { sku: "Custom product", targetQuantity: 0, priority: "P3" },
  ];
  const snapshot = structuredClone(items);
  assert.deepEqual(readPlanFormData(form, "night", items), {
    date: "2026-10-15", shift: "night", items: [items[0], items[2]], notes: "Пользовательская заметка\nO‘zbekcha",
  });
  assert.deepEqual(items, snapshot);
  assert.equal(readPlanFormData(new FormData(), "morning", []).notes, null);
});

test("known plan API errors keep their meaning in each locale without leaking unknown details", async () => {
  const cases = [
    ["Не авторизован", "unauthorized"], ["Это действие доступно руководителю", "forbidden"],
    ["Некорректное тело", "invalidBody"], ["date обязательна", "dateRequired"], ["Некорректная дата", "invalidDate"],
    ["План на эту дату и смену уже есть. Откройте его в списке планов или выберите другую смену.", "duplicate"],
  ] as const;
  for (const [source, key] of cases) assert.equal(planErrorKey(source), key);
  assert.equal(planErrorKey("SQL details"), "saveFailed");
  assert.equal(planErrorKey("__proto__"), "saveFailed");
  assert.equal(planErrorKey(undefined, 409), "duplicate");
  for (const locale of ["ru", "en", "uz"] as const) {
    const messages = await loadMessages(locale);
    for (const [, key] of cases) {
      assert.ok(messages.productionPlans.errors[key]);
      if (locale !== "ru") assert.doesNotMatch(messages.productionPlans.errors[key], /\p{Script=Cyrillic}/u);
    }
  }
});
