import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, BookOpenCheck, Calculator, ScrollText, Sparkles } from "lucide-react";

import { PublicBreadcrumbs } from "@/components/public/public-breadcrumbs";
import { PublicFooter, PublicHeader } from "@/components/public/public-chrome";
import { jsonLdSafeString } from "@/lib/json-ld";
import { DEFAULT_TWITTER_CARD } from "@/lib/meta-defaults";
import { ogImages, twitterImages } from "@/lib/og-image";

import { FinesCalculator } from "./fines-calculator";

const PAGE_URL = "https://wesetup.ru/calc/fines";
const TITLE = "Калькулятор штрафов Роспотребнадзора для общепита";
const DESCRIPTION =
  "Калькулятор штрафов Роспотребнадзора для общепита: статьи 6.3, 6.6 и 14.43 КоАП с суммами для ИП, юрлиц и должностных лиц. Отметьте нарушения и увидите диапазон.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  keywords: [
    "штрафы Роспотребнадзора общепит 2026",
    "штраф за отсутствие ХАССП",
    "статья 6.6 КоАП РФ штраф кафе",
    "статья 14.43 КоАП РФ общепит",
    "калькулятор штрафов СанПиН",
  ],
  alternates: { canonical: PAGE_URL },
  openGraph: {
    type: "website",
    locale: "ru_RU",
    siteName: "WeSetup",
    url: PAGE_URL,
    title: TITLE,
    description: DESCRIPTION,
    images: ogImages({ title: TITLE, subtitle: DESCRIPTION, kind: "calc" }),
  },
  twitter: {
    card: DEFAULT_TWITTER_CARD,
    title: TITLE,
    description: DESCRIPTION,
    images: twitterImages({ title: TITLE, kind: "calc" }),
  },
};

const FAQ = [
  {
    q: "По каким статьям КоАП РФ чаще всего штрафуют кафе и рестораны?",
    a: "На практике проверяющие применяют три основные статьи: ст. 6.6 КоАП РФ — за нарушение санитарно-эпидемиологических требований к организации питания, ст. 6.3 КоАП РФ — за нарушения общих санитарных правил и медосмотров, и ст. 14.43 КоАП РФ — за нарушение требований технических регламентов ТР ТС 021/2011 (включая процедуры ХАССП, маркировку и условия хранения).",
  },
  {
    q: "Суммируются ли штрафы по разным статьям при одной проверке?",
    a: "Если выявленные нарушения образуют составы разных статей КоАП РФ (например, отсутствие процедур по ТР ТС 021/2011 по ст. 14.43 и допуск сотрудника без медосмотра по ст. 6.3), постановления могут выноситься отдельно. При однородных нарушениях в рамках одного состава применяется ч. 2 и ч. 5 ст. 4.4 КоАП РФ.",
  },
  {
    q: "Почему ИП и малым предприятиям важно различать категории в калькуляторе?",
    a: "По ряду статей санкции для ИП ниже, чем для юридических лиц, а согласно ст. 4.1.2 КоАП РФ социально ориентированные НКО и субъекты малого и среднего предпринимательства могут рассчитывать на назначение штрафа в размере, предусмотренном для ИП.",
  },
  {
    q: "Как снизить риск замечаний по журналам до визита инспектора?",
    a: "Закрепите перечень журналов приказом, назначьте ответственных по сменам и исключите пустые дни: в WeSetup напоминания приходят в Telegram, пропуски видны руководителю на сводке дня, а к проверке весь пакет выгружается одним PDF.",
  },
];

