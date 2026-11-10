/* eslint-disable react/no-children-prop -- Explicit provider children for SSR tests. */
import assert from "node:assert/strict";
import test from "node:test";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { loadMessages } from "@/i18n/messages";
import type { Locale } from "@/i18n/locales";
import { OrganizationBrand } from "./organization-brand";

const router = { back() {}, forward() {}, refresh() {}, hmrRefresh() {}, push() {}, replace() {}, prefetch() {} };

async function render(locale: Locale, props: Partial<ComponentProps<typeof OrganizationBrand>>) {
  const messages = await loadMessages(locale);
  return renderToStaticMarkup(
    createElement(AppRouterContext.Provider, {
      value: router,
      children: createElement(NextIntlClientProvider, {
        locale,
        messages: { navigation: messages.navigation },
        timeZone: "Europe/Moscow",
        onError: (error) => {
          throw error;
        },
        children: createElement(OrganizationBrand, {
          logoUrl: null,
          name: "Kafe Romashka",
          identity: { name: "OOO Romashka", inn: "7701234567" },
          homeHref: "/home",
          ...props,
        }),
      }),
    }),
  );
}

test("шапка меню без логотипа: заглушка и у руководителя компактная кнопка загрузки", async () => {
  const html = await render("ru", { canEditBranding: true });
  assert.match(html, /data-logo-placeholder/);
  assert.match(html, />КР<|>KR</);
  assert.match(html, /data-logo-upload/);
  assert.match(html, /Загрузить логотип/);
  assert.match(html, /type="file"/);
  assert.match(html, /data-org-short-name[^>]*>OOO Romashka</);
  assert.match(html, /data-org-inn[^>]*>ИНН 7701234567</);
  assert.match(html, /href="\/home"/);
});

test("логотип загружен — кнопки замены нет, заглушки нет", async () => {
  const html = await render("ru", { canEditBranding: true, logoUrl: "/api/org-assets/org-1/logo?v=2" });
  assert.match(html, /<img[^>]+src="\/api\/org-assets\/org-1\/logo\?v=2"/);
  assert.doesNotMatch(html, /data-logo-upload/);
  assert.doesNotMatch(html, /data-logo-placeholder/);
  assert.doesNotMatch(html, /type="file"/);
  assert.match(html, /ИНН 7701234567/);
});

test("без права на оформление — заглушка без кнопки; без ИНН — строки ИНН нет", async () => {
  const html = await render("ru", { canEditBranding: false, identity: { name: "OOO Romashka", inn: null } });
  assert.match(html, /data-logo-placeholder/);
  assert.doesNotMatch(html, /data-logo-upload/);
  assert.doesNotMatch(html, /data-org-inn/);
  assert.match(html, /OOO Romashka/);
});

test("подписи шапки меню на en и uz без кириллицы", async () => {
  for (const locale of ["en", "uz"] as const) {
    const messages = await loadMessages(locale);
    const html = await render(locale, { canEditBranding: true });
    assert.ok(html.includes(messages.navigation.shell.uploadLogo));
    assert.ok(html.includes(messages.navigation.shell.inn.replace("{inn}", "7701234567")));
    assert.doesNotMatch(html, /\p{Script=Cyrillic}/u);
  }
});
