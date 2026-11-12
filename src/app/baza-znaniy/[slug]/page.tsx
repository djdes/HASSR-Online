import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight } from "lucide-react";

import { KbArticleBody } from "@/components/kb/kb-article-body";
import { KbShell } from "@/components/kb/kb-shell";
import { PublicFooter, PublicHeader } from "@/components/public/public-chrome";
import { KB_ARTICLES, kbArticle, kbGroupOf, kbHeadings, kbNeighbours } from "@/content/kb/articles";
import { jsonLdSafeString } from "@/lib/json-ld";
import { DEFAULT_TWITTER_CARD } from "@/lib/meta-defaults";
import { ogImages, twitterImages } from "@/lib/og-image";

type Props = { params: Promise<{ slug: string }> };

export function generateStaticParams() {
  return KB_ARTICLES.map((article) => ({ slug: article.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const article = kbArticle((await params).slug);
  if (!article) return {};
  const title = `${article.title} — база знаний WeSetup`;
  const url = `https://wesetup.ru/baza-znaniy/${article.slug}`;
  return {
    title,
    description: article.lead,
    alternates: { canonical: url },
    openGraph: { type: "article", locale: "ru_RU", siteName: "WeSetup", url, title, description: article.lead, images: ogImages({ title: article.title, subtitle: "База знаний WeSetup" }) },
    twitter: { card: DEFAULT_TWITTER_CARD, title, description: article.lead, images: twitterImages({ title: article.title }) },
  };
}

export default async function KnowledgeBaseArticlePage({ params }: Props) {
  const { slug } = await params;
  const article = kbArticle(slug);
  if (!article) notFound();
  const group = kbGroupOf(slug);
  const { prev, next } = kbNeighbours(slug);
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "TechArticle",
    headline: article.title,
    description: article.lead,
    inLanguage: "ru",
    url: `https://wesetup.ru/baza-znaniy/${article.slug}`,
    publisher: { "@type": "Organization", name: "WeSetup", url: "https://wesetup.ru" },
  };
  return (
    <div className="min-h-screen bg-white text-[#0b1024]">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdSafeString(jsonLd) }} />
      <PublicHeader activeSection="knowledge-base" />
      <KbShell current={slug} toc={kbHeadings(article)}>
        <article className="mx-auto max-w-[780px]">
          <nav className="flex flex-wrap items-center gap-1.5 text-[13px] text-[#9b9fb3]" aria-label="Хлебные крошки">
            <Link href="/baza-znaniy" className="transition-colors hover:text-[#3848c7]">База знаний</Link>
            {group ? (
              <>
                <span>/</span>
                <span>{group.title}</span>
              </>
            ) : null}
          </nav>
          <h1 className="mt-3 text-[30px] font-semibold leading-tight tracking-[-0.02em] sm:text-[36px]">{article.title}</h1>
          <p className="mt-3 text-[17px] leading-[1.65] text-[#3c4053]">{article.lead}</p>
          <div className="mt-6">
            <KbArticleBody article={article} />
          </div>
          <div className="mt-12 grid gap-3 border-t border-[#ececf4] pt-6 sm:grid-cols-2">
            {prev ? (
              <Link href={`/baza-znaniy/${prev.slug}`} className="rounded-2xl border border-[#ececf4] p-4 transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]">
                <div className="flex items-center gap-1.5 text-[12.5px] text-[#6f7282]">
                  <ArrowLeft className="size-3.5" /> Назад
                </div>
                <div className="mt-1 text-[15px] font-semibold text-[#0b1024]">{prev.title}</div>
              </Link>
            ) : (
              <span className="hidden sm:block" />
            )}
            {next ? (
              <Link href={`/baza-znaniy/${next.slug}`} className="rounded-2xl border border-[#ececf4] p-4 text-right transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]">
                <div className="flex items-center justify-end gap-1.5 text-[12.5px] text-[#6f7282]">
                  Далее <ArrowRight className="size-3.5" />
                </div>
                <div className="mt-1 text-[15px] font-semibold text-[#0b1024]">{next.title}</div>
              </Link>
            ) : null}
          </div>
        </article>
      </KbShell>
      <PublicFooter />
    </div>
  );
}