export default function FinesCalcPage() {
  const jsonLd = jsonLdSafeString({
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebApplication",
        "@id": `${PAGE_URL}#app`,
        name: TITLE,
        description: DESCRIPTION,
        url: PAGE_URL,
        applicationCategory: "BusinessApplication",
        operatingSystem: "All",
        inLanguage: "ru-RU",
        offers: {
          "@type": "Offer",
          price: "0",
          priceCurrency: "RUB",
        },
      },
      {
        "@type": "FAQPage",
        "@id": `${PAGE_URL}#faq`,
        mainEntity: FAQ.map((item) => ({
          "@type": "Question",
          name: item.q,
          acceptedAnswer: { "@type": "Answer", text: item.a },
        })),
      },
    ],
  });

  return (
    <div className="min-h-screen bg-white text-[#0b1024]">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd }} />
      <PublicHeader />
      <div className="mx-auto max-w-[1000px] px-4 py-8 sm:px-6 sm:py-12">
        <PublicBreadcrumbs items={[{ name: "Калькуляторы", href: "/calc/journals" }, { name: "Штрафы" }]} tone="light" />
        <h1 className="mt-6 text-[32px] font-semibold leading-tight tracking-[-0.02em] sm:text-[44px]">{TITLE}</h1>
        <p className="mt-3 max-w-[760px] text-[16px] leading-[1.7] text-[#3c4053]">{DESCRIPTION}</p>
        <FinesCalculator />
        <p className="mt-6 text-[12.5px] leading-relaxed text-[#9b9fb3]">
          Суммы по КоАП РФ в редакции на 2026 год, для справки. Размер конкретного штрафа определяет инспектор и суд; повторные нарушения и вред здоровью увеличивают санкции. Проверяйте актуальную редакцию статей.
        </p>

        <section className="mt-14 max-w-[820px]">
          <h2 className="text-[24px] font-semibold tracking-[-0.02em]">Частые вопросы о проверках и статьях КоАП РФ</h2>
          <div className="mt-5 space-y-3">
            {FAQ.map((item) => (
              <details key={item.q} className="group rounded-2xl border border-[#ececf4] bg-white p-5 open:bg-[#fafbff]">
                <summary className="cursor-pointer list-none text-[15px] font-medium text-[#0b1024] group-hover:text-[#5566f6]">
                  {item.q}
                </summary>
                <p className="mt-3 text-[15px] leading-[1.65] text-[#3c4053]">{item.a}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Link href="/calc/journals" className="flex items-center justify-between gap-2 rounded-2xl border border-[#ececf4] bg-[#fafbff] p-4 text-[14px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40">
            <span className="flex items-center gap-2.5"><Calculator className="size-4 shrink-0 text-[#5566f6]" />Какие журналы нужны</span>
            <ArrowRight className="size-4 shrink-0 text-[#9b9fb3]" />
          </Link>
          <Link href="/sanpin-2-3-2-4-4282-26" className="flex items-center justify-between gap-2 rounded-2xl border border-[#ececf4] bg-[#fafbff] p-4 text-[14px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40">
            <span className="flex items-center gap-2.5"><BookOpenCheck className="size-4 shrink-0 text-[#5566f6]" />СанПиН 2.3/2.4.4282-26</span>
            <ArrowRight className="size-4 shrink-0 text-[#9b9fb3]" />
          </Link>
          <Link href="/prikazy" className="flex items-center justify-between gap-2 rounded-2xl border border-[#ececf4] bg-[#fafbff] p-4 text-[14px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40">
            <span className="flex items-center gap-2.5"><ScrollText className="size-4 shrink-0 text-[#5566f6]" />Образцы приказов</span>
            <ArrowRight className="size-4 shrink-0 text-[#9b9fb3]" />
          </Link>
          <Link href="/avtozapolnenie" className="flex items-center justify-between gap-2 rounded-2xl border border-[#ececf4] bg-[#fafbff] p-4 text-[14px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40">
            <span className="flex items-center gap-2.5"><Sparkles className="size-4 shrink-0 text-[#5566f6]" />Автозаполнение</span>
            <ArrowRight className="size-4 shrink-0 text-[#9b9fb3]" />
          </Link>
        </section>
      </div>
      <PublicFooter />
    </div>
  );
}
