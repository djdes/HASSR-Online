import { NextResponse } from "next/server";

import { readPromoPublishedArticles } from "@/lib/promo-cache";
import { buildRss } from "@/lib/rss";
import { publicLocaleRoute, localizedHref } from "@/i18n/site-locale";
import { translatorFor } from "@/i18n/translator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** RSS блога из файлового JSON-снапшота (0 SELECT к БД): опубликованные статьи, свежие первыми. */
export async function GET(request: Request) {
  const locale = publicLocaleRoute(new URL(request.url).pathname)?.locale ?? "ru";
  const t = await translatorFor(locale);
  const articles = (await readPromoPublishedArticles(locale, new Date()))
    .filter((article) => !article.translationMissing)
    .slice(0, 50);

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
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Content-Language": locale === "uz" ? "uz-Latn" : locale,
      "Cache-Control": "public, max-age=900",
    },
  });
}
