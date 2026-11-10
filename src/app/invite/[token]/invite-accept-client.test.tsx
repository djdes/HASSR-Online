import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { loadMessages } from "@/i18n/messages";
import { InviteAcceptClient } from "./invite-accept-client";

const sampleUser = {
  name: "visdima0102@gmail.com",
  email: "visdima0102@gmail.com",
  organization: { name: "Моя организация", kind: "regular", poolObjects: 0 },
  masterCabinet: null,
};

const routerMock = {
  back() {},
  forward() {},
  push() {},
  replace() {},
  prefetch() {},
  refresh() {},
};

async function renderClient(props: React.ComponentProps<typeof InviteAcceptClient>) {
  const messages = await loadMessages("ru");
  return renderToStaticMarkup(
    <AppRouterContext.Provider value={routerMock}>
      <NextIntlClientProvider
        locale="ru"
        timeZone="UTC"
        messages={{ authInvite: messages.authInvite }}
      >
        <InviteAcceptClient {...props} />
      </NextIntlClientProvider>
    </AppRouterContext.Provider>,
  );
}

test("password reset mode shows reset copy without organization invitation or duplicate email", async () => {
  const html = await renderClient({
    status: "valid",
    token: "reset-token",
    invite: { userId: "u1", expiresAt: new Date(Date.now() + 60_000) },
    user: sampleUser,
    isReset: true,
  });

  assert.match(html, /Новый пароль/);
  assert.match(html, /Придумайте новый пароль для входа по адресу/);
  assert.match(html, /Сохранить пароль и войти/);
  assert.doesNotMatch(html, /Вас пригласили в/);
  assert.doesNotMatch(html, /Добро пожаловать/);
  assert.doesNotMatch(html, /Логин для входа:/);
});

test("organization invite mode shows invitation copy and skips duplicate login line when name equals email", async () => {
  const html = await renderClient({
    status: "valid",
    token: "invite-token",
    invite: { userId: "u1", expiresAt: new Date(Date.now() + 60_000) },
    user: sampleUser,
    isReset: false,
  });

  assert.match(html, /Добро пожаловать/);
  assert.match(html, /Вас пригласили в/);
  assert.match(html, /Установить пароль и войти/);
  assert.doesNotMatch(html, /Логин для входа:/);
});

test("organization invite mode shows login email when employee name differs from email", async () => {
  const html = await renderClient({
    status: "valid",
    token: "invite-token",
    invite: { userId: "u1", expiresAt: new Date(Date.now() + 60_000) },
    user: { ...sampleUser, name: "Дмитрий" },
    isReset: false,
  });

  assert.match(html, /Добро пожаловать, <strong[^>]*>Дмитрий<\/strong>!/);
  assert.match(html, /Логин для входа:/);
  assert.match(html, /visdima0102@gmail\.com/);
});

test("expired reset link shows password reset expiry message instead of invitation message", async () => {
  const html = await renderClient({
    status: "expired",
    token: "expired-token",
    invite: null,
    user: null,
    isReset: true,
  });

  assert.match(html, /Ссылка для сброса пароля устарела/);
  assert.doesNotMatch(html, /Приглашение устарело/);
});
