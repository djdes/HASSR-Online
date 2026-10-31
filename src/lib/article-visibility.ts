import type { Prisma } from "@prisma/client";

/**
 * Когда статья видна читателям и поисковикам. Отложенная публикация — это
 * `publishedAt` в будущем: до этой даты статьи нет ни в списке блога, ни на
 * своей странице, ни в sitemap (в RSS её и так не было). ROOT открывает её
 * по ссылке из админки — страница решает это сама.
 */
export function isArticlePublished(publishedAt: Date | null | undefined, now: Date): boolean {
  return publishedAt instanceof Date && publishedAt.getTime() <= now.getTime();
}

/** Условие выборки опубликованных к `now` статей. */
export function publishedArticleWhere(now: Date) {
  return { publishedAt: { not: null, lte: now } } satisfies Prisma.ArticleWhereInput;
}

/** Дата изменения статьи для sitemap: правка, иначе публикация. */
export function articleLastModified(article: { updatedAt?: Date | null; publishedAt?: Date | null }): Date | undefined {
  return article.updatedAt ?? article.publishedAt ?? undefined;
}

/** Самая свежая дата среди статей — `lastmod` для /blog; статей нет — undefined. */
export function newestArticleDate(
  articles: ReadonlyArray<{ updatedAt?: Date | null; publishedAt?: Date | null }>
): Date | undefined {
  let newest: Date | undefined;
  for (const article of articles) {
    const date = articleLastModified(article);
    if (date && (!newest || date.getTime() > newest.getTime())) newest = date;
  }
  return newest;
}
