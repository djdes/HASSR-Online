import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowRight,
  BookOpenCheck,
  CheckCircle2,
  FileDown,
  Lightbulb,
  ScrollText,
} from "lucide-react";
import { PublicHeader, PublicFooter } from "@/components/public/public-chrome";
import {
  JOURNAL_INFO,
  JOURNAL_CATEGORY_LABEL,
} from "@/content/journal-info";
import { JOURNAL_SEO } from "@/content/journal-seo";
import { JournalScreenshot } from "@/components/public/journal-screenshot";
import { PublicBreadcrumbs } from "@/components/public/public-breadcrumbs";
import { ACTIVE_JOURNAL_CATALOG } from "@/lib/journal-catalog";
import { buildJournalFaq, journalFaqJsonLd } from "@/lib/journal-faq";
import { journalHeadline } from "@/lib/journal-headline";
import { jsonLdSafeString } from "@/lib/json-ld";
import {
  DOCX_SAMPLE_CODES,
} from "@/lib/document-docx";
import { SAMPLE_JOURNAL_CODES } from "@/lib/journal-sample-fixtures";
import {
  DEFAULT_TWITTER_CARD,
  } from "@/lib/meta-defaults";
import { FILLING_GUIDES } from "@/lib/journal-filling-guides";
import { ogImageUrl, ogImages, twitterImages } from "@/lib/og-image";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const info = JOURNAL_INFO[code];
  if (!info) return { title: { absolute: "Журнал не найден — WeSetup" } };
  const seo = JOURNAL_SEO[code];
  const canonical = `https://wesetup.ru/journals-info/${code}`;
  return {
    // Ключевик-первый title; бренд «— WeSetup» добавляет template в
    // корневом layout. Fallback БЕЗ ручного суффикса — иначе на первом
    // журнале без записи в JOURNAL_SEO получилось бы «…— WeSetup — WeSetup».
    title: seo?.title ?? info.tagline,
    description: seo?.description ?? info.why,
    keywords: seo?.keywords,
    alternates: { canonical },
    openGraph: {
      title: seo?.title ?? info.tagline,
      description: seo?.description ?? info.why,
      url: canonical,
      type: "article",
      locale: "ru_RU",
      siteName: "WeSetup",
      images: ogImages({ title: seo?.title ?? info.tagline, subtitle: seo?.description ?? info.why, kind: "journal" }),
    },
    twitter: {
      card: DEFAULT_TWITTER_CARD,
      title: seo?.title ?? info.tagline,
      description: seo?.description ?? info.why,
      images: twitterImages({ title: seo?.title ?? info.tagline, subtitle: seo?.description ?? info.why, kind: "journal" }),
    },
  };
}

/** Журналы с публичным образцом — страница серверная, импорт безопасен. */
const SAMPLE_CODES = new Set<string>(SAMPLE_JOURNAL_CODES);
const DOCX_CODES = new Set<string>(DOCX_SAMPLE_CODES);

