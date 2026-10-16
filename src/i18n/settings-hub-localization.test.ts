import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
