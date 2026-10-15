import assert from "node:assert/strict";
import { test } from "node:test";
import { articleSourceHash, isCurrentArticleTranslation, localizeArticle } from "./article-localization";

const source = {
  id: "original-id", slug: "original-slug", title: "Заголовок", excerpt: "Описание", tags: ["Журналы"],
  body: [{ type: "h2", text: "Раздел" }, { type: "ul", items: ["Первый", "Второй"] },
    { type: "quote", text: "Цитата", author: "Иван" }, { type: "callout", tone: "warn", text: "Важно" }],
};
const translated = {
  locale: "uz", sourceHash: articleSourceHash(source), title: "Sarlavha", excerpt: "Tavsif", tags: ["Jurnallar"],
  body: [{ type: "h2", text: "Boʻlim" }, { type: "ul", items: ["Birinchi", "Ikkinchi"] },
    { type: "quote", text: "Iqtibos", author: "Иван" }, { type: "callout", tone: "warn", text: "Muhim" }],
};

test("article translation preserves original IDs, tag filters, attribution and source data", () => {
  const before = structuredClone(source);
  const result = localizeArticle(source, [translated], "uz");
  assert.equal(result.title, "Sarlavha");
  assert.equal(result.id, source.id);
  assert.equal(result.slug, source.slug);
  assert.deepEqual(result.tags, source.tags);
  assert.deepEqual(result.displayTags, ["Jurnallar"]);
  assert.equal(result.contentLocale, "uz");
  assert.equal(result.translationMissing, false);
  assert.deepEqual(source, before);
});

test("article revisions are stable across JSONB object order but change with content", () => {
  assert.equal(articleSourceHash(source), articleSourceHash({ ...source, body: source.body.map(b => Object.fromEntries(Object.entries(b).reverse())) }));
  assert.notEqual(articleSourceHash(source), articleSourceHash({ ...source, title: "Изменено" }));
  assert.notEqual(articleSourceHash(source), articleSourceHash({ ...source, body: [...source.body].reverse() }));
});

test("stale, wrong-language and malformed translations never replace the original", () => {
  for (const invalid of [
    { ...translated, sourceHash: "stale" }, { ...translated, locale: "en" },
    { ...translated, title: " " }, { ...translated, tags: [] },
    { ...translated, body: translated.body.slice(1) },
    { ...translated, body: [{ type: "script", text: "x" }] },
    { ...translated, body: translated.body.map(b => b.type === "quote" ? { ...b, author: "Other" } : b) },
    { ...translated, body: translated.body.map(b => b.type === "callout" ? { ...b, tone: "tip" } : b) },
    { ...translated, body: translated.body.map(b => b.type === "ul" ? { ...b, items: ["One"] } : b) },
  ]) {
    assert.equal(isCurrentArticleTranslation(source, invalid, "uz"), false);
    const result = localizeArticle(source, [invalid], "uz");
    assert.equal(result.title, source.title);
    assert.equal(result.contentLocale, "ru");
    assert.equal(result.translationMissing, true);
  }
  assert.equal(localizeArticle(source, [translated], "ru").translationMissing, false);
});
