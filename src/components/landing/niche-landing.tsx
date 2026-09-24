import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  Clock,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { PublicHeader, PublicFooter } from "@/components/public/public-chrome";
import { PublicBreadcrumbs } from "@/components/public/public-breadcrumbs";
import { jsonLdSafeString } from "@/lib/json-ld";
import { buildNicheFaq, nicheFaqJsonLd } from "@/lib/niche-faq";
import { NICHES, type Niche } from "@/content/niches";
import { JOURNALS_TOTAL_LABEL } from "@/lib/journal-catalog";
export { NICHES };
export type { Niche };
import {
  DEFAULT_TWITTER_CARD,
  } from "@/lib/meta-defaults";
import { ogImages, twitterImages } from "@/lib/og-image";

/**
 * E19 — лендинги под ниши общепита. Каждая ниша имеет адаптированный
 * заголовок, выгоды и список «обязательных журналов» для этого типа
 * бизнеса. Цель — поднять SEO под запросы типа «электронные журналы
 * для кафе» и улучшить релевантность для конкретного посетителя.
 *
 * Роуты подключают этот компонент:
 *   /dlya-kafe         → kafe
 *   /dlya-pekarni      → pekarni
 *   /dlya-stolovoy     → stolovoy
 *   /dlya-proizvodstva → proizvodstva
 */

/**
 * Build metadata for a route given the niche slug. Используется в
 * каждом dlya-XXX/page.tsx как `export const metadata`.
 */
export function getNicheMetadata(slug: string) {
  const data = NICHES[slug];
  if (!data) return { title: { absolute: "Не найдено — WeSetup" } };
  return {
    title: data.metaTitle,
    description: data.metaDescription,
    alternates: {
      canonical: `https://wesetup.ru/${data.slug}`,
    },
    openGraph: {
      type: "website",
      locale: "ru_RU",
      siteName: "WeSetup",
      title: data.metaTitle,
      description: data.metaDescription,
      url: `https://wesetup.ru/${data.slug}`,
      images: ogImages({ title: data.metaTitle, subtitle: data.metaDescription, kind: "landing" }),
    },
    twitter: {
      card: DEFAULT_TWITTER_CARD,
      title: data.metaTitle,
      description: data.metaDescription,
      images: twitterImages({ title: data.metaTitle, subtitle: data.metaDescription, kind: "landing" }),
    },
  };
}

