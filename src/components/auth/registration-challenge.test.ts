import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";

import { CHALLENGE_RESERVED_CLASS, useRegistrationChallenge } from "@/components/auth/registration-challenge";
import { loadMessages } from "@/i18n/messages";

function Probe({ tone }: { tone: "light" | "dark" }) {
  return useRegistrationChallenge(tone).element;
}

test("the challenge reserves the compact widget's 164×144 box before it loads — the first screen does not jump", async () => {
  const messages = await loadMessages("ru");
  for (const tone of ["light", "dark"] as const) {
    const html = renderToStaticMarkup(
      // Типы провайдера требуют children в props (как в public-ui-localization.test.ts).
      // eslint-disable-next-line react/no-children-prop
      createElement(NextIntlClientProvider, {
        locale: "ru",
        messages,
        timeZone: "Europe/Moscow",
        children: createElement(Probe, { tone }),
      }),
    );
    assert.equal(CHALLENGE_RESERVED_CLASS, "min-h-[144px]");
    // The reserved box wraps the widget container from the very first render.
    assert.match(html, /<div class="relative min-h-\[144px\]"><div><\/div><p role="status" class="absolute left-0 top-0 flex h-\[144px\] w-\[164px\]/);
    assert.match(html, /Загружаем проверку…/);
    assert.match(html, tone === "dark" ? /border-white\/25 text-white\/70/ : /border-\[#dcdfed\] text-\[#6f7282\]/);
  }
});
