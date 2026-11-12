import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";

import { useRegistrationChallenge } from "@/components/auth/registration-challenge";
import { loadMessages } from "@/i18n/messages";

function Probe() {
  return useRegistrationChallenge().element;
}

test("the bot check is invisible: only a hidden honeypot, no «I'm not a robot» widget or reserved box", async () => {
  const messages = await loadMessages("ru");
  const html = renderToStaticMarkup(
    // Типы провайдера требуют children в props (как в public-ui-localization.test.ts).
    // eslint-disable-next-line react/no-children-prop
    createElement(NextIntlClientProvider, {
      locale: "ru",
      messages,
      timeZone: "Europe/Moscow",
      children: createElement(Probe),
    }),
  );
  assert.match(html, /^<div aria-hidden="true" class="hidden">/);
  assert.match(html, /tabindex="-1" name="website"/);
  assert.doesNotMatch(html, /recaptcha|min-h-\[144px\]|role="status"/i);
});
