/* eslint-disable react/no-children-prop -- In this .test.ts file, provider props require children for typed createElement calls. */
import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { loadMessages } from "@/i18n/messages";
import type { ApiKeyView } from "@/lib/public-api/key-admin";
import { AiConnectClient } from "./ai-connect-client";

const KEY: ApiKeyView = {
  id: "k1",
  name: "ChatGPT управляющей",
  access: "write",
  displayPrefix: "wsk_abcdefgh",
  createdAt: "2026-10-16T09:00:00.000Z",
  lastUsedAt: null,
  lastUsedVia: null,
  owner: { id: "u1", name: "Ольга" },
  isMine: true,
};

async function render(manageBlockedReason: string | null) {
  const messages = await loadMessages("ru");
  return renderToStaticMarkup(
    createElement(NextIntlClientProvider, {
      locale: "ru",
      timeZone: "Europe/Moscow",
      messages,
      children: createElement(AiConnectClient, {
        baseUrl: "https://wesetup.ru",
        initialKeys: [KEY],
        tools: [{ name: "list_journals", access: "read" }],
        manageBlockedReason,
      }),
    })
  );
}

test("руководитель видит кнопку «Создать ключ» и «Отозвать»", async () => {
  const html = await render(null);
  assert.ok(html.includes("Создать ключ"));
  assert.ok(html.includes("Отозвать"));
});

test("ROOT «войти как» или партнёр: вместо формы — причина, без «Создать ключ» и «Отозвать»", async () => {
  const html = await render("Ключ выпускает сам руководитель организации");
  assert.ok(html.includes("Ключ выпускает сам руководитель организации"));
  assert.equal(html.includes("Создать ключ"), false);
  assert.equal(html.includes(">Отозвать<"), false);
  assert.ok(html.includes("ChatGPT управляющей"), "список ключей остаётся виден");
});
