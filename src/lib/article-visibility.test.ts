import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  articleLastModified,
  isArticlePublished,
  newestArticleDate,
  publishedArticleWhere,
} from "@/lib/article-visibility";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const at = (iso: string) => new Date(iso);

describe("видимость статей и даты в sitemap", () => {
  const now = at("2026-10-31T12:00:00Z");

  it("статья видна с момента публикации; черновик и отложенная — нет", () => {
    assert.equal(isArticlePublished(at("2026-10-01T00:00:00Z"), now), true);
    assert.equal(isArticlePublished(now, now), true);
    assert.equal(isArticlePublished(at("2026-11-01T00:00:00Z"), now), false);
    assert.equal(isArticlePublished(null, now), false);
    assert.deepEqual(publishedArticleWhere(now), { publishedAt: { not: null, lte: now } });
  });

  it("дата статьи — правка, иначе публикация; у /blog — самая свежая статья", () => {
    const edited = { updatedAt: at("2026-10-20T00:00:00Z"), publishedAt: at("2026-10-01T00:00:00Z") };
    const fresh = { updatedAt: null, publishedAt: at("2026-10-25T00:00:00Z") };
    assert.equal(articleLastModified(edited)?.toISOString(), "2026-10-20T00:00:00.000Z");
    assert.equal(articleLastModified(fresh)?.toISOString(), "2026-10-25T00:00:00.000Z");
    assert.equal(articleLastModified({}), undefined);
    assert.equal(newestArticleDate([edited, fresh])?.toISOString(), "2026-10-25T00:00:00.000Z");
    assert.equal(newestArticleDate([]), undefined);
  });

  it("sitemap не выдумывает дату: ни времени старта процесса, ни `lastModified: now`", () => {
    const sitemap = read("src/app/sitemap.ts");
    assert.doesNotMatch(sitemap, /lastModified: now/);
    assert.doesNotMatch(sitemap, /const now = new Date\(\)/);
    assert.match(sitemap, /where: publishedArticleWhere\(new Date\(\)\)/);
    assert.match(sitemap, /\$\{SITE\}\/blog`, \.\.\.lastModifiedOf\(newestArticleDate\(articles\)\)/);
    assert.match(sitemap, /\.\.\.lastModifiedOf\(articleLastModified\(a\)\)/);
  });

  it("список блога, похожие статьи и страница статьи не показывают отложенные; ROOT открывает их без индексации", () => {
    assert.match(read("src/app/blog/page.tsx"), /where: publishedArticleWhere\(new Date\(\)\)/);
    const article = read("src/app/blog/[slug]/page.tsx");
    assert.match(article, /\.\.\.publishedArticleWhere\(new Date\(\)\),\s*slug: \{ not: slug \}/);
    assert.match(article, /if \(!source \|\| !\(await canViewArticle\(source\.publishedAt\)\)\) notFound\(\);/);
    assert.match(article, /return session\?\.user\?\.isRoot === true;/);
    assert.match(article, /article\.translationMissing \|\| scheduled \? \{ robots: \{ index: false, follow: true \} \}/);
  });

  it("вход закрыт от индексации, ссылки с него проходятся", () => {
    assert.match(read("src/app/(auth)/login/page.tsx"), /robots: \{ index: false, follow: true \}/);
  });
});
