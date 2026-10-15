/* eslint-disable react/no-children-prop -- NextIntlClientProvider's React 19 typings require children in props for createElement. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { test } from "node:test";

import { JournalColumnTemplatesBar } from "@/components/journals/journal-column-templates-bar";
import { validateCatalog } from "@/i18n/catalog-validation";

const catalogs = Object.fromEntries(
  (["ru", "en", "uz"] as const).map((locale) => [
    locale,
    JSON.parse(readFileSync(`src/i18n/messages/${locale}.json`, "utf8")),
  ]),
);

test("column template bar renders translated chrome in all locales", () => {
  const ru = catalogs.ru.journalControls.columnTemplates;
  for (const locale of ["en", "uz"] as const) {
    assert.deepEqual(
      validateCatalog(ru, catalogs[locale].journalControls.columnTemplates),
      [],
      `${locale} column template catalog parity`,
    );
  }

  for (const locale of ["ru", "en", "uz"] as const) {
    const copy = catalogs[locale].journalControls.columnTemplates;
    const html = renderToStaticMarkup(
      createElement(
        NextIntlClientProvider,
        {
          locale,
          messages: catalogs[locale],
          timeZone: "Europe/Moscow",
          onError: (error) => { throw error; },
          children: createElement(JournalColumnTemplatesBar, {
            code: "finished_product",
            config: {},
            current: { hidden: [], labels: {}, order: [] },
            onApply: () => undefined,
            canManage: true,
          }),
        },
      ),
    );
    assert.ok(html.includes(copy.title), `${locale} section title missing`);
    assert.ok(html.includes(copy.chooseAria), `${locale} accessible name missing`);
    assert.ok(html.includes(copy.hint), `${locale} help text missing`);
    assert.ok(html.includes(copy.downloadSample), `${locale} sample download action missing`);
  }
});
