import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, Clock } from "lucide-react";
import { db } from "@/lib/db";
import { PublicHeader, PublicFooter } from "@/components/public/public-chrome";
import { PublicBreadcrumbs } from "@/components/public/public-breadcrumbs";
import { ArticleRenderer } from "@/components/public/article-renderer";
import { isArticleBlockArray } from "@/lib/article-blocks";
import { relatedJournalCodes } from "@/lib/blog-related-journals";
import { JOURNAL_INFO } from "@/content/journal-info";
import { ACTIVE_JOURNAL_CATALOG } from "@/lib/journal-catalog";
import { journalHeadline } from "@/lib/journal-headline";
import { JOURNAL_SEO } from "@/content/journal-seo";
import { jsonLdSafeString } from "@/lib/json-ld";
import {
  DEFAULT_TWITTER_CARD,
  } from "@/lib/meta-defaults";
import { ogImages, twitterImages } from "@/lib/og-image";
import { JOURNALS_TOTAL_LABEL } from "@/lib/journal-catalog";
import { employeesGenitiveLabel } from "@/lib/plan-catalog";
import { FREE_MAX_USERS } from "@/lib/plan-limits";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function formatDate(date: Date | null) {
  if (!date) return "";
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const article = await db.article.findUnique({
    where: { slug },
    select: { title: true, excerpt: true, publishedAt: true },
  });
  if (!article || !article.publishedAt) {
    return { title: { absolute: "Статья не найдена — WeSetup" } };
  }
  const url = `https://wesetup.ru/blog/${slug}`;
  return {
    // article.title уже самостоятельный, layout.template добавит — WeSetup.
    title: article.title,
    description: article.excerpt,
    alternates: { canonical: url },
    openGraph: {
      type: "article",
      locale: "ru_RU",
      siteName: "WeSetup",
      url,
      title: article.title,
      description: article.excerpt,
      images: ogImages({ title: article.title, subtitle: article.excerpt, kind: "article" }),
      publishedTime: article.publishedAt?.toISOString(),
    },
    twitter: {
      card: DEFAULT_TWITTER_CARD,
      title: article.title,
      description: article.excerpt,
      images: twitterImages({ title: article.title, subtitle: article.excerpt, kind: "article" }),
    },
  };
}

