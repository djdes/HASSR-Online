/* eslint-disable react/no-children-prop -- Explicit providers are needed for isolated client SSR. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { NextIntlClientProvider } from "next-intl";
import { test } from "node:test";

import { JournalAccessMatrix } from "@/components/settings/journal-access-matrix";
import { JournalsByPositionMatrix } from "@/components/settings/journals-by-position-matrix";
import { loadMessages } from "@/i18n/messages";
import { validateCatalog } from "@/i18n/catalog-validation";

const router = { back() {}, forward() {}, refresh() {}, hmrRefresh() {}, push() {}, replace() {}, prefetch() {} };
const ru = JSON.parse(readFileSync("src/i18n/messages/ru.json", "utf8"));

test("access matrix messages match and both matrix UIs render in RU, EN, and Uzbek", async () => {
  for (const locale of ["en", "uz"] as const) {
    const other = JSON.parse(readFileSync(`src/i18n/messages/${locale}.json`, "utf8"));
    assert.deepEqual(
      validateCatalog(ru.settingsManagement.accessMatrices, other.settingsManagement.accessMatrices),
      [],
      `${locale} matrix messages have ICU parity`,
    );
  }

  for (const locale of ["ru", "en", "uz"] as const) {
    const messages = await loadMessages(locale);
    const access = messages.settingsManagement.accessMatrices;
    const employeeHtml = renderToStaticMarkup(createElement(AppRouterContext.Provider, {
      value: router,
      children: createElement(NextIntlClientProvider, {
        locale, messages, timeZone: "Europe/Moscow", onError: (error) => { throw error; },
        children: createElement(JournalAccessMatrix, {
          users: [{ id: "employee-id", name: "Custom Person", role: "cook", positionName: null, positionCategory: "staff", journalAccessMigrated: false, initialAccess: [{ templateCode: "hygiene", canRead: true, canWrite: true, canFinalize: false }] }],
          catalog: [{ code: "hygiene", name: ru.journals.names.hygiene }],
        }),
      }),
    }));
    const positionHtml = renderToStaticMarkup(createElement(AppRouterContext.Provider, {
      value: router,
      children: createElement(NextIntlClientProvider, {
        locale, messages, timeZone: "Europe/Moscow", onError: (error) => { throw error; },
        children: createElement(JournalsByPositionMatrix, {
          positions: [{ id: "position-id", name: "Custom Duty", categoryKey: "management", activeUsers: 2, initialCodes: [] }],
          catalog: [{ code: "hygiene", name: ru.journals.names.hygiene }],
        }),
      }),
    }));

    assert.ok(employeeHtml.includes(access.table.employee));
    assert.ok(employeeHtml.includes(access.table.legacyUserAccess));
    assert.ok(employeeHtml.includes("Custom Person"));
    assert.ok(employeeHtml.includes(messages.journals.names.hygiene), employeeHtml);
    assert.ok(positionHtml.includes(access.table.position));
    assert.ok(positionHtml.includes(access.table.activeUsers.split("{")[0].trim()));
    assert.ok(positionHtml.includes(access.table.legacyPositionAccess));
    assert.ok(positionHtml.includes("Custom Duty"));
    assert.ok(positionHtml.includes(messages.journals.names.hygiene));
    if (locale !== "ru") {
      assert.ok(!employeeHtml.includes(ru.journals.names.hygiene));
      assert.ok(!positionHtml.includes(ru.journals.names.hygiene));
    }
  }
});
