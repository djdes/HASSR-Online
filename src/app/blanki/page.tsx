import type { Metadata } from "next";
import Link from "next/link";
import { FileDown, FileText, Printer, ArrowRight } from "lucide-react";
import { PublicHeader, PublicFooter } from "@/components/public/public-chrome";
import { PublicBreadcrumbs } from "@/components/public/public-breadcrumbs";
import {
  JOURNAL_INFO,
  JOURNAL_CATEGORY_LABEL,
  type JournalInfo,
} from "@/content/journal-info";
import { ACTIVE_JOURNAL_CATALOG } from "@/lib/journal-catalog";
import { DOCX_SAMPLE_CODES } from "@/lib/document-docx";
import { SAMPLE_JOURNAL_CODES } from "@/lib/journal-sample-fixtures";
import { jsonLdSafeString } from "@/lib/json-ld";
import { paperJournalById } from "@/lib/sphere-journal-rules";
import { BlankDownloadButton } from "@/components/public/blank-download";
import {
  DEFAULT_OG_IMAGES,
  DEFAULT_TWITTER_CARD,
  DEFAULT_TWITTER_IMAGES,
} from "@/lib/meta-defaults";

/**
 * Хаб бланков: один экран, с которого скачивается пустой бланк любого
 * журнала.
 *
 * Зачем отдельная страница, если есть /journals-info. Это разный спрос.
 * В каталоге человек выбирает сервис и разбирается, какие журналы ему
 * нужны. Сюда он приходит по запросу «журнал X бланк скачать» — ему
 * нужен файл, а не рассказ о продукте. Раньше такие запросы не вели
 * никуда: файлы отдаёт /api/journal-samples/, а весь /api/ закрыт в
 * robots.ts от обхода.
 *
 * Заголовки страниц разведены намеренно: каталог — «каталог журналов»,
 * этот хаб — «бланки, скачать и распечатать». Иначе две страницы
 * конкурировали бы за одну выдачу.
 */

export const dynamic = "force-dynamic";

const CANONICAL = "https://wesetup.ru/blanki";

// К заголовку layout добавляет « — WeSetup», поэтому держим его
// коротким: с суффиксом выходило 64 символа и хвост обрезался в выдаче.
const TITLE = "Бланки журналов СанПиН и ХАССП — скачать";
const DESCRIPTION =
  "Бланки всех журналов СанПиН и ХАССП для общепита: скачать PDF бесплатно и без регистрации, распечатать и заполнять от руки. С нормативом по каждому журналу.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  keywords: [
    "бланки журналов общепит",
    "скачать журнал СанПиН",
    "бланк журнала ХАССП",
    "журналы для общепита скачать",
    "образец журнала СанПиН",
    "распечатать журнал СанПиН",
  ],
  alternates: { canonical: CANONICAL },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: CANONICAL,
    type: "website",
    locale: "ru_RU",
    images: [...DEFAULT_OG_IMAGES],
  },
  twitter: {
    card: DEFAULT_TWITTER_CARD,
    title: TITLE,
    description: DESCRIPTION,
    images: [...DEFAULT_TWITTER_IMAGES],
  },
};

const CATEGORY_ORDER: Array<JournalInfo["category"]> = [
  "sanpin_daily",
  "sanpin_periodic",
  "haccp",
];

