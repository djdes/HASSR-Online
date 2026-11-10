/* eslint-disable react/no-children-prop -- React 19 provider typings require children in props. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider, createTranslator } from "next-intl";
import { AppRouterContext, type AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { ChangeForm } from "./change-form";
import { CHANGE_TYPES, CHANGE_STATUSES, changeErrorKey, readChangeFormData } from "./change-presentation";
import { loadMessages } from "@/i18n/messages";
import type { MessageContract } from "@/i18n/message-contract";

const router: AppRouterInstance = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} };

test("change request form renders real catalogs in RU/EN/UZ", async () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    const messages = await loadMessages(locale);
    const t = createTranslator({ locale, messages: messages as MessageContract, namespace: "changeManagement", onError: error => { throw error; } });
    const html = renderToStaticMarkup(createElement(NextIntlClientProvider, {
      locale, messages, timeZone: "Europe/Moscow", onError: error => { throw error; },
      children: createElement(AppRouterContext.Provider, { value: router, children: createElement(ChangeForm) }),
    }));
    for (const text of [t("form.title"), t("form.description"), t("form.riskAssessment"), t("form.create")]) assert.ok(html.includes(text), text);
    assert.ok(html.includes('name="riskAssessment"'));
    assert.ok(html.includes('name="description"'));
    assert.ok(html.includes('id="change-type"'));
    if (locale !== "ru") assert.doesNotMatch(html, /\p{Script=Cyrillic}/u);
    for (const code of CHANGE_TYPES) assert.ok(t(`types.${code}`));
    for (const code of CHANGE_STATUSES) assert.ok(t(`statuses.${code}`));
    for (const source of ["Не авторизован", "Заголовок обязателен", "Internal details"]) {
      const error = t(`errors.${changeErrorKey(source)}`);
      assert.ok(error);
      if (locale !== "ru") assert.doesNotMatch(error, /\p{Script=Cyrillic}/u);
    }
  }
});

test("change payloads preserve type codes and original user-authored risk descriptions", () => {
  const form = new FormData();
  form.set("title", "Новый поставщик O‘zbekcha");
  form.set("description", "Исходный текст\nOriginal details");
  form.set("riskAssessment", "Allergen <A> — пользовательский текст");
  for (const changeType of CHANGE_TYPES) assert.deepEqual(readChangeFormData(form, changeType), {
    title: "Новый поставщик O‘zbekcha", changeType, description: "Исходный текст\nOriginal details", riskAssessment: "Allergen <A> — пользовательский текст",
  });
  assert.equal(readChangeFormData(new FormData(), "recipe").riskAssessment, null);
  assert.equal(changeErrorKey("__proto__"), "saveFailed");
  assert.equal(changeErrorKey(undefined, 401), "unauthorized");
});
