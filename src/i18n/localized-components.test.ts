/* eslint-disable react/no-children-prop -- In this .test.ts file, provider props require children for typed createElement calls. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider, useLocale, useNow, useTimeZone, useTranslations } from "next-intl";
import { DomainMessagesProvider } from "../components/i18n/domain-messages-provider";
import { ReportForm } from "../components/reports/report-form";
import { Testimonials } from "../components/landing/testimonials";
import { LegalConsentCheckbox } from "../components/legal/legal-consent-checkbox";
import { loadMessages } from "./messages";
import { legacyAuthErrorKey } from "./legacy-auth-errors";
import { translatorFor } from "./translator";
import { SelectionApplyButton, SelectionEditButton, SelectionRepeatButton, SelectionSignButton } from "../components/journals/selection-edit-button";
import { ExportLanguageChoice } from "../components/journals/export-language-choice";
import { LOCALES, LOCALE_NAMES } from "./locales";

test("export selection defaults to the employee language and offers all three languages", async () => {
  for (const locale of LOCALES) {
    const messages = await loadMessages(locale);
    const label = messages.journalControls.documentActions.exportLanguage;
    const html = renderToStaticMarkup(createElement(ExportLanguageChoice, { locale, label, onChange() {} }));
    assert.ok(html.includes(label));
    assert.match(html, new RegExp(`<option(?=[^>]*value="${locale}")(?=[^>]*selected="")[^>]*>`));
    assert.equal((html.match(/selected=""/g) ?? []).length, 1);
    for (const value of LOCALES) assert.ok(html.includes(LOCALE_NAMES[value]));
  }
});

test("journal selection actions render all count and busy states in the selected locale", async () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    const messages = await loadMessages(locale);
    const failures: string[] = [];
    const children = [0, 1, 3].flatMap(count => [
      createElement(SelectionEditButton, { key: `edit${count}`, count, onClick() {} }),
      createElement(SelectionApplyButton, { key: `apply${count}`, count, onClick() {} }),
      createElement(SelectionRepeatButton, { key: `repeat${count}`, count, onClick() {} }),
      createElement(SelectionSignButton, { key: `sign${count}`, count, onClick() {} }),
      createElement(SelectionSignButton, { key: `busy${count}`, count, busy: true, onClick() {} }),
    ]);
    const html = renderToStaticMarkup(createElement(NextIntlClientProvider, {
      locale, timeZone: "Europe/Moscow", messages: { journalControls: messages.journalControls },
      onError: error => failures.push(error.message), children,
    }));
    assert.deepEqual(failures, []);
    assert.equal((html.match(/data-testid="selection-apply"/g) ?? []).length, 1);
    assert.ok(html.includes(messages.journalControls.selection.signing));
    assert.ok(html.includes(messages.journalControls.selection.editHint));
    if (locale !== "ru") assert.doesNotMatch(html, /[А-Яа-яЁё]/);
  }
});

test("rated customer testimonials render localized accessibility text and retain original reviews", async () => {
  const review = { id: "fixture", quote: "Записи O‘tkir остаются в оригинале", author: "Иван O‘tkir", place: "Кафе <One>", rating: 4, mediaUrl: null, mediaKind: null };
  for (const locale of ["ru", "en", "uz"] as const) {
    const messages = await loadMessages(locale);
    const failures: string[] = [];
    const html = renderToStaticMarkup(createElement(NextIntlClientProvider, {
      locale, timeZone: "Europe/Moscow", messages: { landingComponents: messages.landingComponents }, onError: (error) => failures.push(error.message),
      children: createElement(Testimonials, { locale, reviews: [review] }),
    }));
    assert.deepEqual(failures, []);
    assert.ok(html.includes(review.quote));
    assert.ok(html.includes(review.author));
    assert.ok(html.includes("Кафе &lt;One&gt;"));
    assert.match(html, /aria-label="[^\"]*4[^\"]*"/);
    if (locale !== "ru") assert.ok(html.includes(messages.landingComponents.testimonials.originalLanguageNote));
  }
});

test("domain message providers inherit locale and preserve parent namespaces", async () => {
  const rootMessages = await loadMessages("en");
  const now = new Date("2024-01-15T12:00:00.000Z");
  function Probe() {
    const locale = useLocale();
    const currentTime = useNow();
    const timeZone = useTimeZone();
    const common = useTranslations("common");
    const report = useTranslations("reports.form");
    return createElement("p", { lang: locale, "data-time-zone": timeZone, "data-now": currentTime.toISOString() }, `${common("save")} | ${report("title")}`);
  }

  const html = renderToStaticMarkup(createElement(NextIntlClientProvider, {
    locale: "en",
    now,
    timeZone: "Asia/Tashkent",
    messages: { common: rootMessages.common },
    children: createElement(DomainMessagesProvider, {
      messages: { reports: rootMessages.reports },
      children: createElement(Probe),
    }),
  }));

  assert.equal(html, `<p lang="en" data-time-zone="Asia/Tashkent" data-now="${now.toISOString()}">Save | Generate report</p>`);
});

test("report and legal consent components render their real catalogs in every locale", async () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    const messages = await loadMessages(locale);
    const failures: string[] = [];
    const html = renderToStaticMarkup(createElement(NextIntlClientProvider, {
      locale, messages, timeZone: "Asia/Tashkent", onError: (error) => failures.push(error.message),
      children: [
        createElement(ReportForm, { key: "report", templates: [], areas: [] }),
        createElement(LegalConsentCheckbox, { key: "consent", checked: false, onChange: () => {} }),
      ],
    }));
    assert.deepEqual(failures, [], `${locale}: missing keys or ICU errors`);
    assert.ok(html.includes(messages.reports.form.title));
    assert.ok(html.includes(messages.language.exportLabel));
    for (const href of ["/oferta", "/terms", "/privacy", "/consent"]) assert.ok(html.includes(`href="${href}"`));
    if (locale !== "ru") assert.doesNotMatch(html, /[А-Яа-яЁё]/);
  }
});

test("known legacy auth failures retain rate-limit meaning and arbitrary messages cannot become keys", async () => {
  const key = legacyAuthErrorKey("Слишком много попыток входа. Подождите 5 минут.");
  assert.equal(key, "loginRateLimited");
  for (const input of [null, {}, "__proto__", "constructor", "unexpected server detail"]) assert.equal(legacyAuthErrorKey(input), null);
  for (const locale of ["ru", "en", "uz"] as const) {
    const t = await translatorFor(locale);
    const message = t("auth.apiErrors.loginRateLimited", { minutes: 5 });
    assert.match(message, /5/);
    if (locale !== "ru") assert.doesNotMatch(message, /[А-Яа-яЁё]/);
  }
});