/** Вопросы видимы на странице — из них же собирается FAQPage. */
const FAQ = [
  {
    q: "Бланки правда бесплатные и без регистрации?",
    a: "Да. Регистрация не нужна: перед скачиванием укажите почту — файл скачается сразу, а копия со ссылкой придёт письмом. Это тот же бланк, который сервис печатает для проверки.",
  },
  {
    q: "Можно вести эти журналы на бумаге?",
    a: "Да, бумажная форма разрешена. СанПиН 2.3/2.4.4282-26 разрешает и электронную — при условии, что видно, кто внёс запись, и её нельзя незаметно изменить задним числом.",
  },
  {
    q: "Чем скачанный бланк отличается от журнала в сервисе?",
    a: "Бланк — пустая форма под ручку и распечатку. В сервисе те же поля заполняются с телефона, температура подтягивается с датчика, а за пропущенный день приходит напоминание.",
  },
  {
    q: "Сколько журналов обязательны для кафе?",
    a: "Базовый набор по СанПиН — тринадцать журналов: гигиена, здоровье, температуры, уборка, бракераж, входной контроль и другие. Полный список с нормативом — в таблице выше.",
  },
  {
    q: "В каком формате скачиваются бланки?",
    a: "Все журналы доступны в PDF: он открывается везде и печатается без сдвига разметки. Шесть самых частых журналов есть ещё и в DOCX, если бланк нужно поправить под себя.",
  },
];

