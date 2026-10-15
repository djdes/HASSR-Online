/* eslint-disable react/no-children-prop -- React provider typings require children. */
import assert from "node:assert/strict";
import test from "node:test";
import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import AppError from "@/app/error";
import GlobalError from "@/app/global-error";
import { NotFoundCard } from "@/components/layout/not-found-card";
import { emergencyLocale, emergencyTranslator } from "./emergency-messages";
import { loadMessages } from "./messages";
import { loadConfirmMessages } from "./confirm-messages";
import { JournalRouteError } from "@/components/journals/journal-route-error";
import MiniError from "@/app/mini/error";
import MiniLoading from "@/app/mini/loading";
import { MiniListSkeleton } from "@/app/mini/_components/mini-list-skeleton";

test("journal route failures and Mini App fallbacks use the selected locale without exposing errors", async () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    const messages = await loadMessages(locale);
    const error = Object.assign(new Error("private backend exception"), { digest: "journal-42" });
    const html = renderToStaticMarkup(createElement(NextIntlClientProvider, {
      locale, messages: { errorSurface: messages.errorSurface }, timeZone: "Europe/Moscow", onError: error => { throw error; },
      children: createElement(Fragment, null,
        ...(["journal", "journals", "documents", "document"] as const).map(variant => createElement(JournalRouteError, { key: variant, variant, error, reset() {}, backHref: "/journals" })),
        createElement(MiniError, { error, reset() {} }), createElement(MiniLoading), createElement(MiniListSkeleton)),
    }));
    for (const variant of ["journal", "journals", "documents", "document", "mini"] as const) assert.ok(html.includes(messages.errorSurface[`${variant}Title`]));
    assert.ok(html.includes("journal-42"));
    assert.ok(!html.includes(error.message));
    assert.ok(html.includes('href="/journals"'));
    if (locale !== "ru") assert.doesNotMatch(html, /\p{Script=Cyrillic}/u);
  }
});

test("error and not-found screens render real translations without disclosing exception details", async () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    const messages = await loadMessages(locale);
    const error = Object.assign(new Error("internal private detail"), { digest: "trace-123" });
    const html = renderToStaticMarkup(createElement(NextIntlClientProvider, {
      locale, messages: { errorSurface: messages.errorSurface }, timeZone: "Europe/Moscow", onError: error => { throw error; },
      children: createElement(Fragment, null, createElement(AppError, { error, reset() {} }), createElement(NotFoundCard)),
    }));
    assert.ok(html.includes(messages.errorSurface.errorTitle));
    assert.ok(html.includes(messages.errorSurface.notFoundTitle));
    assert.ok(html.includes("trace-123"));
    assert.ok(!html.includes(error.message));
    assert.ok(html.includes(`href="${locale === "ru" ? "/" : `/${locale}`}"`));
    if (locale !== "ru") assert.doesNotMatch(html, /\p{Script=Cyrillic}/u);
  }
});

test("emergency error screen works without providers; URL, saved choice and document language have deterministic fallbacks", () => {
  const cookie = "wesetup.site-locale=uz";
  assert.equal(emergencyLocale("/en/example", cookie, "ru"), "en");
  assert.equal(emergencyLocale("/dashboard", cookie, "ru"), "uz");
  assert.equal(emergencyLocale("/dashboard", "wesetup.site-locale=invalid", "en"), "en");
  assert.equal(emergencyLocale("/dashboard", "", "invalid"), "ru");
  const html = renderToStaticMarkup(createElement(GlobalError, { error: new Error("sensitive internal detail"), reset() {} }));
  assert.ok(html.includes('<html lang="ru">'));
  assert.ok(!html.includes("sensitive internal detail"));
  for (const locale of ["ru", "en", "uz"] as const) {
    const t = emergencyTranslator(locale);
    assert.ok(t("code", { code: "trace-42" }).includes("trace-42"));
    if (locale !== "ru") assert.doesNotMatch(t("globalDescription"), /\p{Script=Cyrillic}/u);
  }
});

test("imperative dialogs load only their own copy and common action defaults", async () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    const messages = await loadMessages(locale);
    const portal = await loadConfirmMessages(locale);
    assert.deepEqual(portal, {
      common: { delete: messages.common.delete, save: messages.common.save, cancel: messages.common.cancel, close: messages.common.close },
      journalControls: { confirm: messages.journalControls.confirm },
    });
    assert.ok(JSON.stringify(portal).length < 3000);
  }
});
