import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, FileDown, ScrollText, Sparkles } from "lucide-react";

import { PublicHeader, PublicFooter } from "@/components/public/public-chrome";
import { PublicBreadcrumbs } from "@/components/public/public-breadcrumbs";
import {
  groupedOrderTemplates,
  ORDER_TEMPLATES,
  type OrderTemplate,
} from "@/lib/orders/catalog";
import { jsonLdSafeString } from "@/lib/json-ld";
import {
  DEFAULT_OG_IMAGES,
  DEFAULT_TWITTER_CARD,
  DEFAULT_TWITTER_IMAGES,
} from "@/lib/meta-defaults";

/**
 * Хаб приказов — сестринская страница /blanki, только про другой спрос.
 *
 * Журнал отвечает «что делали», приказ — «кто за это отвечает», и
 * инспектор спрашивает оба. Запросы вида «приказ о назначении
 * ответственного за ХАССП образец» до сих пор вели на чужие сайты с
 * вордовскими файлами сомнительного происхождения.
 *
 * Заголовки разведены с /blanki намеренно («бланки журналов» против
 * «приказы, образцы и бланки»), иначе две страницы конкурировали бы за
 * одну выдачу.
 *
 * PDF отдаёт `/api/orders/<code>/pdf` — пустым бланком для гостя и с
 * подставленными реквизитами организации для залогиненного. Отсюда и
 * связка «скачать бланк» рядом с «заполнить автоматически».
 */

export const dynamic = "force-dynamic";

const CANONICAL = "https://wesetup.ru/prikazy";

// Layout дописывает « — WeSetup»: с суффиксом выходит 48 символов,
// в выдачу помещается целиком.
const TITLE = "Приказы для общепита — образцы и бланки";
const DESCRIPTION =
  "Образцы приказов для кафе, ресторана и пищевого производства: о назначении ответственного за ХАССП, за санитарное состояние, о введении журналов, об утверждении ППК. Скачать бланк PDF бесплатно или заполнить реквизитами автоматически.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  keywords: [
    "приказ о назначении ответственного за ХАССП",
    "приказ образец общепит",
    "скачать приказ",
    "приказ о назначении ответственного за санитарное состояние",
    "приказ о введении журналов производственного контроля",
    "приказ об утверждении программы производственного контроля",
    "бланк приказа для кафе",
  ],
  alternates: { canonical: CANONICAL },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: CANONICAL,
    type: "website",
    locale: "ru_RU",
    siteName: "WeSetup",
    images: [...DEFAULT_OG_IMAGES],
  },
  twitter: {
    card: DEFAULT_TWITTER_CARD,
    title: TITLE,
    description: DESCRIPTION,
    images: [...DEFAULT_TWITTER_IMAGES],
  },
};

const FAQ = [
  {
    q: "Какие приказы обязательны для кафе или ресторана?",
    a: "Минимальный набор — приказ о назначении ответственного за внедрение ХАССП, приказ об ответственном за санитарное состояние, приказ о введении в действие журналов производственного контроля и приказ об утверждении программы производственного контроля. Остальные зависят от формата: суточные пробы нужны тем, кто кормит детей, пациентов и подопечных соцучреждений (в том числе по договору), приказ по дезинфекции — там, где заключён договор со специализированной организацией.",
  },
  {
    q: "Зачем приказ, если журнал и так ведётся?",
    a: "Журнал без приказа — бумага, которую формально никто не обязан вести. Приказ назначает конкретного человека, закрепляет за ним обязанности и делает записи в журнале доказательством выполнения. Именно эту связку проверяет инспектор.",
  },
  {
    q: "Приказ нужно переиздавать?",
    a: "Да, при смене ответственного, руководителя, вида деятельности или требований норматива. Дата и номер приказа должны быть не позже даты первой записи в журнале, который он вводит в действие.",
  },
  {
    q: "Чем скачанный бланк отличается от приказа в сервисе?",
    a: "Бланк — пустая форма с прочерками вместо реквизитов: название, ИНН, адрес, должность и Ф. И. О. руководителя дописываются от руки. В сервисе те же реквизиты подставляются из карточки организации, номер и дата проставляются автоматически, а готовые приказы хранятся вместе с журналами.",
  },
];

