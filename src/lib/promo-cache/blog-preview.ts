import type { Locale } from "@/i18n/locales";
import { isArticlePublished } from "@/lib/article-visibility";
import { readPublicSessionBadge } from "@/lib/public-session-badge";

import {
  readPromoBlogArticleDetail,
  type HydratedBlogArticle,
  type LocalizedPromoBlogArticle,
} from "./datasets";

export type BlogArticleViewResult = {
  source: HydratedBlogArticle;
  article: LocalizedPromoBlogArticle;
  related: LocalizedPromoBlogArticle[];
  scheduled: boolean;
};

/**
 * Resolves `/blog/[slug]` with 0 DB SELECTs for all published articles AND for
 * all anonymous/non-ROOT 404 misses. Queries PostgreSQL ONLY when a verified
 * ROOT superadmin previews an unpublished/scheduled draft from `/root/blog`.
 */
export async function resolveBlogArticleView(
  slug: string,
  locale: Locale,
  now: Date = new Date(),
): Promise<BlogArticleViewResult | null> {
  const cached = await readPromoBlogArticleDetail(slug, locale, now);
  if (cached) {
    return { ...cached, scheduled: false };
  }

  const badge = await readPublicSessionBadge();
  if (!badge?.isRoot) {
    return null;
  }

  const [{ db }, { localizeArticles }] = await Promise.all([
    import("@/lib/db"),
    import("@/lib/article-localization-server"),
  ]);

  const raw = await db.article.findUnique({
    where: { slug },
    include: {
      translations: {
        select: {
          locale: true,
          sourceHash: true,
          title: true,
          excerpt: true,
          body: true,
          tags: true,
        },
      },
    },
  });
  if (!raw || !raw.publishedAt) {
    return null;
  }

  const hydrated: HydratedBlogArticle = {
    id: raw.id,
    slug: raw.slug,
    title: raw.title,
    excerpt: raw.excerpt,
    body: raw.body,
    coverIcon: raw.coverIcon,
    tags: [...raw.tags],
    readMinutes: raw.readMinutes,
    publishedAt: raw.publishedAt,
    updatedAt: raw.updatedAt,
    translations: raw.translations,
  };
  const [article] = await localizeArticles([hydrated], locale);
  const scheduled = !isArticlePublished(hydrated.publishedAt, now);

  return {
    source: hydrated,
    article,
    related: [],
    scheduled,
  };
}
