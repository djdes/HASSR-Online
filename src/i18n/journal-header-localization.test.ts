/* eslint-disable react/no-children-prop -- Typed React providers require the children prop. */
import assert from "node:assert/strict";
import test from "node:test";
import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { HeaderOrgName, HeaderTitle, HeaderPeriodicity, JournalHeaderEditProvider, useDocumentDisplayTitle } from "@/components/journals/journal-header-edit";
import { DocumentActionsBar } from "@/components/journals/document-actions-bar";
import { DEFAULT_CONTROL_PERIODICITY } from "@/lib/control-periodicity";
import { humanizeFetchError } from "@/lib/humanize-fetch-error";
import { loadMessages } from "./messages";

test("editable journal headers localize accessible actions and preserve customer text for every role", async () => {
  const router = { back() {}, forward() {}, refresh() {}, hmrRefresh() {}, push() {}, replace() {}, prefetch() {} };
  for (const locale of ["ru", "en", "uz"] as const) {
    const messages = await loadMessages(locale);
    for (const canEdit of [true, false]) {
      const failures: string[] = [];
      const html = renderToStaticMarkup(createElement(AppRouterContext.Provider, {
        value: router,
        children: createElement(NextIntlClientProvider, {
          locale, messages, timeZone: "Europe/Moscow", onError: error => failures.push(error.message),
          children: createElement(JournalHeaderEditProvider, {
            value: {
              documentId: "example", canEditDocument: canEdit, canEditOrganization: canEdit,
              organizationJournalName: "Кухня O‘tkir", organizationDefaultName: "Кухня O‘tkir",
              documentOrgName: null, headerTitle: "Мой журнал <2026>", controlPeriodicity: "Каждый час",
            },
            children: createElement(Fragment, null,
              createElement(HeaderOrgName, { orgName: "Кухня O‘tkir" }),
              createElement(HeaderTitle, { title: "Standard title" }),
              createElement(HeaderPeriodicity, { text: "Каждый час" }),
            ),
          }),
        }),
      }));
      assert.deepEqual(failures, [], locale);
      assert.ok(html.includes("Кухня O‘tkir"));
      assert.ok(html.includes("Мой журнал &lt;2026&gt;"));
      assert.ok(html.includes("Каждый час"));
      assert.equal(html.includes("<button"), canEdit);
      if (canEdit) {
        for (const label of ["editOrganization", "editTitle", "editPeriodicity"] as const) {
          assert.ok(html.includes(`aria-label="${messages.journalWidgets.headerEdit[label]}"`), `${locale}: ${label}`);
        }
      }
      assert.equal(humanizeFetchError(new TypeError("Failed to fetch"), "fallback", messages.journalWidgets.headerEdit.networkError), messages.journalWidgets.headerEdit.networkError);
      assert.equal(humanizeFetchError(new Error("Custom server message"), "fallback", messages.journalWidgets.headerEdit.networkError), "Custom server message");
    }
  }
});

test("real document header shows translated default title/periodicity and exports with the selected personal locale", async () => {
  function Title() { return createElement("h1", null, useDocumentDisplayTitle("Журнал уборки — октябрь 2026")); }
  const router = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} };
  for (const locale of ["ru", "en", "uz"] as const) {
    const messages = await loadMessages(locale);
    const html = renderToStaticMarkup(createElement(AppRouterContext.Provider, {
      value: router,
      children: createElement(NextIntlClientProvider, {
        locale, messages, timeZone: "Europe/Moscow", onError: error => { throw error; },
        children: createElement(JournalHeaderEditProvider, {
          value: {
            documentId: "example", templateCode: "cleaning", canEditDocument: true, canEditOrganization: false,
            organizationJournalName: "O‘tkir", organizationDefaultName: "O‘tkir", documentOrgName: null, headerTitle: null,
            controlPeriodicity: DEFAULT_CONTROL_PERIODICITY.cleaning,
            titlePresentation: { sourceNames: ["Журнал уборки"], dateFrom: "2026-10-01", dateTo: "2026-10-31" },
          },
          children: createElement(Fragment, null,
            createElement(Title),
            createElement(HeaderPeriodicity, { text: DEFAULT_CONTROL_PERIODICITY.cleaning }),
            createElement(DocumentActionsBar, { documentId: "example", showPrint: true }),
          ),
        }),
      }),
    }));
    assert.ok(html.includes(messages.journalWidgets.periodicity.cleaning));
    assert.ok(html.includes(`/api/journal-documents/example/pdf?locale=${locale}`));
    assert.ok(html.includes(`aria-label="${messages.journalControls.actions.print}"`));
    if (locale !== "ru") {
      assert.ok(html.includes(messages.journals.names.cleaning));
      assert.doesNotMatch(html, /\p{Script=Cyrillic}/u);
    }
  }
});
