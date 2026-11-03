import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, BookOpenCheck, Calculator, FileDown, ScrollText } from "lucide-react";

import { PublicBreadcrumbs } from "@/components/public/public-breadcrumbs";
import { PublicFooter, PublicHeader } from "@/components/public/public-chrome";
import { JOURNAL_INFO } from "@/content/journal-info";
import { ACTIVE_JOURNAL_CATALOG } from "@/lib/journal-catalog";
import { jsonLdSafeString } from "@/lib/json-ld";
import { DEFAULT_TWITTER_CARD } from "@/lib/meta-defaults";
import { ogImages, twitterImages } from "@/lib/og-image";

import { JournalsCalculator } from "./journals-calculator";

const PAGE_URL = "https://wesetup.ru/calc/journals";
const TITLE = "Какие журналы нужны моему заведению";
const DESCRIPTION =
  "Калькулятор обязательных журналов СанПиН и ХАССП: выберите тип заведения и особенности — получите список журналов со ссылками на формы.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  keywords: [
    "какие журналы нужны для кафе",
    "список обязательных журналов СанПиН для общепита",
    "перечень журналов ХАССП для ресторана",
    "калькулятор журналов общепита",
    "СанПиН 2.3/2.4.4282-26 журналы",
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
    q: "От чего зависит точный список журналов для кафе или ресторана?",
    a: "Базовый перечень по СанПиН 2.3/2.4.4282-26 и ТР ТС 021/2011 включает гигиенический журнал сотрудников, температурный контроль холодильников и складов, входной контроль сырья, бракераж готовой продукции и график уборок. Дополнительные журналы добавляются по процессам: фритюр — учёт фритюрных жиров, бактерицидные облучатели — учёт работы УФ-ламп, детское и лечебное питание — суточные пробы и витаминизация.",
  },
  {
    q: "Обязательно ли вести все 45 журналов из каталога?",
    a: "Нет. Ведут только те журналы, которые соответствуют реальным процессам вашей точки и закреплены в программе производственного контроля (ППК) и приказе руководителя. Лишние пустые журналы при проверке вызывают не меньше вопросов, чем отсутствующие.",
  },
  {
    q: "Разрешено ли вести выбранные журналы в электронном виде?",
    a: "Да. СанПиН 2.3/2.4.4282-26 определяет состав фиксируемых сведений, а электронная форма допустима, если у каждой записи видны автор и время внесения и исключена незаметная правка задним числом.",
  },
  {
    q: "Где скачать печатные формы и приказы о введении журналов?",
    a: "Готовые печатные формы в PDF и Word доступны в разделе «Печатные формы журналов» (/blanki), а приказы о назначении ответственных и введении журналов — в разделе «Приказы для общепита» (/prikazy).",
  },
];

export default function JournalsCalcPage() {
  const names: Record<string, string> = {};
  for (const j of ACTIVE_JOURNAL_CATALOG) names[j.code] = j.name;
  for (const code of Object.keys(JOURNAL_INFO)) if (!names[code]) names[code] = JOURNAL_INFO[code].tagline;

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
        <PublicBreadcrumbs items={[{ name: "Калькуляторы", href: "/calc/journals" }, { name: "Какие журналы нужны" }]} tone="light" />
        <h1 className="mt-6 text-[32px] font-semibold leading-tight tracking-[-0.02em] sm:text-[44px]">{TITLE}</h1>
        <p className="mt-3 max-w-[720px] text-[16px] leading-[1.7] text-[#3c4053]">
          {DESCRIPTION} Список ориентировочный: точный состав закрепляется в программе производственного контроля.
        </p>
        <JournalsCalculator names={names} />

        <section className="mt-14 max-w-[820px]">
          <h2 className="text-[24px] font-semibold tracking-[-0.02em]">Частые вопросы о перечне журналов</h2>
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
          <Link href="/sanpin-2-3-2-4-4282-26" className="flex items-center justify-between gap-2 rounded-2xl border border-[#ececf4] bg-[#fafbff] p-4 text-[14px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40">
            <span className="flex items-center gap-2.5"><BookOpenCheck className="size-4 shrink-0 text-[#5566f6]" />СанПиН 2.3/2.4.4282-26</span>
            <ArrowRight className="size-4 shrink-0 text-[#9b9fb3]" />
          </Link>
          <Link href="/blanki" className="flex items-center justify-between gap-2 rounded-2xl border border-[#ececf4] bg-[#fafbff] p-4 text-[14px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40">
            <span className="flex items-center gap-2.5"><FileDown className="size-4 shrink-0 text-[#5566f6]" />Печатные формы PDF</span>
            <ArrowRight className="size-4 shrink-0 text-[#9b9fb3]" />
          </Link>
          <Link href="/prikazy" className="flex items-center justify-between gap-2 rounded-2xl border border-[#ececf4] bg-[#fafbff] p-4 text-[14px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40">
            <span className="flex items-center gap-2.5"><ScrollText className="size-4 shrink-0 text-[#5566f6]" />Образцы приказов</span>
            <ArrowRight className="size-4 shrink-0 text-[#9b9fb3]" />
          </Link>
          <Link href="/calc/fines" className="flex items-center justify-between gap-2 rounded-2xl border border-[#ececf4] bg-[#fafbff] p-4 text-[14px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40">
            <span className="flex items-center gap-2.5"><Calculator className="size-4 shrink-0 text-[#5566f6]" />Калькулятор штрафов</span>
            <ArrowRight className="size-4 shrink-0 text-[#9b9fb3]" />
          </Link>
        </section>
      </div>
      <PublicFooter />
    </div>
  );
}