export function NicheLanding({ slug }: { slug: string }) {
  const data = NICHES[slug];
  if (!data) {
    // Не вызываем notFound() здесь — каждая страница-обёртка обязана
    // передавать существующий slug. Если не передан, роутинг показал
    // бы ошибку компиляции/404 раньше, до этого компонента.
    throw new Error(`Unknown niche: ${slug}`);
  }

  const faq = buildNicheFaq(data);

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: data.metaTitle,
    description: data.metaDescription,
    url: `https://wesetup.ru/${data.slug}`,
    inLanguage: "ru-RU",
    isPartOf: { "@id": "https://wesetup.ru/#website" },
  };

  return (
    <div className="min-h-screen bg-white text-[#0b1024]">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdSafeString(jsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLdSafeString(nicheFaqJsonLd(faq)),
        }}
      />
      <PublicHeader />

      {/* HERO */}
      <section className="mx-auto max-w-[1200px] px-4 sm:px-6">
        <div className="relative overflow-hidden rounded-3xl bg-[#0b1024] px-5 py-12 text-white sm:px-6 sm:py-16 md:px-12 md:py-20">
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute -left-24 -top-24 size-[420px] rounded-full bg-[#5566f6] opacity-40 blur-[120px]" />
            <div className="absolute -bottom-32 -right-32 size-[460px] rounded-full bg-[#7a5cff] opacity-30 blur-[140px]" />
          </div>
          <div className="relative">
            <PublicBreadcrumbs
              className="mb-5"
              items={[
                { name: "Журналы", href: "/journals-info" },
                { name: data.navLabel },
              ]}
            />
            <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[12px] uppercase tracking-[0.18em] text-white/80 backdrop-blur">
              <Sparkles className="size-3.5" />
              {data.audience}
            </div>
            <h1 className="mt-5 max-w-[820px] text-[40px] font-semibold leading-[1.08] tracking-[-0.02em] md:text-[52px]">
              {data.hero}
            </h1>
            <p className="mt-5 max-w-[680px] text-[16px] leading-[1.6] text-white/80 md:text-[18px]">
              {data.promise}
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Link
                href="/register"
                className="group inline-flex h-12 items-center gap-2 rounded-2xl bg-white px-6 text-[15px] font-semibold text-[#0b1024] transition-transform hover:-translate-y-0.5"
              >
                Начать бесплатно
                <ArrowRight className="size-4 text-[#5566f6] transition-transform group-hover:translate-x-1" />
              </Link>
              <div className="text-[12px] text-white/60">
                Без карты · Все журналы включены
              </div>
            </div>
            <div className="mt-6 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3.5 py-1.5 text-[12px] font-medium text-white/85 backdrop-blur">
              <ShieldCheck className="size-3.5 text-emerald-300" />
              Разрешено СанПиН 2.3/2.4.4282-26
            </div>
          </div>
        </div>
      </section>

      {/* PAINS */}
      <section className="mx-auto max-w-[1200px] px-4 py-14 sm:px-6 sm:py-20">
        <div className="mb-8 max-w-[640px]">
          <div className="mb-3 text-[12px] uppercase tracking-[0.18em] text-[#5566f6]">
            Знакомо?
          </div>
          <h2 className="text-[clamp(1.5rem,1.8vw+1rem,2rem)] font-semibold tracking-[-0.02em]">
            Боли, которые WeSetup закрывает
          </h2>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {data.pains.map((p) => (
            <div
              key={p}
              className="rounded-2xl border border-[#ececf4] bg-[#fafbff] p-5 text-[14px] leading-[1.6] text-[#3c4053]"
            >
              {p}
            </div>
          ))}
        </div>
      </section>

      {/* JOURNALS */}
      <section className="mx-auto max-w-[1200px] px-4 pb-14 sm:px-6 sm:pb-20">
        <div className="mb-8 max-w-[640px]">
          <div className="mb-3 text-[12px] uppercase tracking-[0.18em] text-[#5566f6]">
            Обязательные журналы для вашей ниши
          </div>
          <h2 className="text-[clamp(1.5rem,1.8vw+1rem,2rem)] font-semibold tracking-[-0.02em]">
            Какие журналы вам понадобятся
          </h2>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.journals.map((j) => (
            <div
              key={j}
              className="flex items-start gap-2 rounded-2xl border border-[#ececf4] bg-white p-4 text-[14px] leading-snug text-[#0b1024]"
            >
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />
              <span>{j}</span>
            </div>
          ))}
        </div>
        {/* Перелинковка на каталог: посетитель ниши должен видеть полный
            список журналов и вернуться в общий хаб. */}
        <div className="mt-6">
          <Link
            href="/journals-info"
            className="inline-flex h-11 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
          >
            Смотреть все {JOURNALS_TOTAL_LABEL} в каталоге
            <ArrowRight className="size-4 text-[#5566f6]" />
          </Link>
        </div>
      </section>

      {/* CASES */}
      {data.cases.length > 0 && (
        <section className="mx-auto max-w-[1200px] px-4 pb-14 sm:px-6 sm:pb-20">
          <div className="mb-8 max-w-[640px]">
            <div className="mb-3 text-[12px] uppercase tracking-[0.18em] text-[#5566f6]">
              До и после
            </div>
            <h2 className="text-[clamp(1.5rem,1.8vw+1rem,2rem)] font-semibold tracking-[-0.02em]">
              Что меняется в работе
            </h2>
          </div>
          <div className="grid gap-5 md:grid-cols-2">
            {data.cases.map((c, i) => (
              <div
                key={i}
                className="rounded-2xl border border-[#ececf4] bg-white p-5 sm:p-6"
              >
                <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#a13a32]">
                  Было
                </div>
                <p className="mt-1 text-[14px] leading-[1.55] text-[#3c4053]">
                  {c.before}
                </p>
                <div className="my-3 inline-flex items-center gap-1.5 rounded-full bg-[#eef1ff] px-2.5 py-1 text-[12px] text-[#3848c7]">
                  <Clock className="size-3.5" />
                  WeSetup
                </div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-700">
                  Стало
                </div>
                <p className="mt-1 text-[14px] leading-[1.55] text-[#0b1024]">
                  {c.after}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* RELATED — другие ниши и SEO-лендинги для cross-linking.
          Хорошо для SEO (PageRank flow) и навигации (если кафе попало
          сюда по ошибке — может перейти на свою нишу). */}
      <section className="mx-auto max-w-[1200px] px-4 pb-14 sm:px-6 sm:pb-20">
        <div className="rounded-3xl border border-[#ececf4] bg-[#fafbff] p-6 sm:p-8">
          <div className="mb-5 text-[12px] uppercase tracking-[0.18em] text-[#6f7282]">
            См. также
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Object.values(NICHES)
              .filter((n) => n.slug !== data.slug)
              .map((n) => (
                <Link
                  key={n.slug}
                  href={`/${n.slug}`}
                  className="group flex items-start gap-3 rounded-2xl border border-[#ececf4] bg-white p-4 transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
                >
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#eef1ff] text-[#5566f6]">
                    <Sparkles className="size-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-semibold text-[#0b1024] group-hover:text-[#3848c7]">
                      {n.audience}
                    </div>
                    <div className="mt-0.5 text-[12px] text-[#6f7282]">
                      {n.metaTitle}
                    </div>
                  </div>
                  <ArrowRight className="mt-2 size-4 shrink-0 text-[#9b9fb3] transition-transform group-hover:translate-x-0.5 group-hover:text-[#5566f6]" />
                </Link>
              ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-[1200px] px-4 pb-20 sm:px-6">
        <div className="rounded-3xl bg-gradient-to-br from-[#0b1024] via-[#1a234a] to-[#3848c7] p-7 text-center text-white shadow-[0_30px_80px_-30px_rgba(11,16,36,0.55)] sm:p-12">
          <h2 className="text-[clamp(1.5rem,2vw+1rem,2.25rem)] font-semibold leading-tight tracking-[-0.02em]">
            Начните вести журналы прямо сегодня
          </h2>
          <p className="mx-auto mt-3 max-w-[520px] text-[14px] text-white/80">
            Бесплатный тариф навсегда: до 3 сотрудников, все {JOURNALS_TOTAL_LABEL}
            включены, без привязки карты.
          </p>
          <Link
            href="/register"
            className="mt-6 inline-flex items-center gap-2 rounded-2xl bg-white px-6 py-3 text-[14px] font-semibold text-[#0b1024] hover:bg-white/90"
          >
            Начать бесплатно
            <ArrowRight className="size-4 text-[#5566f6]" />
          </Link>
        </div>
      </section>

      {/* Вопросы собираются из данных самой ниши — её болей, набора
          журналов и обещания. Один шаблон на двенадцати лендингах был бы
          дубликатом и только усилил бы причину, по которой поисковик
          показывал вместо ниши главную страницу. */}
      <section className="mx-auto max-w-[860px] px-4 pb-14 sm:px-6">
        <h2 className="text-[clamp(1.5rem,1.8vw+1rem,2rem)] font-semibold tracking-[-0.02em]">
          Вопросы и ответы
        </h2>
        <div className="mt-6 space-y-3">
          {faq.map((item) => (
            <details
              key={item.q}
              className="group rounded-2xl border border-[#ececf4] bg-white p-5 open:bg-[#fafbff]"
            >
              <summary className="cursor-pointer list-none text-[15px] font-medium text-[#0b1024] transition-colors duration-150 group-hover:text-[#5566f6]">
                {item.q}
              </summary>
              <p className="mt-3 text-[15px] leading-[1.65] text-[#3c4053]">
                {item.a}
              </p>
            </details>
          ))}
        </div>
      </section>

      <PublicFooter />
    </div>
  );
}
