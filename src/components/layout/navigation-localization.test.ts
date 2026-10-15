/* eslint-disable react/no-children-prop -- Explicit provider children for SSR tests. */
import assert from "node:assert/strict";
import test from "node:test";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { createTranslator } from "use-intl/core";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { PathnameContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import { loadMessages } from "@/i18n/messages";
import type { Locale } from "@/i18n/locales";
import { CustomNamesProvider } from "@/components/shared/custom-names-provider";
import { JournalPageCrumbs } from "@/components/journals/journal-breadcrumbs";
import { MiniTopBar, titleForPath, titleForSitePath } from "@/app/mini/_components/mini-shell";
import { PageNav } from "./page-nav";

const router = { back() {}, forward() {}, refresh() {}, hmrRefresh() {}, push() {}, replace() {}, prefetch() {} };

async function renderNavigation(locale: Locale, pathname: string, child: ReactNode, custom = false) {
  const messages = await loadMessages(locale);
  return renderToStaticMarkup(createElement(AppRouterContext.Provider, {
    value: router,
    children: createElement(PathnameContext.Provider, {
      value: pathname,
      children: createElement(NextIntlClientProvider, {
        locale, messages: { common: messages.common, navigation: messages.navigation, journalControls: messages.journalControls, journals: messages.journals },
        timeZone: "Europe/Moscow", onError: error => { throw error; },
        children: createElement(CustomNamesProvider, {
          names: custom ? { journals: { cleaning: "Свой журнал O‘tkir" }, sections: { staff: "Своя команда" } } : { journals: {}, sections: {} },
          children: child,
        }),
      }),
    }),
  }));
}

test("real page navigation and journal breadcrumbs localize built-in captions while retaining customer text", async () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    const messages = await loadMessages(locale);
    const page = await renderNavigation(locale, "/settings/equipment", createElement(PageNav, { organizationName: "ACME O‘tkir" }));
    assert.ok(page.includes(messages.navigation.routes.settings_equipment));
    assert.ok(page.includes(messages.common.back));
    assert.ok(page.includes("ACME O‘tkir"));
    if (locale !== "ru") assert.doesNotMatch(page, /\p{Script=Cyrillic}/u);
    const customerPage = await renderNavigation(locale, "/settings/users", createElement(PageNav, { organizationName: "ACME O‘tkir" }), true);
    assert.ok(customerPage.includes("Своя команда"));
    const journal = createElement(JournalPageCrumbs, {
      organizationName: "ACME O‘tkir", journalCode: "cleaning", journalName: "Журнал уборки",
      tail: [{ label: "Исходный документ O‘tkir", href: "/journals/cleaning/documents/raw-id" }],
    });
    const normal = await renderNavigation(locale, "/journals/cleaning", journal);
    assert.ok(normal.includes(locale === "ru" ? "Журнал уборки" : messages.journals.names.cleaning));
    assert.ok(normal.includes("Исходный документ O‘tkir"));
    const customJournal = await renderNavigation(locale, "/journals/cleaning", journal, true);
    assert.ok(customJournal.includes("Свой журнал O‘tkir"));
    assert.ok(customJournal.includes("Исходный документ O‘tkir"));
    await renderNavigation(locale, "/journals", createElement(JournalPageCrumbs, { organizationName: "ACME" }));
  }
});

test("Mini shell uses localized route ancestry, dynamic title and its own captions with exact legacy defaults", async () => {
  assert.equal(titleForPath("/mini/me"), "Профиль");
  assert.equal(titleForSitePath("/unknown"), "Кабинет");
  assert.equal(titleForPath("/mini/unknown"), "WeSetup");
  for (const locale of ["ru", "en", "uz"] as const) {
    const messages = await loadMessages(locale);
    const onError = (error: Error) => { throw error; };
    const routes = createTranslator({ locale, messages, namespace: "navigation.routes", onError });
    const mini = createTranslator({ locale, messages, namespace: "navigation.mini", onError });
    assert.equal(titleForPath("/mini/login", routes, mini), mini("login"));
    assert.equal(titleForPath("/mini/o/task-id", routes, mini), mini("task"));
    assert.equal(titleForPath("/mini/outbox", routes, mini), mini("outbox"));
    assert.equal(titleForPath("/mini/sections", routes, mini), mini("sections"));
    assert.equal(titleForPath("/journals/cleaning/documents/raw-id", routes, mini), routes("journals"));
    assert.equal(titleForPath("/settings/journals/cleaning/scope", routes, mini), routes("journal_scope"));
    const html = await renderNavigation(locale, "/settings/journals/cleaning/scope", createElement(MiniTopBar, { homeHref: "/journals" }));
    assert.ok(html.includes(routes("journal_scope")));
    assert.ok(html.includes(mini("home")));
    assert.ok(html.includes('href="/journals"'));
    if (locale !== "ru") assert.doesNotMatch(html, /\p{Script=Cyrillic}/u);
    const customHtml = await renderNavigation(locale, "/settings/users", createElement(MiniTopBar, { homeHref: "/journals" }), true);
    assert.ok(customHtml.includes("Своя команда"));
  }
});
