import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, BookOpen, ClipboardList } from "lucide-react";

import { PublicBreadcrumbs } from "@/components/public/public-breadcrumbs";
import { PublicFooter, PublicHeader } from "@/components/public/public-chrome";
import { GLOSSARY, GLOSSARY_BY_SLUG } from "@/content/glossary";
import { JOURNAL_INFO } from "@/content/journal-info";
import { ACTIVE_JOURNAL_CATALOG } from "@/lib/journal-catalog";
import { jsonLdSafeString } from "@/lib/json-ld";
import { DEFAULT_TWITTER_CARD } from "@/lib/meta-defaults";
import { ogImages, twitterImages } from "@/lib/og-image";
import { JOURNALS_TOTAL_LABEL } from "@/lib/journal-catalog";

export const dynamic = "force-static";
const SITE = "https://wesetup.ru";

export function generateStaticParams() {
  return GLOSSARY.map((t) => ({ slug: t.slug }));
}

function journalName(code: string): string {
  return ACTIVE_JOURNAL_CATALOG.find((j) => j.code === code)?.name ?? JOURNAL_INFO[code]?.tagline ?? code;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const t = GLOSSARY_BY_SLUG[slug];
  if (!t) return { title: { absolute: "Термин не найден — WeSetup" } };
  const title = `${t.term}: что это`;
  const url = `${SITE}/glossary/${t.slug}`;
  return {
    title,
    description: t.short,
    alternates: { canonical: url },
    openGraph: { type: "article", locale: "ru_RU", siteName: "WeSetup", url, title, description: t.short, images: ogImages({ title: t.term, subtitle: t.short, kind: "glossary" }) },
    twitter: { card: DEFAULT_TWITTER_CARD, title, description: t.short, images: twitterImages({ title: t.term, kind: "glossary" }) },
  };
}

export default async function GlossaryTermPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const t = GLOSSARY_BY_SLUG[slug];
  if (!t) notFound();
  const url = `${SITE}/glossary/${t.slug}`;
  const related = (t.related ?? []).map((s) => GLOSSARY_BY_SLUG[s]).filter(Boolean);
  const journals = (t.journals ?? []).filter((code) => JOURNAL_INFO[code]);
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "DefinedTerm",
    name: t.term,
    description: t.short,
    url,
    inDefinedTermSet: { "@type": "DefinedTermSet", name: "Глоссарий ХАССП и СанПиН", url: `${SITE}/glossary` },
  };
  return (
    <div className="min-h-screen bg-white text-[#0b1024]">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdSafeString(jsonLd) }} />
      <PublicHeader />
      <div className="mx-auto max-w-[860px] px-4 py-8 sm:px-6 sm:py-12">
        <PublicBreadcrumbs items={[{ name: "Глоссарий", href: "/glossary" }, { name: t.term }]} tone="light" />
        <div className="mt-6 inline-flex items-center gap-2 rounded-full bg-[#f5f6ff] px-3 py-1 text-[12px] font-semibold uppercase tracking-[0.14em] text-[#3848c7]">
          <BookOpen className="size-3.5" />
          Термин
        </div>
        <h1 className="mt-3 text-[32px] font-semibold leading-tight tracking-[-0.02em] sm:text-[44px]">{t.term}</h1>
        <p className="mt-4 text-[18px] leading-[1.6] text-[#0b1024]">{t.short}</p>
        <p className="mt-4 text-[16px] leading-[1.75] text-[#3c4053]">{t.body}</p>

        {journals.length > 0 ? (
          <section className="mt-8 rounded-3xl border border-[#ececf4] bg-[#fafbff] p-6">
            <div className="flex items-center gap-2 text-[15px] font-semibold">
              <ClipboardList className="size-4 text-[#5566f6]" />
              Где это фиксируется
            </div>
            <ul className="mt-3 space-y-2">
              {journals.map((code) => (
                <li key={code}>
                  <Link href={`/journals-info/${code}`} className="inline-flex items-center gap-1.5 text-[14px] font-medium text-[#3848c7] underline-offset-2 hover:underline">
                    {journalName(code)}
                    <ArrowRight className="size-3.5" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {related.length > 0 ? (
          <section className="mt-8">
            <div className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">Связанные термины</div>
            <div className="mt-3 flex flex-wrap gap-2">
              {related.map((r) => (
                <Link key={r.slug} href={`/glossary/${r.slug}`} className="rounded-full border border-[#dcdfed] bg-white px-3.5 py-1.5 text-[13px] font-medium transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]">
                  {r.term}
                </Link>
              ))}
            </div>
          </section>
        ) : null}

        <div className="mt-10 rounded-3xl border border-[#ececf4] bg-white p-6 shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
          <div className="text-[15px] font-semibold">Ведите журналы без бумаги</div>
          <p className="mt-1.5 text-[14px] leading-[1.6] text-[#3c4053]">{JOURNALS_TOTAL_LABEL} СанПиН и ХАССП, заполнение с телефона, PDF для проверок. Бесплатно до 3 сотрудников.</p>
          <Link href="/register" className="mt-4 inline-flex h-11 items-center gap-2 rounded-2xl bg-[#5566f6] px-5 text-[14px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors hover:bg-[#4a5bf0]">
            Начать бесплатно
            <ArrowRight className="size-4" />
          </Link>
        </div>
      </div>
      <PublicFooter />
    </div>
  );
}
