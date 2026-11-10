/* eslint-disable react/no-children-prop -- React providers are passed through createElement in SSR tests. */
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";
import { NextIntlClientProvider } from "next-intl";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";

import { CleaningDocumentsClient } from "@/components/journals/cleaning-documents-client";
import { CleaningDocumentClient } from "@/components/journals/cleaning-document-client";
import { JournalHeaderEditProvider } from "@/components/journals/journal-header-edit";
import {
  CLEANING_DOCUMENT_TEMPLATE_CODE,
  defaultCleaningDocumentConfig,
  getCleaningDocumentTitle,
} from "@/lib/cleaning-document";
import { buildDocumentAutoTitle } from "@/lib/journal-document-title";
import { loadMessages } from "@/i18n/messages";

const router = {
  back() {}, forward() {}, refresh() {}, hmrRefresh() {}, push() {}, replace() {}, prefetch() {},
};

test("cleaning journal empty list renders localized empty state for RU, EN, and Uzbek", async () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    const messages = await loadMessages(locale);
    const errors: string[] = [];
    const html = renderToStaticMarkup(createElement(AppRouterContext.Provider, {
      value: router,
      children: createElement(NextIntlClientProvider, {
        locale,
        messages,
        timeZone: "Europe/Moscow",
        onError: (error) => errors.push(error.message),
        children: createElement(CleaningDocumentsClient, {
          routeCode: "cleaning",
          templateCode: CLEANING_DOCUMENT_TEMPLATE_CODE,
          activeTab: "active",
          users: [],
          documents: [],
        }),
      }),
    }));
    assert.deepEqual(errors, [], locale);
    assert.ok(html.length > 0, `${locale}: expected rendered list output`);
    if (locale === "en") assert.match(html, /No cleaning journals yet|No documents yet|Create/i);
    if (locale === "uz") assert.match(html, /Hali|jurnal|hujjat|Yarat/i);
  }
});

test("cleaning journal list preserves a custom saved title for every locale", async () => {
  const customerTitle = "Kitchen O‘tkir — custom title";
  for (const locale of ["ru", "en", "uz"] as const) {
    const messages = await loadMessages(locale);
    const errors: string[] = [];
    const config = defaultCleaningDocumentConfig();
    const html = renderToStaticMarkup(createElement(AppRouterContext.Provider, {
      value: router,
      children: createElement(NextIntlClientProvider, {
        locale, messages, timeZone: "Europe/Moscow",
        onError: (error) => errors.push(error.message),
        children: createElement(CleaningDocumentsClient, {
          routeCode: "cleaning",
          templateCode: CLEANING_DOCUMENT_TEMPLATE_CODE,
          activeTab: "active",
          users: [],
          documents: [{
            id: "doc-1", title: customerTitle, status: "active",
            dateFrom: "2026-10-01", dateTo: "2026-10-15", config,
          }],
        }),
      }),
    }));
    assert.deepEqual(errors, [], locale);
    assert.ok(html.includes(customerTitle), `${locale}: list card must preserve its custom title`);
  }
});

test("closed cleaning document detail renders localized labels and keeps the customer title", async () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    const messages = await loadMessages(locale);
    const errors: string[] = [];
    const customerTitle = "Kitchen O‘tkir — custom";
    const html = renderToStaticMarkup(createElement(SearchParamsContext.Provider, {
      value: new URLSearchParams(),
      children: createElement(AppRouterContext.Provider, {
        value: router,
        children: createElement(NextIntlClientProvider, {
          locale,
          messages,
          timeZone: "Europe/Moscow",
          onError: (error) => errors.push(error.message),
          children: createElement(JournalHeaderEditProvider, {
            value: {
              documentId: "cleaning-test",
              templateCode: "cleaning",
              titlePresentation: { sourceNames: [getCleaningDocumentTitle()], dateFrom: "2026-10-01", dateTo: "2026-10-15" },
              canEditDocument: false,
              canEditOrganization: false,
              organizationJournalName: "O‘tkir Kitchen",
              organizationDefaultName: "O‘tkir Kitchen",
              documentOrgName: null,
              headerTitle: null,
              controlPeriodicity: "Каждый час",
            },
            children: createElement(CleaningDocumentClient, {
          documentId: "cleaning-test",
          title: customerTitle,
          organizationName: "O‘tkir Kitchen",
          status: "closed",
          dateFrom: "2026-10-01",
          dateTo: "2026-10-15",
          responsibleTitle: null,
          responsibleUserId: null,
          autoFill: false,
          users: [],
          config: {
            ...defaultCleaningDocumentConfig(),
            title: customerTitle,
            documentTitle: customerTitle,
          },
          initialEntries: [],
          useV2: false,
            }),
          }),
        }),
      }),
    }));
    assert.deepEqual(errors, [], locale);
    assert.ok(html.includes(customerTitle), `${locale}: custom title must be preserved`);
    assert.ok(html.includes("Kitchen O‘tkir"), `${locale}: customer organization name must be preserved`);
    assert.ok(html.length > 0, `${locale}: expected rendered document detail`);
    if (locale === "en") assert.match(html, /reopen|closed|Completed/i);
    if (locale === "uz") assert.match(html, /qayta och|yopilgan|Bajarildi/i);
  }
});

test("cleaning detail translates an exact generated title without changing its saved value", async () => {
  const sourceName = getCleaningDocumentTitle();
  const dateFrom = "2026-10-01";
  const dateTo = "2026-10-15";
  const generatedTitle = buildDocumentAutoTitle({
    templateCode: CLEANING_DOCUMENT_TEMPLATE_CODE,
    journalName: sourceName,
    dateFrom,
    dateTo,
  });
  for (const locale of ["en", "uz"] as const) {
    const messages = await loadMessages(locale);
    const html = renderToStaticMarkup(createElement(AppRouterContext.Provider, {
      value: router,
      children: createElement(SearchParamsContext.Provider, {
        value: new URLSearchParams(),
        children: createElement(NextIntlClientProvider, {
          locale, messages, timeZone: "Europe/Moscow", onError: (error) => { throw error; },
          children: createElement(JournalHeaderEditProvider, {
            value: {
              documentId: "cleaning-generated",
              templateCode: "cleaning",
              titlePresentation: { sourceNames: [sourceName], dateFrom, dateTo },
              canEditDocument: false,
              canEditOrganization: false,
              organizationJournalName: "O‘tkir Kitchen",
              organizationDefaultName: "O‘tkir Kitchen",
              documentOrgName: null,
              headerTitle: null,
              controlPeriodicity: "Каждый час",
            },
            children: createElement(CleaningDocumentClient, {
              documentId: "cleaning-generated",
              title: generatedTitle,
              organizationName: "O‘tkir Kitchen",
              status: "closed",
              dateFrom,
              dateTo,
              responsibleTitle: null,
              responsibleUserId: null,
              autoFill: false,
              users: [],
              config: { ...defaultCleaningDocumentConfig(), title: generatedTitle, documentTitle: generatedTitle },
              initialEntries: [],
              useV2: false,
            }),
          }),
        }),
      }),
    }));
    assert.ok(html.includes(messages.journals.names.cleaning), `${locale}: translated journal name expected`);
    assert.ok(!html.includes(generatedTitle), `${locale}: generated Russian title should not be displayed`);
  }
});