/** Ссылка на PDF-бланк конкретного приказа. */
function blankHref(code: string): string {
  return `/api/orders/${code}/pdf`;
}

function OrderCard({ template }: { template: OrderTemplate }) {
  return (
    <article
      id={template.code}
      className="flex scroll-mt-24 flex-col gap-4 p-5 sm:flex-row sm:items-start sm:gap-5 sm:p-6"
    >
      <div className="min-w-0 flex-1">
        <h3 className="text-[15px] font-medium leading-[1.4] text-[#0b1024]">
          Приказ {template.title.charAt(0).toLowerCase() + template.title.slice(1)}
        </h3>
        <p className="mt-1.5 text-[13px] leading-[1.6] text-[#6f7282]">
          {template.purpose}
        </p>
        {template.basis.length > 0 ? (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {template.basis.map((item) => (
              <span
                key={item}
                className="rounded-full bg-[#f5f6ff] px-2.5 py-1 text-[12px] leading-[1.4] text-[#3848c7]"
              >
                {item}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      <div className="flex shrink-0 flex-wrap gap-2">
        <a
          href={blankHref(template.code)}
          className="inline-flex h-10 items-center gap-1.5 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
        >
          <FileDown className="size-4 text-[#5566f6]" />
          Скачать бланк
        </a>
        <Link
          href="/register"
          className="inline-flex h-10 items-center gap-1.5 rounded-2xl bg-[#5566f6] px-4 text-[14px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors duration-150 hover:bg-[#4a5bf0]"
        >
          <Sparkles className="size-4" />С реквизитами
        </Link>
      </div>
    </article>
  );
}

export default function PrikazyHubPage() {
  const groups = groupedOrderTemplates();
  const total = ORDER_TEMPLATES.length;

  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "CollectionPage",
        "@id": `${CANONICAL}#page`,
        name: TITLE,
        description: DESCRIPTION,
        url: CANONICAL,
        inLanguage: "ru-RU",
        isPartOf: { "@id": "https://wesetup.ru/#website" },
      },
      {
        "@type": "ItemList",
        "@id": `${CANONICAL}#orders`,
        name: "Образцы приказов для предприятий общественного питания",
        numberOfItems: total,
        // `url` ведёт на якорь карточки, а не на /api/orders/*/pdf:
        // весь /api закрыт в robots.ts, и посылать туда краулера
        // означало бы давать ссылку в запрещённый раздел.
        itemListElement: ORDER_TEMPLATES.map((template, index) => ({
          "@type": "ListItem",
          position: index + 1,
          url: `${CANONICAL}#${template.code}`,
          item: {
            "@type": "DigitalDocument",
            name: `Приказ ${template.title.charAt(0).toLowerCase() + template.title.slice(1)}`,
            description: template.purpose,
            url: `${CANONICAL}#${template.code}`,
            inLanguage: "ru-RU",
            encodingFormat: "application/pdf",
            isAccessibleForFree: true,
          },
        })),
      },
      {
        "@type": "FAQPage",
        "@id": `${CANONICAL}#faq`,
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
      <PublicHeader />

      <section className="mx-auto max-w-[1200px] px-4 pt-8 sm:px-6">
        <div className="relative overflow-hidden rounded-3xl bg-[#0b1024] px-5 py-12 text-white sm:px-6 sm:py-16 md:px-12 md:py-20">
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute -left-24 -top-24 size-[420px] rounded-full bg-[#5566f6] opacity-40 blur-[120px]" />
            <div className="absolute -bottom-32 -right-32 size-[460px] rounded-full bg-[#7a5cff] opacity-30 blur-[140px]" />
          </div>
          <div className="relative">
            <PublicBreadcrumbs className="mb-5" items={[{ name: "Приказы" }]} />
            <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[12px] font-medium uppercase tracking-[0.18em] text-white/80 backdrop-blur">
              <ScrollText className="size-3.5" />
              Бесплатно и без регистрации
            </div>
            <h1 className="mt-5 max-w-[880px] text-[36px] font-semibold leading-[1.08] tracking-[-0.02em] md:text-[48px]">
              Приказы для общепита
            </h1>
            <p className="mt-4 max-w-[720px] text-[16px] leading-[1.65] text-white/80 md:text-[18px]">
              {total} образцов приказов с нормативным основанием: скачайте
              пустой бланк в PDF и заполните от руки — или зарегистрируйтесь, и
              реквизиты организации подставятся сами.
            </p>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[860px] px-4 py-10 sm:px-6 sm:py-14">
        <h2 className="text-[26px] font-semibold tracking-[-0.02em]">
          Зачем предприятию питания приказы
        </h2>
        <div className="mt-4 space-y-4 text-[15px] leading-[1.7] text-[#3c4053]">
          <p>
            Журнал отвечает на вопрос «что делали», приказ — «кто за это
            отвечает». Проверка смотрит обе стороны: журнал уборки без приказа о
            назначении ответственного за санитарное состояние формально ничего
            не подтверждает, потому что не назначен человек, обязанный его
            вести.
          </p>
          <p>
            Приказ — это внутренний документ организации. Он называет
            конкретного сотрудника, перечисляет его обязанности, ссылается на
            норматив, по которому обязанность возникла, и вводит документ или
            порядок в действие с конкретной даты. Дата и номер приказа должны
            быть не позже первой записи в журнале, который он вводит.
          </p>
          <p>
            Переиздавать приказ нужно при смене ответственного или
            руководителя, при изменении вида деятельности и при обновлении
            требований. Именно поэтому шаблон удобнее готового скана: реквизиты
            меняются чаще, чем текст.
          </p>
        </div>

        <div className="mt-6 rounded-3xl border border-[#5566f6]/20 bg-[#f5f6ff] p-5 sm:p-6">
          <div className="text-[15px] font-medium text-[#0b1024]">
            Реквизиты подставляются автоматически
          </div>
          <p className="mt-2 text-[14px] leading-[1.65] text-[#3c4053]">
            В аккаунте WeSetup название с организационно-правовой формой, ИНН,
            юридический адрес, должность и Ф. И. О. руководителя уже хранятся в
            карточке организации. Приказ печатается сразу заполненным: остаётся
            выбрать ответственного и подписать. Гостю тот же файл отдаётся
            пустым бланком — с прочерками вместо реквизитов.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-[1200px] px-4 pb-10 sm:px-6 sm:pb-14">
        {groups.map((group) => (
          <div key={group.category} className="mb-12 last:mb-0">
            <div className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 className="text-[22px] font-semibold tracking-[-0.02em]">
                {group.label}
              </h2>
              <span className="text-[13px] tabular-nums text-[#9b9fb3]">
                {group.items.length}
              </span>
            </div>

            <div className="overflow-hidden rounded-3xl border border-[#ececf4] bg-white shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
              {group.items.map((template, index) => (
                <div
                  key={template.code}
                  className={index > 0 ? "border-t border-[#ececf4]" : undefined}
                >
                  <OrderCard template={template} />
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
            Приказы и журналы — в одном месте
          </h2>
          <p className="mt-3 max-w-[620px] text-[15px] leading-[1.65] text-[#3c4053]">
            Зарегистрируйтесь, заполните карточку организации один раз — и
            каждый приказ печатается с готовыми реквизитами, номером и датой.
            Рядом лежат журналы, которые эти приказы вводят в действие.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href="/register"
              className="inline-flex h-12 items-center gap-2 rounded-2xl bg-[#5566f6] px-6 text-[15px] font-medium text-white shadow-[0_12px_36px_-12px_rgba(85,102,246,0.65)] transition-colors duration-150 hover:bg-[#4a5bf0]"
            >
              Попробовать бесплатно <ArrowRight className="size-4" />
            </Link>
            <Link
              href="/blanki"
              className="inline-flex h-12 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-5 text-[15px] font-medium text-[#0b1024] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
            >
              Бланки журналов
              <ArrowRight className="size-4 text-[#5566f6]" />
            </Link>
          </div>
        </div>
      </section>

      <PublicFooter />
    </div>
  );
}
