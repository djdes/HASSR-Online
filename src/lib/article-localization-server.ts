import "server-only";
import { db } from "./db";
import { localizeArticle, type ArticleSource } from "./article-localization";
import type { Locale } from "@/i18n/locales";
import { bundledArticleTranslation } from "@/content/article-translations/catalog";

/** One request-scoped lookup for a list; no global locale cache or N+1 queries. */
export async function localizeArticles<T extends ArticleSource & { id: string; slug: string }>(articles: T[], locale: Locale) {
  const translations = locale === "ru" || articles.length === 0 ? [] : await db.articleTranslation.findMany({
    where: { articleId: { in: articles.map((article) => article.id) }, locale },
  });
  const byArticle = new Map(translations.map((translation) => [translation.articleId, translation]));
  return articles.map((article) => {
    const translation = byArticle.get(article.id);
    const bundled = bundledArticleTranslation(article.slug, locale);
    return localizeArticle(article, [...(translation ? [translation] : []), ...(bundled ? [bundled] : [])], locale);
  });
}
