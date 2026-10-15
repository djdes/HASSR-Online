import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { buildRss } from "@/lib/rss";
import { localizeArticles } from "@/lib/article-localization-server";
import { publicLocaleRoute, localizedHref } from "@/i18n/site-locale";
import { translatorFor } from "@/i18n/translator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** RSS блога: опубликованные статьи, свежие первыми. */
export async function GET(request: Request) {
  // Public cache content depends only on the URL, never a session or cookie.
  const locale = publicLocaleRoute(new URL(request.url).pathname)?.locale ?? "ru";
  const t = await translatorFor(locale);
  const sources = await db.article.findMany({
    where: { publishedAt: { not: null, lte: new Date() } },
    orderBy: { publishedAt: "desc" },
    take: 50,
    select: { id: true, body: true, slug: true, title: true, excerpt: true, publishedAt: true, tags: true },
  });
  const articles = (await localizeArticles(sources, locale)).filter(article => !article.translationMissing);
  const xml = buildRss({
    title: t("blogChrome.rss.title"),
    link: `https://wesetup.ru${localizedHref("/blog", locale)}`,
    description: t("blogChrome.rss.description"),
    language: locale === "uz" ? "uz-Latn" : locale,
    selfUrl: `https://wesetup.ru${localizedHref("/blog/feed.xml", locale)}`,
    items: articles.map((a) => ({
      title: a.title,
      link: `https://wesetup.ru${localizedHref(`/blog/${a.slug}`, locale)}`,
      description: a.excerpt,
      pubDate: a.publishedAt ?? new Date(),
      categories: a.displayTags,
    })),
  });
  return new NextResponse(xml, {
    headers: { "Content-Type": "application/rss+xml; charset=utf-8", "Content-Language": locale, "Cache-Control": "public, max-age=900" },
  });
}
