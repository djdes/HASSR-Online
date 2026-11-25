import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { BASE_LOCALES, FALLBACK_LOCALE, LOCALES, OFFERED_LOCALES, baseLocale } from "./locales";
import { loadBaseMessages } from "./messages";

test("extra locale catalogs are rebuilt from translated/ sources", () => {
  execFileSync(process.execPath, ["--import", "tsx", "scripts/i18n-seed-locales.ts", "--check"], { stdio: "pipe" });
});

test("every locale is offered and falls back to a fully maintained catalog", () => {
  assert.deepEqual([...LOCALES], ["ru", "en", "uz", "tg", "hy", "ky", "de", "fr"]);
  for (const locale of LOCALES) {
    assert.ok(OFFERED_LOCALES.includes(locale));
    assert.ok((BASE_LOCALES as readonly string[]).includes(FALLBACK_LOCALE[locale]));
  }
  assert.equal(baseLocale("tg"), "ru");
  assert.equal(baseLocale("de"), "en");
});

test("extra locales have their own navigation and fall back for untranslated strings", async () => {
  const ru = await loadBaseMessages("ru");
  const en = await loadBaseMessages("en");
  for (const locale of ["tg", "hy", "ky", "de", "fr"] as const) {
    const messages = await loadBaseMessages(locale);
    assert.notEqual(messages.common.save, ru.common.save, `${locale} common.save translated`);
    assert.notEqual(messages.common.save, en.common.save, `${locale} common.save translated`);
    const fallback = FALLBACK_LOCALE[locale] === "ru" ? ru : en;
    assert.equal(messages.settingsUi === undefined, false);
    assert.equal(typeof messages.settingsUi, typeof fallback.settingsUi);
  }
});
