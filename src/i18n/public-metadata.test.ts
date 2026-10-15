import assert from "node:assert/strict";
import test from "node:test";
import { publicMetadataFor } from "./public-metadata";
import { loadMessages } from "./messages";
import { NICHES } from "@/content/niches";
import { SEO_LANDINGS } from "@/content/seo-landings";
import { FEATURES_ORDER } from "@/content/features";
import { LOCALES } from "./locales";

test("public metadata and feed links are isolated by explicit locale", async () => {
  const results = await Promise.all([...LOCALES, "ru", "en"] .map(locale => publicMetadataFor(locale as typeof LOCALES[number])));
  for (const [index, locale] of LOCALES.entries()) {
    const metadata = results[index];
    const text = JSON.stringify(metadata);
    assert.ok(text.includes(`/og/landing/${locale}`));
    assert.ok(text.includes(`${locale === "ru" ? "" : `/${locale}`}/blog/feed.xml`));
    if (locale !== "ru") assert.doesNotMatch(text, /[А-Яа-яЁё]/);
    assert.deepEqual(metadata.robots, { index: true, follow: true });
  }
  assert.deepEqual(results[0], results[3]);
  assert.deepEqual(results[1], results[4]);
});

test("all public navigation source IDs have stable translations in every language", async () => {
  for (const locale of LOCALES) {
    const messages = (await loadMessages(locale)).publicNavigation;
    for (const [group, ids] of [
      ["niches", Object.keys(NICHES)], ["journals", Object.keys(SEO_LANDINGS)], ["features", FEATURES_ORDER],
    ] as const) {
      for (const id of ids) {
        const value = (messages[group] as Record<string, string>)[id];
        assert.ok(value?.trim(), `${locale}:${group}.${id}`);
        if (locale !== "ru") assert.doesNotMatch(value, /[А-Яа-яЁё]/);
      }
    }
  }
});
