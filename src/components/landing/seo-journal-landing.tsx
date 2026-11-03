import Link from "next/link";
import {
  ArrowRight,
  BookOpenCheck,
  Calculator,
  CheckCircle2,
  Download,
  FileDown,
  ScrollText,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { PublicHeader, PublicFooter } from "@/components/public/public-chrome";
import { PublicBreadcrumbs } from "@/components/public/public-breadcrumbs";
import { jsonLdSafeString } from "@/lib/json-ld";
import { SEO_LANDINGS, type SeoJournalConfig } from "@/content/seo-landings";
export { SEO_LANDINGS };
export type { SeoJournalConfig };
import { DEFAULT_TWITTER_CARD } from "@/lib/meta-defaults";
import { ogImages, twitterImages } from "@/lib/og-image";
import { ACTIVE_JOURNAL_CATALOG } from "@/lib/journal-catalog";
import { BlankDownloadButton } from "@/components/public/blank-download";

/**
 * Посадочные страницы под коммерческие поисковые запросы по журналам СанПиН и ХАССП.
 * Каждая страница объединяет описание норматива, состав граф, скачивание образца PDF,
 * профильные ответы (FAQPage JSON-LD) и навигацию к смежным журналам и калькуляторам.
 */

/**
 * Журналы, у которых есть публичный образец. Список повторяет
 * SAMPLE_JOURNAL_CODES из journal-sample-fixtures: импортировать оттуда
 * нельзя — тот модуль тянет за собой jsPDF.
 */
const SAMPLE_CODES = new Set([
  "hygiene",
  "health_check",
  "climate_control",
  "cold_equipment_control",
  "cleaning_ventilation_checklist",
  "cleaning",
  "general_cleaning",
  "uv_lamp_runtime",
  "finished_product",
  "perishable_rejection",
  "incoming_control",
  "fryer_oil",
  "med_books",
]);

function sampleCode(c: SeoJournalConfig): string | undefined {
  if (c.downloadHref) return undefined;
  return c.relatedCode && SAMPLE_CODES.has(c.relatedCode) ? c.relatedCode : undefined;
}

export function getSeoMetadata(c: SeoJournalConfig) {
  return {
    title: c.metaTitle,
    description: c.metaDescription,
    ...(c.keywords && c.keywords.length > 0 ? { keywords: [...c.keywords] } : {}),
    alternates: { canonical: `https://wesetup.ru/${c.slug}` },
    openGraph: {
      type: "website",
      locale: "ru_RU",
      siteName: "WeSetup",
      title: c.metaTitle,
      description: c.metaDescription,
      url: `https://wesetup.ru/${c.slug}`,
      images: ogImages({ title: c.metaTitle, subtitle: c.metaDescription, kind: "landing" }),
    },
    twitter: {
      card: DEFAULT_TWITTER_CARD,
      title: c.metaTitle,
      description: c.metaDescription,
      images: twitterImages({ title: c.metaTitle, subtitle: c.metaDescription, kind: "landing" }),
    },
  };
}

export function SeoJournalLanding({ config }: { config: SeoJournalConfig }) {
  const c = config;
  const pageUrl = `https://wesetup.ru/${c.slug}`;
  const graph: Array<Record<string, unknown>> = [
    {
      "@type": "WebPage",
      "@id": `${pageUrl}#page`,
      name: c.metaTitle,
      description: c.metaDescription,
      url: pageUrl,
      inLanguage: "ru-RU",
      isPartOf: { "@id": "https://wesetup.ru/#website" },
    },
  ];
  if (c.faq && c.faq.length > 0) {
    graph.push({
      "@type": "FAQPage",
      "@id": `${pageUrl}#faq`,
      mainEntity: c.faq.map((item) => ({
        "@type": "Question",
        name: item.q,
        acceptedAnswer: { "@type": "Answer", text: item.a },
      })),
    });
  }
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": graph,
  };

  return (
    <div className="min-h-screen bg-white text-[#0b1024]">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdSafeString(jsonLd) }}
      />
      <PublicHeader />

      {/* HERO */}
      <section className="mx-auto max-w-[1100px] px-4 pt-10 sm:px-6 sm:pt-16">
        <div className="rounded-3xl border border-[#ececf4] bg-white p-6 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] sm:p-10">
          <PublicBreadcrumbs
            tone="light"
            className="mb-5"
            items={[{ name: "Журналы", href: "/journals-info" }, { name: c.navLabel }]}
          />
          <Link
            href="/sanpin-2-3-2-4-4282-26"
            className="inline-flex items-center gap-2 rounded-full border border-[#dcdfed] bg-[#fafbff] px-3 py-1 text-[12px] font-medium text-[#3848c7] transition-colors hover:border-[#5566f6]/40"
          >
            <ShieldCheck className="size-3.5" />
            СанПиН 2.3/2.4.4282-26 · Электронная форма разрешена
          </Link>
          <h1 className="mt-5 max-w-[820px] text-[36px] font-semibold leading-[1.08] tracking-[-0.02em] md:text-[48px]">
            {c.hero}
          </h1>
          <p className="mt-5 max-w-[680px] text-[16px] leading-[1.6] text-[#3c4053] md:text-[18px]">
            {c.intro}
          </p>

          <div className="mt-7 flex flex-wrap items-center gap-3">
            <Link
              href="/register"
              className="group inline-flex h-12 items-center gap-2 rounded-2xl bg-[#5566f6] px-6 text-[15px] font-semibold text-white shadow-[0_12px_36px_-12px_rgba(85,102,246,0.65)] transition-colors hover:bg-[#4a5bf0]"
            >
              Вести этот журнал бесплатно
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
            </Link>
            {c.downloadHref ? (
              <a
                href={c.downloadHref}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-12 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-5 text-[15px] font-medium text-[#0b1024] hover:border-[#5566f6]/40 hover:bg-[#fafbff]"
              >
                <Download className="size-4" />
                Скачать заполненный образец
              </a>
            ) : sampleCode(c) ? (
              <BlankDownloadButton
                target={{ kind: "code", code: sampleCode(c) as string }}
                format="pdf"
                title={ACTIVE_JOURNAL_CATALOG.find((j) => j.code === sampleCode(c))?.name ?? c.navLabel}
                place={`seo:${c.slug}`}
                className="inline-flex h-12 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-5 text-[15px] font-medium text-[#0b1024] hover:border-[#5566f6]/40 hover:bg-[#fafbff]"
              >
                <Download className="size-4" />
                Скачать заполненный образец
              </BlankDownloadButton>
            ) : (
              <Link
                href="/blanki"
                className="inline-flex h-12 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-5 text-[15px] font-medium text-[#0b1024] hover:border-[#5566f6]/40 hover:bg-[#fafbff]"
              >
                <FileDown className="size-4" />
                Печатные формы PDF
              </Link>
            )}
          </div>
        </div>
      </section>

      {/* FIELDS — что должно быть в журнале */}
      <section className="mx-auto max-w-[1100px] px-4 py-14 sm:px-6 sm:py-20">
        <div className="mb-8 max-w-[640px]">
          <div className="mb-3 text-[12px] uppercase tracking-[0.18em] text-[#5566f6]">
            Что должно быть в журнале
          </div>
          <h2 className="text-[clamp(1.5rem,1.8vw+1rem,2rem)] font-semibold tracking-[-0.02em]">
            Обязательные поля по СанПиН
          </h2>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {c.fields.map((f) => (
            <div
              key={f}
              className="flex items-start gap-2 rounded-2xl border border-[#ececf4] bg-white p-4 text-[14px] leading-snug"
            >
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />
              <span>{f}</span>
            </div>
          ))}
        </div>
      </section>

      {/* WHY WESETUP */}
      <section className="mx-auto max-w-[1100px] px-4 pb-14 sm:px-6 sm:pb-20">
        <div className="rounded-3xl border border-[#ececf4] bg-[#fafbff] p-6 sm:p-10">
          <div className="mb-3 text-[12px] uppercase tracking-[0.18em] text-[#5566f6]">
            Почему WeSetup
          </div>
          <h2 className="text-[clamp(1.5rem,1.8vw+1rem,2rem)] font-semibold tracking-[-0.02em]">
            Электронный журнал — быстрее, безопаснее, без потерь
          </h2>
          <p className="mt-4 max-w-[700px] text-[15px] leading-[1.6] text-[#3c4053]">
            {c.weSetupBenefit}
          </p>

          <ul className="mt-6 grid gap-2 sm:grid-cols-2">
            {[
              "Заполнение с телефона, по QR-наклейке или в Telegram-боте за 30 секунд",
              "Напоминания по сменам и защита от незаметной правки прошлых дней",
              "PDF для проверок Роспотребнадзора — одна кнопка, шапки и подписи на месте",
              "Выгрузка в PDF и Excel в любой момент и авто-бэкап на ваш Яндекс Диск",
            ].map((b) => (
              <li
                key={b}
                className="flex items-start gap-2 text-[14px] leading-snug"
              >
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                <span>{b}</span>
              </li>
            ))}
          </ul>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Link
              href="/register"
              className="group inline-flex h-11 items-center gap-2 rounded-2xl bg-[#5566f6] px-5 text-[14px] font-semibold text-white hover:bg-[#4a5bf0]"
            >
              Начать бесплатно
              <ArrowRight className="size-4" />
            </Link>
            {c.relatedCode ? (
              <Link
                href={`/journals-info/${c.relatedCode}`}
                className="inline-flex h-11 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] hover:border-[#5566f6]/40 hover:bg-[#fafbff]"
              >
                Подробно о журнале
                <ArrowRight className="size-4 text-[#5566f6]" />
              </Link>
            ) : null}
          </div>
        </div>
      </section>

      {/* FAQ */}
      {c.faq && c.faq.length > 0 ? (
        <section className="mx-auto max-w-[1100px] px-4 pb-14 sm:px-6 sm:pb-20">
          <div className="max-w-[820px]">
            <h2 className="text-[clamp(1.5rem,1.8vw+1rem,2rem)] font-semibold tracking-[-0.02em]">
              Вопросы и ответы
            </h2>
            <div className="mt-5 space-y-3">
              {c.faq.map((item) => (
                <details
                  key={item.q}
                  className="group rounded-2xl border border-[#ececf4] bg-white p-5 open:bg-[#fafbff]"
                >
                  <summary className="cursor-pointer list-none text-[15px] font-medium text-[#0b1024] transition-colors group-hover:text-[#5566f6]">
                    {item.q}
                  </summary>
                  <p className="mt-3 text-[15px] leading-[1.65] text-[#3c4053]">
                    {item.a}
                  </p>
                </details>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {/* USEFUL TOOLS & HUB LINKS */}
      <section className="mx-auto max-w-[1100px] px-4 pb-10 sm:px-6">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Link
            href="/calc/journals"
            className="flex items-center justify-between gap-2 rounded-2xl border border-[#ececf4] bg-[#fafbff] p-4 text-[13.5px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40"
          >
            <span className="flex items-center gap-2"><Calculator className="size-4 shrink-0 text-[#5566f6]" />Подбор журналов</span>
            <ArrowRight className="size-4 shrink-0 text-[#9b9fb3]" />
          </Link>
          <Link
            href="/calc/fines"
            className="flex items-center justify-between gap-2 rounded-2xl border border-[#ececf4] bg-[#fafbff] p-4 text-[13.5px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40"
          >
            <span className="flex items-center gap-2"><BookOpenCheck className="size-4 shrink-0 text-[#5566f6]" />Калькулятор штрафов</span>
            <ArrowRight className="size-4 shrink-0 text-[#9b9fb3]" />
          </Link>
          <Link
            href="/blanki"
            className="flex items-center justify-between gap-2 rounded-2xl border border-[#ececf4] bg-[#fafbff] p-4 text-[13.5px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40"
          >
            <span className="flex items-center gap-2"><FileDown className="size-4 shrink-0 text-[#5566f6]" />Печатные формы PDF</span>
            <ArrowRight className="size-4 shrink-0 text-[#9b9fb3]" />
          </Link>
          <Link
            href="/prikazy"
            className="flex items-center justify-between gap-2 rounded-2xl border border-[#ececf4] bg-[#fafbff] p-4 text-[13.5px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40"
          >
            <span className="flex items-center gap-2"><ScrollText className="size-4 shrink-0 text-[#5566f6]" />Образцы приказов</span>
            <ArrowRight className="size-4 shrink-0 text-[#9b9fb3]" />
          </Link>
          <Link
            href="/avtozapolnenie"
            className="flex items-center justify-between gap-2 rounded-2xl border border-[#ececf4] bg-[#fafbff] p-4 text-[13.5px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40"
          >
            <span className="flex items-center gap-2"><Sparkles className="size-4 shrink-0 text-[#5566f6]" />Автозаполнение</span>
            <ArrowRight className="size-4 shrink-0 text-[#9b9fb3]" />
          </Link>
        </div>
      </section>

      {/* RELATED — другие SEO-лендинги под смежные запросы */}
      <section className="mx-auto max-w-[1100px] px-4 pb-14 sm:px-6 sm:pb-20">
        <div className="rounded-3xl border border-[#ececf4] bg-[#fafbff] p-6 sm:p-8">
          <div className="mb-5 text-[12px] uppercase tracking-[0.18em] text-[#6f7282]">
            Похожие журналы
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {Object.values(SEO_LANDINGS)
              .filter((s) => s.slug !== c.slug)
              .slice(0, 8)
              .map((s) => (
                <Link
                  key={s.slug}
                  href={`/${s.slug}`}
                  className="group flex items-start gap-3 rounded-2xl border border-[#ececf4] bg-white p-4 transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
                >
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                  <div className="min-w-0 flex-1 text-[13px] font-medium text-[#0b1024] group-hover:text-[#3848c7]">
                    {s.hero}
                  </div>
                  <ArrowRight className="mt-0.5 size-4 shrink-0 text-[#9b9fb3] transition-transform group-hover:translate-x-0.5 group-hover:text-[#5566f6]" />
                </Link>
              ))}
          </div>
        </div>
      </section>

      <PublicFooter />
    </div>
  );
}
