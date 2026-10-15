/* eslint-disable react/no-children-prop -- Typed React providers require children. */
import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { MessageBubble } from "./sanpin-chat-widget";
import { loadMessages } from "@/i18n/messages";

test("assistant actions render all states in each locale, retain history and use status independent of display text", async () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    const messages = await loadMessages(locale);
    for (const state of ["pending", "cancelled", "success", "failed", "busy"] as const) {
      const html = renderToStaticMarkup(createElement(NextIntlClientProvider, {
        locale, messages: { common: messages.common }, timeZone: "Europe/Moscow", onError: error => { throw error; },
        children: createElement(MessageBubble, { confirmBusy: state === "busy", onConfirm() {}, onCancel() {}, message: {
          role: "assistant", content: "Original **history**: O‘tkir <entry>",
          pendingAction: { token: "token", kind: "add_staff", title: "O‘tkir", details: ["Cafe One"], expiresAt: 999999 },
          ...(state === "cancelled" ? { actionState: "cancelled" as const } : {}),
          ...(state === "success" || state === "failed" ? { actionState: "confirmed" as const, actionSucceeded: state === "success", actionResult: "Original result" } : {}),
        } }),
      }));
      assert.ok(html.includes("O‘tkir"));
      assert.ok(html.includes("Original"));
      assert.ok(html.includes(messages.common.assistant.confirmation));
      if (state === "failed") assert.ok(html.includes("bg-[#fff4f2]"));
      if (state === "success") assert.ok(html.includes("bg-[#ecfdf5]"));
      if (state === "cancelled") assert.ok(html.includes(messages.common.assistant.cancelled));
      if (state === "busy") assert.ok(html.includes('disabled=""'));
      if (locale !== "ru") assert.doesNotMatch(html, /\p{Script=Cyrillic}/u);
    }
  }
});