export default async function JournalInfoDetailPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const info = JOURNAL_INFO[code];
  if (!info) notFound();
  const seo = JOURNAL_SEO[code];

  // Название из каталога («Гигиенический журнал», «Журнал уборки») — это
  // и есть та фраза, по которой страницу ищут. Раньше оно использовалось
  // только в хлебных крошках, а заголовок брал описательный tagline.
  const journalName = journalHeadline(
    seo?.title,
    ACTIVE_JOURNAL_CATALOG.find((j) => j.code === code)?.name,
    info.tagline
  );
  const faq = buildJournalFaq(info, journalName);

  const related = Object.values(JOURNAL_INFO)
    .filter((j) => j.category === info.category && j.code !== info.code)
    .slice(0, 4);

  const canonical = `https://wesetup.ru/journals-info/${code}`;
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: seo?.title ?? info.tagline,
    description: seo?.description ?? info.why,
    // Article.image is required per Google rich-results spec — без него
    // карточка не попадает в Article rich result. /og-default — 1200×630
    // landscape brand-hero, лучше для rich-snippet чем квадрат
    // icon-512.png. См. blog/[slug] для идентичного фикса.
    image: [ogImageUrl({ title: seo?.title ?? info.tagline, subtitle: seo?.description ?? info.why, kind: "journal" })],
    url: canonical,
    inLanguage: "ru-RU",
    keywords: seo?.keywords?.join(", "),
    mainEntityOfPage: canonical,
    publisher: {
      "@type": "Organization",
      name: "WeSetup",
      url: "https://wesetup.ru",
      logo: {
        "@type": "ImageObject",
        url: "https://wesetup.ru/icons/icon-512.png",
        width: 512,
        height: 512,
      },
    },
  };

  // HowTo — расширенный сниппет «как заполнять»: шаги и материалы из гайда
  // для новых сотрудников, того же, что показывается внутри формы.
  const guide = FILLING_GUIDES[code];
  const howToLd = guide
    ? {
        "@context": "https://schema.org",
        "@type": "HowTo",
        name: `Как заполнять: ${seo?.title ?? info.tagline}`,
        description: guide.summary,
        inLanguage: "ru-RU",
        supply: guide.materials.map((name) => ({ "@type": "HowToSupply", name })),
        step: guide.steps.map((step, index) => ({
          "@type": "HowToStep",
          position: index + 1,
          name: step.title,
          text: step.detail,
          url: `${canonical}#step-${index + 1}`,
        })),
      }
    : null;

  return (
    <div className="min-h-screen bg-white text-[#0b1024]">
      {howToLd ? (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdSafeString(howToLd) }} />
      ) : null}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdSafeString(jsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLdSafeString(journalFaqJsonLd(faq)),
        }}
      />
      <PublicHeader activeSection="journals-info" />

      <section className="mx-auto max-w-[1200px] px-4 sm:px-6">
        <div className="relative overflow-hidden rounded-3xl bg-[#0b1024] px-5 py-10 text-white sm:px-6 sm:py-14 md:px-12 md:py-16">
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute -left-24 -top-24 size-[380px] rounded-full bg-[#5566f6] opacity-40 blur-[120px]" />
            <div className="absolute -bottom-32 -right-32 size-[420px] rounded-full bg-[#7a5cff] opacity-30 blur-[140px]" />
          </div>
          <div className="relative">
            <PublicBreadcrumbs
              items={[
                { name: "Журналы", href: "/journals-info" },
                { name: journalName },
              ]}
            />
            <div className="mt-5 inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-[12px] font-medium uppercase tracking-[0.18em] text-white/80 backdrop-blur">
              <BookOpenCheck className="size-3.5" />
              {JOURNAL_CATEGORY_LABEL[info.category]}
            </div>
            {/* h1 — название журнала, а не tagline. Раньше здесь стояло
                описательное предложение с точкой («Акт списания
                продукции.»), в котором слова «журнал» не было вовсе,
                хотя <title> у страницы ключ-первый. Из-за расхождения
                Яндекс по запросам «журнал X» показывал сводную /blanki,
                а не саму страницу журнала (съём 2026-09-10). */}
            <h1 className="mt-4 max-w-[780px] text-[32px] font-semibold leading-[1.1] tracking-[-0.02em] md:text-[44px]">
              {journalName}
            </h1>
            <p className="mt-4 max-w-[720px] text-[16px] leading-[1.6] text-white/80 md:text-[18px]">
              {info.tagline} {info.why}
            </p>
          </div>
        </div>
      </section>

      {seo?.seoIntro ? (
        <section className="mx-auto max-w-[1200px] px-4 pt-8 sm:px-6 sm:pt-10">
          <div className="rounded-3xl border border-[#ececf4] bg-[#fafbff] p-5 sm:p-7 md:p-8">
            <h2 className="mb-3 text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
              Что это за журнал
            </h2>
            <p className="text-[16px] leading-[1.7] text-[#3c4053]">
              {seo.seoIntro}
            </p>
          </div>
        </section>
      ) : null}

      {/* Live screenshot of the authenticated journal page, captured by
          scripts/capture-screenshots.ts nightly. Falls back to a neutral
          skeleton when the file isn't on disk yet. */}
      <section className="mx-auto max-w-[1200px] px-4 pt-8 sm:px-6 sm:pt-10">
        <h2 className="mb-4 text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
          Как это выглядит в системе
        </h2>
        <JournalScreenshot code={code} label={info.tagline} />
      </section>

      {/* ОБРАЗЕЦ — показываем сам PDF, а не картинку с него. Встроенный
          файл всегда совпадает с тем, что скачается: отдельное превью
          пришлось бы перегенерировать при каждой правке бланка, и оно
          бы тихо разъехалось. На телефонах встроенный просмотр PDF
          работает не везде, поэтому под рамкой всегда есть кнопки. */}
      {SAMPLE_CODES.has(code) ? (
        <section className="mx-auto max-w-[1200px] px-4 pt-8 sm:px-6">
          <div className="overflow-hidden rounded-3xl border border-[#5566f6]/20 bg-gradient-to-br from-[#f5f6ff] to-white p-5 sm:p-6">
            <div className="flex flex-wrap items-start gap-4">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-[#5566f6] text-white">
                <FileDown className="size-5" />
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="text-[15px] font-semibold text-[#0b1024]">
                  Так выглядит заполненный журнал
                </h2>
                <p className="mt-1 text-[13px] leading-[1.55] text-[#6f7282]">
                  Тот же файл, который сервис выдаёт инспектору. Данные
                  вымышленные — организация «Ромашка» и пять сотрудников.
                </p>
              </div>
              <div className="flex gap-2">
                <a
                  href={`/api/journal-samples/${code}/pdf`}
                  className="inline-flex h-11 items-center gap-1.5 rounded-2xl bg-[#5566f6] px-4 text-[14px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors hover:bg-[#4a5bf0]"
                >
                  <FileDown className="size-4" />
                  PDF
                </a>
                {DOCX_CODES.has(code) ? (
                  <a
                    href={`/api/journal-samples/${code}/docx`}
                    className="inline-flex h-11 items-center gap-1.5 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
                  >
                    <FileDown className="size-4 text-[#5566f6]" />
                    DOCX
                  </a>
                ) : null}
              </div>
            </div>

            {/* Журналы печатаются альбомной A4 — 297×210, отсюда 1.414/1 */}
            <object
              data={`/api/journal-samples/${code}/pdf?inline=1#toolbar=0&navpanes=0&scrollbar=0&view=FitH`}
              type="application/pdf"
              aria-label="Образец заполненного журнала"
              className="mt-5 hidden aspect-[1.414/1] w-full rounded-2xl border border-[#dcdfed] bg-white sm:block"
            >
              <div className="flex h-full items-center justify-center p-6 text-center text-[13px] text-[#6f7282]">
                Браузер не показывает PDF на странице — откройте файл
                кнопкой выше.
              </div>
            </object>
            <p className="mt-2 hidden text-[12px] text-[#9b9fb3] sm:block">
              Пролистайте прямо здесь или скачайте, чтобы распечатать.
            </p>
          </div>
        </section>
      ) : null}

      <section className="mx-auto max-w-[1200px] px-4 py-8 sm:px-6 sm:py-12">
        <div className="grid gap-6 md:grid-cols-[1fr_320px]">
          {/* MAIN */}
          <div className="space-y-8">
            {/* WHAT TO FILL */}
            <div className="rounded-3xl border border-[#ececf4] bg-white p-5 sm:p-7">
              <h2 className="flex items-center gap-2 text-[13px] font-semibold uppercase tracking-[0.14em] text-[#3848c7]">
                <CheckCircle2 className="size-4" />
                Что заполняется
              </h2>
              <ul className="mt-4 space-y-2.5 text-[15px] leading-[1.6] text-[#3c4053]">
                {info.whatToFill.map((item, i) => (
                  <li key={i} className="flex gap-3">
                    <span className="mt-2 inline-block size-1.5 shrink-0 rounded-full bg-[#5566f6]" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            {/* NORMATIVE */}
            <div className="rounded-3xl border border-[#ececf4] bg-white p-5 sm:p-7">
              <h2 className="flex items-center gap-2 text-[13px] font-semibold uppercase tracking-[0.14em] text-[#3848c7]">
                <ScrollText className="size-4" />
                На основании
              </h2>
              <ul className="mt-4 space-y-2 text-[15px] text-[#3c4053]">
                {info.normative.map((n, i) => (
                  <li key={i}>
                    <span className="font-medium text-[#0b1024]">
                      {n.title}
                    </span>
                    {n.pointer ? (
                      <span className="text-[#6f7282]">, {n.pointer}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>

            {/* TIPS */}
            {info.tips.length > 0 && (
              <div className="rounded-3xl border border-[#c8f0d5] bg-[#ecfdf5] p-5 sm:p-7">
                <div className="flex items-center gap-2 text-[13px] font-semibold uppercase tracking-[0.14em] text-[#116b2a]">
                  <Lightbulb className="size-4" />
                  Как помогает WeSetup
                </div>
                <ul className="mt-4 space-y-2.5 text-[15px] leading-[1.6] text-[#116b2a]">
                  {info.tips.map((t, i) => (
                    <li key={i} className="flex gap-3">
                      <span className="mt-2 inline-block size-1.5 shrink-0 rounded-full bg-[#116b2a]" />
                      {t}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* SIDEBAR */}
          <aside className="space-y-5">
            <div className="rounded-3xl border border-[#ececf4] bg-[#fafbff] p-6">
              <div className="text-[13px] font-medium text-[#6f7282]">
                Код журнала
              </div>
              <div className="mt-1 break-all font-mono text-[15px] font-semibold text-[#0b1024]">
                {info.code}
              </div>
              <Link
                href="/register"
                className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-[#5566f6] px-4 py-3 text-[14px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors hover:bg-[#4a5bf0]"
              >
                Попробовать бесплатно
                <ArrowRight className="size-4" />
              </Link>
              <p className="mt-3 text-[12px] leading-[1.5] text-[#6f7282]">
                Все журналы доступны на бесплатном тарифе — без
                ограничений по времени и без карты.
              </p>
            </div>

            {related.length > 0 && (
              <div className="rounded-3xl border border-[#ececf4] bg-white p-6">
                <div className="text-[13px] font-medium uppercase tracking-[0.14em] text-[#6f7282]">
                  Похожие журналы
                </div>
                <ul className="mt-3 space-y-2">
                  {related.map((r) => (
                    <li key={r.code}>
                      <Link
                        href={`/journals-info/${r.code}`}
                        className="group flex flex-col gap-0.5 rounded-xl p-2 transition-colors hover:bg-[#f5f6ff]"
                      >
                        <span className="text-[14px] font-medium text-[#0b1024] group-hover:text-[#3848c7]">
                          {r.tagline}
                        </span>
                        <span className="break-all font-mono text-[11px] text-[#6f7282]">
                          {r.code}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </aside>
        </div>
      </section>

      {/* Вопросы собираются из полей самого журнала — графы, норматив,
          периодичность. Одинаковый блок на всех страницах журналов был бы дублем и
          только усилил бы причину, по которой поисковик выбирал сводную
          /blanki вместо профильных страниц. */}
      <section className="mx-auto max-w-[860px] px-4 pb-12 sm:px-6">
        <h2 className="text-[26px] font-semibold tracking-[-0.02em]">
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
