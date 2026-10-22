import test from "node:test";
import assert from "node:assert/strict";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import type { Messages } from "@/i18n/messages";
import ru from "@/i18n/messages/ru.json";
import en from "@/i18n/messages/en.json";
import uz from "@/i18n/messages/uz.json";
import { DEFAULT_USER_FILTERS } from "@/lib/mailing/audience";
import { UsersTab } from "./users-tab";
import { MailingFeedbackProvider } from "./mailing-feedback";

for (const locale of ["ru", "en", "uz"] as const) {
  test(`actual Users initial SSR uses only domain copy in ${locale} and runs no effects`, () => {
    const messages = { ru, en, uz }[locale].rootMailingShellAudience;
    let callbacks = 0;
    const props = {
      filters: { ...DEFAULT_USER_FILTERS, search: "RAW Рассылка <organization>" },
      selected: new Set(["raw-user"]),
      onFilters: () => { callbacks++; },
      onSelect: () => { callbacks++; },
      rememberLabels: () => { callbacks++; },
    };
    const feedbackProps: ComponentProps<typeof MailingFeedbackProvider> = {
      children: createElement(UsersTab, props),
    };
    const providerProps: ComponentProps<typeof NextIntlClientProvider> = {
      locale, timeZone: "Europe/Moscow", messages: { rootMailingShellAudience: messages as Messages["rootMailingShellAudience"] },
      children: createElement(MailingFeedbackProvider, feedbackProps),
    };
    const html = renderToStaticMarkup(createElement(NextIntlClientProvider, providerProps));
    assert.equal(callbacks, 0);
    assert.ok(html.includes(messages.users.loading));
    assert.ok(html.includes(messages.filters.searchPlaceholder));
    assert.ok(html.includes('value="RAW Рассылка &lt;organization&gt;"'));
    assert.ok(html.includes('data-testid="users-selected-count">1</span>'));
    assert.ok(html.includes(messages.filters.registeredFrom));
    assert.ok(html.includes('data-testid="users-filter-role"'));
    assert.ok(!html.includes("rootMailingShellAudience."));
    assert.ok(!html.includes('data-testid="users-row"'));
    assert.equal(props.selected.size, 1);
    assert.equal(props.filters.search, "RAW Рассылка <organization>");
  });
}
