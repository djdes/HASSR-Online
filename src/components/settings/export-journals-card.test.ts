/* eslint-disable react/no-children-prop -- Typed provider props in SSR fixture. */
import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { loadMessages } from "@/i18n/messages";
import { ExportJournalsCard } from "./export-journals-card";

test("actual archive card renders scoped RU/EN/UZ copy and defaults export language to the interface", async () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    const messages = await loadMessages(locale);
    const html = renderToStaticMarkup(createElement(NextIntlClientProvider, {
      locale, timeZone: "UTC", messages: { archiveExport: messages.archiveExport }, onError: error => { throw error; }, children: createElement(ExportJournalsCard),
    }));
    assert.ok(html.includes(messages.archiveExport.card.title));
    assert.ok(html.includes(messages.archiveExport.card.language));
    assert.match(html, new RegExp(`<option[^>]*value="${locale}"[^>]*selected=""`));
    assert.match(html, /data-testid="export-from"/); assert.match(html, /data-testid="export-to"/);
    assert.match(html, /type="button"/); assert.ok(html.includes("200"));
  }
});
