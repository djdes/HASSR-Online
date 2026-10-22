/* eslint-disable react/no-children-prop -- Explicit SSR provider children, retained from C38. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { PageGuide } from "@/components/ui/page-guide";
import { loadMessages } from "@/i18n/messages";
import { test } from "node:test";
import { validateCatalog } from "@/i18n/catalog-validation";
import { SETTINGS_CARDS } from "@/lib/settings-cards";

const catalogPath = "src/i18n/messages/";
const catalogs = Object.fromEntries(
  (["ru", "en", "uz"] as const).map((locale) => [
    locale,
    JSON.parse(readFileSync(`${catalogPath}${locale}.json`, "utf8"))
      .settingsManagement.home,
  ]),
) as Record<"ru" | "en" | "uz", { cards: Record<string, { title: string; description: string }> }>;

// Хаба `/settings` больше нет (2026-10-16): карточки живут в разделах меню
// (`lib/settings-cards.ts`). Тексты карточек — те же ключи каталога.
test("settings cards catalog keys resolve in each locale", () => {
  for (const locale of ["en", "uz"] as const) {
    assert.deepEqual(
      validateCatalog(catalogs.ru, catalogs[locale]),
      [],
      `${locale} catalog parity`,
    );
  }

  assert.ok(SETTINGS_CARDS.length > 0);
  for (const locale of ["ru", "en", "uz"] as const) {
    const messages = catalogs[locale];
    for (const card of SETTINGS_CARDS) {
      assert.ok(messages.cards[card.id]?.title, `${locale} missing title for ${card.id}`);
      assert.ok(messages.cards[card.id]?.description, `${locale} missing description for ${card.id}`);
    }
  }
});

test("/settings — only a redirect into the sections", () => {
  const page = readFileSync("src/app/(dashboard)/settings/page.tsx", "utf8");
  assert.match(page, /redirect\("\/settings\/organization"\)/);
  assert.doesNotMatch(page, /messageId:/);
});


test("settings guide renders localized text independently of the retired hub route", async () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    const messages = await loadMessages(locale);
    const guide = messages.settingsManagement.home.guide;
    const html = renderToStaticMarkup(createElement(NextIntlClientProvider, {
      locale, timeZone: "Europe/Moscow", messages: { common: messages.common },
      onError: error => { throw error; }, children: createElement(PageGuide, {
        storageKey: "settings-hub-test", title: guide.title,
        bullets: [
          { title: guide.startTitle, body: guide.startBody },
          { title: guide.teamTitle, body: guide.teamBody },
          { title: guide.journalsTitle, body: guide.journalsBody },
          { title: guide.integrationsTitle, body: guide.integrationsBody },
        ],
        qa: [
          { q: guide.qaMistakeQuestion, a: guide.qaMistakeAnswer },
          { q: guide.qaTasksQuestion, a: guide.qaTasksAnswer },
        ],
      }),
    }));
    assert.ok(html.includes(guide.title), `${locale} guide title missing from SSR`);
  }
});
