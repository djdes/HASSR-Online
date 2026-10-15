import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readSeedArticles } from "../../scripts/lib/read-seed-articles";
import { bundledArticleTranslation } from "../content/article-translations/catalog";
import { ArticleRenderer } from "../components/public/article-renderer";
import { isArticleBlockArray } from "./article-blocks";
import { isCurrentArticleTranslation, localizeArticle } from "./article-localization";
import { articleLanguageAlternates } from "./article-language-alternates";

test("every seeded article has current complete EN/UZ content and renders its original block structure", async () => {
  const sources = await readSeedArticles();
  assert.ok(sources.length > 0);
  for (const source of sources) {
    for (const locale of ["en", "uz"] as const) {
      const translation = bundledArticleTranslation(source.slug, locale);
      assert.ok(translation, `${source.slug}/${locale}: missing translation`);
      assert.equal(isCurrentArticleTranslation(source, translation, locale), true, `${source.slug}/${locale}: stale or malformed translation`);
      const result = localizeArticle(source, [translation], locale);
      assert.equal(result.translationMissing, false);
      assert.ok(isArticleBlockArray(result.body));
      const html = renderToStaticMarkup(createElement(ArticleRenderer, { blocks: result.body }));
      assert.ok(html.length > 100);
      assert.doesNotMatch(html, /\uFFFD|\?\?\?/);
    }
    const alternates = articleLanguageAlternates(source, []);
    assert.equal(alternates.en, `https://wesetup.ru/en/blog/${source.slug}`);
    assert.equal(alternates.uz, `https://wesetup.ru/uz/blog/${source.slug}`);
    const stale = articleLanguageAlternates({ ...source, title: `${source.title} (edited)` }, []);
    assert.deepEqual(Object.keys(stale).sort(), ["ru", "x-default"]);
  }
  assert.equal(bundledArticleTranslation("__proto__", "en"), undefined);
});