export default async function BlankiHubPage({
  searchParams,
}: {
  searchParams: Promise<{ download?: string; paper?: string; expired?: string }>;
}) {
  // Ссылка на бумажный бланк без токена (`/api/journal-samples/paper/<id>/pdf`)
  // приводит сюда: окно email для этого бланка открывается сразу.
  const { download, paper, expired } = await searchParams;
  const autoPaper = download === "pdf" && paper ? paperJournalById(paper) : null;
  const catalogName = new Map<string, string>(
    ACTIVE_JOURNAL_CATALOG.map((item) => [item.code, item.name]),
  );
  const pdfCodes = new Set<string>(SAMPLE_JOURNAL_CODES);
  const docxCodes = new Set<string>(DOCX_SAMPLE_CODES);

  const groups = CATEGORY_ORDER.map((category) => ({
    category,
    label: JOURNAL_CATEGORY_LABEL[category],
    items: Object.values(JOURNAL_INFO).filter((j) => j.category === category),
  })).filter((g) => g.items.length > 0);

  const total = Object.keys(JOURNAL_INFO).length;

  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "CollectionPage",
        "@id": CANONICAL + "#page",
        name: TITLE,
        description: DESCRIPTION,
        url: CANONICAL,
        inLanguage: "ru-RU",
        isPartOf: { "@id": "https://wesetup.ru/#website" },
      },
      {
        "@type": "FAQPage",
        "@id": CANONICAL + "#faq",
        mainEntity: FAQ.map((item) => ({
          "@type": "Question",
          name: item.q,
          acceptedAnswer: { "@type": "Answer", text: item.a },
        })),
      },
    ],
  };

  return (
    <div className="min-h-screen bg-white text-[#0b1024]">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdSafeString(jsonLd) }}
      />
      <PublicHeader activeSection="journals-info" />
      {autoPaper ? (
        <BlankDownloadButton
          target={{ kind: "paper", paperId: autoPaper.id }}
          format="pdf"
          title={autoPaper.name}
          autoOpen
          hideTrigger
          expired={expired === "1"}
          place="blanki-paper"
        />
      ) : null}

      <section className="mx-auto max-w-[1200px] px-4 pt-8 sm:px-6">
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
                { name: "Бланки" },
              ]}
            />
            <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[12px] font-medium uppercase tracking-[0.18em] text-white/80 backdrop-blur">
              <Printer className="size-3.5" />
              Бесплатно и без регистрации
            </div>
            <h1 className="mt-5 max-w-[880px] text-[36px] font-semibold leading-[1.08] tracking-[-0.02em] md:text-[48px]">
              Бланки журналов СанПиН и ХАССП
            </h1>
            <p className="mt-4 max-w-[720px] text-[16px] leading-[1.65] text-white/80 md:text-[18px]">
              {total} пустых бланков в PDF: скачайте, распечатайте и заполняйте
              от руки. У каждого журнала указано, на основании чего он ведётся.
              Перед скачиванием укажите почту — копия файла придёт письмом.
            </p>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[1200px] px-4 py-10 sm:px-6 sm:py-14">
        {groups.map((group) => (
          <div key={group.category} className="mb-12 last:mb-0">
            <div className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 className="text-[22px] font-semibold tracking-[-0.02em]">
                {group.label}
              </h2>
              <span className="text-[13px] tabular-nums text-[#9b9fb3]">
                {group.items.length} журналов
              </span>
            </div>

            <div className="overflow-hidden rounded-3xl border border-[#ececf4] bg-white shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
              {group.items.map((info, index) => (
                <div
                  key={info.code}
                  className={
                    "flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:gap-5 sm:p-6" +
                    (index > 0 ? " border-t border-[#ececf4]" : "")
                  }
                >
                  <div className="min-w-0 flex-1">
                    <Link
                      href={"/journals-info/" + info.code}
                      className="text-[15px] font-medium text-[#0b1024] transition-colors duration-150 hover:text-[#5566f6]"
                    >
                      {catalogName.get(info.code) ?? info.tagline}
                    </Link>
                    <p className="mt-1 text-[13px] leading-[1.55] text-[#6f7282]">
                      {info.tagline}
                    </p>
                    {info.normative.length > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {info.normative.map((n) => (
                          <span
                            key={n.title}
                            className="rounded-full bg-[#f5f6ff] px-2.5 py-1 text-[12px] text-[#3848c7]"
                          >
                            {n.title}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>

                  <div className="flex shrink-0 flex-wrap gap-2">
                    {pdfCodes.has(info.code) ? (
                      <BlankDownloadButton
                        target={{ kind: "code", code: info.code }}
                        format="pdf"
                        title={catalogName.get(info.code) ?? info.tagline}
                        place="blanki"
                        className="inline-flex h-10 items-center gap-1.5 rounded-2xl bg-[#5566f6] px-4 text-[14px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors duration-150 hover:bg-[#4a5bf0]"
                      >
                        <FileDown className="size-4" />
                        PDF
                      </BlankDownloadButton>
                    ) : null}
                    {docxCodes.has(info.code) ? (
                      <BlankDownloadButton
                        target={{ kind: "code", code: info.code }}
                        format="docx"
                        title={catalogName.get(info.code) ?? info.tagline}
                        place="blanki"
                        className="inline-flex h-10 items-center gap-1.5 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
                      >
                        <FileText className="size-4 text-[#5566f6]" />
                        DOCX
                      </BlankDownloadButton>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </section>

      <section className="mx-auto max-w-[860px] px-4 pb-12 sm:px-6">
        <h2 className="text-[26px] font-semibold tracking-[-0.02em]">
          Вопросы и ответы
        </h2>
        <div className="mt-6 space-y-3">
          {FAQ.map((item) => (
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

      <section className="mx-auto max-w-[1200px] px-4 pb-16 sm:px-6">
        <div className="rounded-3xl border border-[#5566f6]/20 bg-gradient-to-br from-[#f5f6ff] to-white p-6 sm:p-9">
          <h2 className="max-w-[620px] text-[24px] font-semibold leading-[1.15] tracking-[-0.02em] md:text-[28px]">
            Бумагу потом всё равно придётся переписывать
          </h2>
          <p className="mt-3 max-w-[620px] text-[15px] leading-[1.65] text-[#3c4053]">
            Те же бланки можно вести с телефона: смена отмечается за полминуты,
            температура подтягивается с датчика, а за пропущенный день приходит
            напоминание. Для проверки выгружается PDF за нужный период.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href="/register"
              className="inline-flex h-12 items-center gap-2 rounded-2xl bg-[#5566f6] px-6 text-[15px] font-medium text-white shadow-[0_12px_36px_-12px_rgba(85,102,246,0.65)] transition-colors duration-150 hover:bg-[#4a5bf0]"
            >
              Попробовать бесплатно <ArrowRight className="size-4" />
            </Link>
            <Link
              href="/journals-info"
              className="inline-flex h-12 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-5 text-[15px] font-medium text-[#0b1024] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
            >
              Что внутри каждого журнала
              <ArrowRight className="size-4 text-[#5566f6]" />
            </Link>
          </div>
        </div>
      </section>

      <PublicFooter />
    </div>
  );
}