export default async function BlogArticlePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const article = await db.article.findUnique({
    where: { slug },
  });
  if (!article || !article.publishedAt) notFound();

  const body = isArticleBlockArray(article.body) ? article.body : [];

  // Вопросы берём из блоков статьи, а не выводим из заголовков: в этих
  // статьях заголовки называют разделы, а не спрашивают.
  const faqItems = body.flatMap((block) =>
    block.type === "faq" ? block.items : []
  );
  const faqLd =
    faqItems.length > 0
      ? {
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: faqItems.map((item) => ({
            "@type": "Question",
            name: item.q,
            acceptedAnswer: { "@type": "Answer", text: item.a },
          })),
        }
      : null;

  // Журналы, о которых статья написана. Раньше единственная
  // перелинковка вела на другие статьи блога, и весь внутренний вес
  // оставался внутри блога — на страницах, которые не ранжируются.
  // Каталог, который ранжируется, из блога не получал ничего.
  const journalLinks = relatedJournalCodes(slug)
    .map((code) => {
      const info = JOURNAL_INFO[code];
      if (!info) return null;
      return {
        code,
        name: journalHeadline(
          JOURNAL_SEO[code]?.title,
          ACTIVE_JOURNAL_CATALOG.find((j) => j.code === code)?.name,
          info.tagline
        ),
        tagline: info.tagline,
      };
    })
    .filter((item): item is { code: string; name: string; tagline: string } => item !== null);

  // Похожие статьи: ранжируем по пересечению тегов с текущей.
  // Запрашиваем чуть больше чем 3 чтобы было из чего выбирать,
  // считаем overlap, сортируем, берём top-3.
  const relatedRaw = await db.article.findMany({
    where: {
      publishedAt: { not: null },
      slug: { not: slug },
    },
    orderBy: { publishedAt: "desc" },
    take: 30,
    select: {
      slug: true,
      title: true,
      excerpt: true,
      tags: true,
      readMinutes: true,
      publishedAt: true,
    },
  });
  const currentTags = new Set(article.tags.map((t) => t.toLowerCase()));
  const related = relatedRaw
    .map((r) => {
      const overlap = r.tags.reduce(
        (acc, t) => (currentTags.has(t.toLowerCase()) ? acc + 1 : acc),
        0,
      );
      return { ...r, overlap };
    })
    .sort((a, b) => {
      // Сначала по overlap, потом по дате (свежее → раньше).
      if (b.overlap !== a.overlap) return b.overlap - a.overlap;
      const ad = a.publishedAt?.getTime() ?? 0;
      const bd = b.publishedAt?.getTime() ?? 0;
      return bd - ad;
    })
    .slice(0, 3);

  // E20: schema.org Article markup для расширенных snippet'ов в Google.
  // Per Google docs, Article requires `image` field — без него карточка
  // не попадает в Article rich result. /og-default — 1200×630 brand-hero,
  // лучше для Article rich-snippet чем квадрат icon-512. Когда у статей
  // появятся per-article designed hero-images, переключим.
  const articleJsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: article.title,
    description: article.excerpt,
    image: ["https://wesetup.ru/og-default"],
    datePublished: article.publishedAt?.toISOString(),
    // dateModified берём из updatedAt, а не из даты публикации: иначе
    // правка статьи не видна поисковику как обновление, и в карте сайта
    // (sitemap.ts уже отдаёт updatedAt) стоит одна дата, а в разметке
    // страницы — другая. Расхождение снижает доверие к обеим.
    dateModified: (article.updatedAt ?? article.publishedAt)?.toISOString(),
    author: {
      "@type": "Organization",
      name: "WeSetup",
      url: "https://wesetup.ru",
    },
    publisher: {
      "@type": "Organization",
      name: "WeSetup",
      logo: {
        "@type": "ImageObject",
        url: "https://wesetup.ru/icons/icon-512.png",
        width: 512,
        height: 512,
      },
    },
    keywords: article.tags.join(", "),
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": `https://wesetup.ru/blog/${slug}`,
    },
  };

  return (
    <div className="min-h-screen bg-white text-[#0b1024]">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdSafeString(articleJsonLd) }}
      />
      {/* FAQPage только когда в статье реально есть блок вопросов:
          пустая или выдуманная разметка хуже её отсутствия. */}
      {faqLd ? (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: jsonLdSafeString(faqLd) }}
        />
      ) : null}
      <PublicHeader activeSection="blog" />

      <article className="mx-auto max-w-[760px] px-6 py-10 md:py-14">
        <PublicBreadcrumbs
          tone="light"
          items={[{ name: "Блог", href: "/blog" }, { name: article.title }]}
        />

        <div className="mt-6 flex flex-wrap items-center gap-2 text-[12px] text-[#6f7282]">
          {article.tags.slice(0, 4).map((t) => (
            <span
              key={t}
              className="rounded-full bg-[#f5f6ff] px-2.5 py-1 text-[#3848c7]"
            >
              {t}
            </span>
          ))}
          <span className="inline-flex items-center gap-1">
            <Clock className="size-3.5" /> {article.readMinutes} мин
          </span>
          <span>· {formatDate(article.publishedAt)}</span>
        </div>

        <h1 className="mt-4 text-[36px] font-semibold leading-[1.1] tracking-[-0.02em] md:text-[44px]">
          {article.title}
        </h1>
        <p className="mt-5 text-[18px] leading-[1.6] text-[#3c4053]">
          {article.excerpt}
        </p>

        <div className="mt-10 border-t border-[#ececf4] pt-8">
          <ArticleRenderer blocks={body} />
        </div>

        <div className="mt-10 rounded-3xl bg-gradient-to-br from-[#0b1024] via-[#1a234a] to-[#3848c7] p-5 text-center text-white shadow-[0_20px_60px_-30px_rgba(11,16,36,0.55)] sm:mt-14 sm:p-8">
          <div className="text-[22px] font-semibold tracking-tight">
            Вести этот журнал в WeSetup бесплатно
          </div>
          <p className="mx-auto mt-2 max-w-[480px] text-[14px] text-white/70">
            Все {JOURNALS_TOTAL_LABEL} СанПиН и ХАССП в одном кабинете. Бесплатный
            тариф навсегда на {employeesGenitiveLabel(FREE_MAX_USERS)}, без привязки карты.
          </p>
          <Link
            href="/register"
            className="mt-5 inline-flex items-center gap-2 rounded-2xl bg-white px-5 py-3 text-[14px] font-medium text-[#0b1024] shadow-[0_10px_30px_-12px_rgba(0,0,0,0.45)] transition-transform hover:-translate-y-0.5"
          >
            Начать бесплатно
            <ArrowRight className="size-4 text-[#5566f6]" />
          </Link>
        </div>
      </article>

      {journalLinks.length > 0 && (
        <section className="mx-auto max-w-[1200px] px-4 pb-10 sm:px-6">
          <h2 className="text-[13px] font-medium uppercase tracking-[0.18em] text-[#6f7282]">
            Журналы из статьи
          </h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {journalLinks.map((item) => (
              <Link
                key={item.code}
                href={`/journals-info/${item.code}`}
                className="group rounded-3xl border border-[#ececf4] bg-white p-5 transition-all duration-150 hover:-translate-y-0.5 hover:border-[#5566f6]/40"
              >
                <div className="text-[15px] font-semibold leading-snug text-[#0b1024] group-hover:text-[#3848c7]">
                  {item.name}
                </div>
                <p className="mt-1.5 line-clamp-2 text-[13px] leading-[1.5] text-[#6f7282]">
                  {item.tagline}
                </p>
              </Link>
            ))}
          </div>
        </section>
      )}

      {related.length > 0 && (
        <section className="mx-auto max-w-[1200px] px-4 pb-10 sm:px-6 sm:pb-16">
          <h2 className="text-[13px] font-medium uppercase tracking-[0.18em] text-[#6f7282]">
            Читать дальше
          </h2>
          <div className="mt-4 grid gap-5 md:grid-cols-3">
            {related.map((r) => (
              <Link
                key={r.slug}
                href={`/blog/${r.slug}`}
                className="group rounded-3xl border border-[#ececf4] bg-white p-6 transition-all hover:-translate-y-0.5 hover:border-[#5566f6]/40"
              >
                <div className="text-[12px] text-[#6f7282]">
                  {formatDate(r.publishedAt)} · {r.readMinutes} мин
                </div>
                <div className="mt-2 text-[17px] font-semibold leading-snug group-hover:text-[#3848c7]">
                  {r.title}
                </div>
                <p className="mt-2 line-clamp-2 text-[13px] text-[#6f7282]">
                  {r.excerpt}
                </p>
              </Link>
            ))}
          </div>
        </section>
      )}

      <PublicFooter />
    </div>
  );
}
