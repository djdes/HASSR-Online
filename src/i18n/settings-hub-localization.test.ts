/* eslint-disable react/no-children-prop -- Explicit SSR provider children. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "node:test";
import { PageGuide } from "@/components/ui/page-guide";
import { validateCatalog } from "@/i18n/catalog-validation";
import { NextIntlClientProvider } from "next-intl";
import { loadMessages } from "@/i18n/messages";

const catalogPath = "src/i18n/messages/";
const catalogs = Object.fromEntries(
  (["ru", "en", "uz"] as const).map((locale) => [
    locale,
    JSON.parse(readFileSync(`${catalogPath}${locale}.json`, "utf8"))
      .settingsManagement.home,
  ]),
) as Record<"ru" | "en" | "uz", SettingsHomeMessages>;

type SettingsHomeMessages = {
  title: string;
  quickStart: string;
  quickStartDescription: string;
  open: string;
  stats: Record<string, string>;
  guide: {
    title: string;
    startTitle: string;
    startBody: string;
    teamTitle: string;
    teamBody: string;
    journalsTitle: string;
    journalsBody: string;
    integrationsTitle: string;
    integrationsBody: string;
    qaMistakeQuestion: string;
    qaMistakeAnswer: string;
    qaTasksQuestion: string;
    qaTasksAnswer: string;
  };
  groups: Record<string, { title: string; subtitle: string }>;
  cards: Record<string, { title: string; description: string }>;
};

test("settings hub catalog keys resolve and PageGuide renders in each locale", async () => {
  for (const locale of ["en", "uz"] as const) {
    assert.deepEqual(
      validateCatalog(catalogs.ru, catalogs[locale]),
      [],
      `${locale} catalog parity`,
    );
  }

  const page = readFileSync("src/app/(dashboard)/settings/page.tsx", "utf8");
  const ids = [...page.matchAll(/messageId: "([^"]+)"/g)].map((match) => match[1]);
  assert.equal(ids.length, 51);

  for (const locale of ["ru", "en", "uz"] as const) {
    const messages = catalogs[locale];
    assert.ok(messages.title.length > 0);
    assert.ok(messages.quickStartDescription.length > 0);
    assert.equal(Object.keys(messages.cards).length, 51);
    for (const id of ids) {
      assert.ok(messages.cards[id]?.title, `${locale} missing title for ${id}`);
      assert.ok(messages.cards[id]?.description, `${locale} missing description for ${id}`);
    }

    const guide = messages.guide;
    const runtimeMessages = await loadMessages(locale);
    const html = renderToStaticMarkup(
      createElement(NextIntlClientProvider, {
        locale, timeZone: "Europe/Moscow", messages: { common: runtimeMessages.common },
        onError: error => { throw error; }, children:
      createElement(PageGuide, {
        storageKey: "settings-hub-test",
        title: guide.title,
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
      }),
    );
    assert.ok(html.includes(guide.title), `${locale} guide title missing from SSR`);
  }
});
