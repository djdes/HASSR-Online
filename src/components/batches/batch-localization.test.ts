/* eslint-disable react/no-children-prop -- React 19 provider typings require children in the props object. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider, createTranslator } from "next-intl";
import { AppRouterContext, type AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { BatchForm } from "./batch-form";
import { BatchStatusActions, STATUS_TRANSITIONS } from "./batch-status-actions";
import { batchErrorKey, batchUnitCode, readBatchFormData, BATCH_STATUSES, BATCH_FILTERS } from "./batch-presentation";
import { loadMessages } from "@/i18n/messages";
import type { MessageContract } from "@/i18n/message-contract";

const router: AppRouterInstance = {
  back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {},
};

test("batch form and every actionable status render localized UI with persisted field values", async () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    const messages = await loadMessages(locale);
    const html = renderToStaticMarkup(createElement(NextIntlClientProvider, {
      locale, messages, timeZone: "Europe/Moscow", onError: error => { throw error; },
      children: createElement(AppRouterContext.Provider, {
        value: router,
        children: createElement(Fragment, null,
          createElement(BatchForm),
          ...BATCH_STATUSES.map(currentStatus => createElement(BatchStatusActions, { key: currentStatus, batchId: "B-custom", currentStatus })),
        ),
      }),
    }));
    assert.ok(html.includes(messages.productionBatches.form.productName));
    assert.ok(html.includes(messages.productionBatches.form.create));
    assert.ok(html.includes(messages.productionBatches.actions.in_production));
    assert.ok(html.includes(messages.productionBatches.actions.finished));
    assert.ok(html.includes(messages.productionBatches.actions.shipped));
    assert.ok(html.includes(messages.productionBatches.actions.written_off));
    assert.ok(html.includes('name="productName"'));
    assert.ok(html.includes('name="supplier"'));
    assert.ok(html.includes('name="quantity"'));
    assert.ok(html.includes('name="notes"'));
    if (locale !== "ru") assert.doesNotMatch(html, /\p{Script=Cyrillic}/u);
  }
});

test("batch request data remains original across translated unit labels", () => {
  const expected = {
    productName: "Сыр O‘zbekcha", supplier: "Поставщик Example", quantity: "12.50",
    unit: "kg", expiryDate: "2026-10-14", notes: "Проверено — original",
  };
  for (const unit of ["kg", "l", "pcs", "пользовательская мера"]) {
    const form = new FormData();
    for (const [key, value] of Object.entries({ ...expected, unit })) form.set(key, value);
    assert.deepEqual(readBatchFormData(form), { ...expected, unit });
  }
  const empty = new FormData();
  empty.set("expiryDate", "");
  empty.set("notes", "");
  assert.equal(readBatchFormData(empty).expiryDate, null);
  assert.equal(readBatchFormData(empty).notes, null);
});

test("batch filters, statuses, units and ICU day counts share stable identities in all locales", async () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    const messages = await loadMessages(locale);
    const t = createTranslator({ locale, messages: messages as MessageContract, namespace: "productionBatches", onError: error => { throw error; } });
    for (const status of BATCH_STATUSES) assert.ok(t(`statuses.${status}`));
    for (const filter of BATCH_FILTERS) assert.ok(t(`filters.${filter}`));
    for (const days of [1, 2, 5, 21]) assert.match(t("daysLeft", { days }), new RegExp(String(days)));
    assert.equal(batchUnitCode("KG"), "kg");
    assert.equal(batchUnitCode("пользовательская мера"), null);
    assert.equal(batchUnitCode("__proto__"), null);
    assert.ok(t("fromReceipt", { date: "2026-10-14" }).includes("2026-10-14"));
    assert.equal(t("entryAuthor", { date: "2026-10-14", name: "Анвар <Иван>" }), "2026-10-14 — Анвар <Иван>");
  }
  assert.deepEqual(STATUS_TRANSITIONS.received.map(item => item.next), ["in_production", "written_off"]);
  assert.deepEqual(STATUS_TRANSITIONS.in_production.map(item => item.next), ["finished", "written_off"]);
  assert.deepEqual(STATUS_TRANSITIONS.finished.map(item => item.next), ["shipped", "written_off"]);
});

test("batch API legacy responses map to localized errors without exposing server details", async () => {
  const errors = [
    ["Не авторизован", "unauthorized"],
    ["productName обязателен", "productRequired"],
    ["quantity должен быть положительным числом", "quantityInvalid"],
    ["Некорректная дата", "dateInvalid"],
    ["Некорректная дата поступления", "receivedDateInvalid"],
    ["Не удалось сгенерировать уникальный код партии. Попробуйте ещё раз.", "codeUnavailable"],
    ["Это действие доступно руководителю", "forbidden"],
    ["Не найдено", "notFound"],
    ["Неизвестный статус партии", "statusInvalid"],
  ] as const;
  for (const [source, key] of errors) assert.equal(batchErrorKey(source), key);
  assert.equal(batchErrorKey("Internal database details"), "saveFailed");
  assert.equal(batchErrorKey("__proto__"), "saveFailed");
  assert.equal(batchErrorKey(undefined, 403), "forbidden");
  for (const locale of ["ru", "en", "uz"] as const) {
    const messages = await loadMessages(locale);
    for (const [, key] of errors) {
      assert.ok(messages.productionBatches.errors[key]);
      if (locale !== "ru") assert.doesNotMatch(messages.productionBatches.errors[key], /\p{Script=Cyrillic}/u);
    }
  }
});
