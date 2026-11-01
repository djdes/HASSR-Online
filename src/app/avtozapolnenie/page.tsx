import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  CalendarDays,
  Camera,
  FileSpreadsheet,
  FileText,
  Hand,
  Tag,
  Thermometer,
  Truck,
  type LucideIcon,
} from "lucide-react";

import { HeroEmailStart } from "@/components/landing/hero-email-start";
import { DemoRequestButton } from "@/components/public/demo-request-button";
import { PublicFooter, PublicHeader } from "@/components/public/public-chrome";
import { AUTOFILL_VIDEO } from "@/lib/autofill-offer";
import { jsonLdSafeString } from "@/lib/json-ld";
import { TRIAL_DAYS } from "@/lib/tariff-plans";

const PAGE_URL = "https://wesetup.ru/avtozapolnenie";
const TITLE = "Журналы, которые заполняются сами — WeSetup";
const DESCRIPTION =
  "Температура приходит с датчиков, приёмка — из накладных iiko, Диадока и СБИС, ветдокументы — из «Меркурия», показания — с фото табло. Сотрудник подтверждает факт, а не переписывает цифры.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: PAGE_URL },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: PAGE_URL,
    type: "website",
    images: [{ url: `https://wesetup.ru${AUTOFILL_VIDEO.poster}`, width: 1920, height: 1080 }],
  },
};

/**
 * Оффер «журналы заполняются сами» (2026-11-01). Главное отличие WeSetup —
 * данные приходят из приборов, учётных систем и документов, а не
 * переписываются руками. Каждое обещание страницы — из кода
 * (`.agent/tasks/growth-stage2-2026-11/spec.md`, AC6); тест
 * `autofill-page.test.ts` сверяет их. Чего не автоматизируем — пишем прямо:
 * температура продукта, органолептика, допуск к работе и подпись остаются
 * за человеком.
 */

type Source = { icon: LucideIcon; title: string; body: string; premium?: boolean };

const SOURCES: Source[] = [
  {
    icon: Thermometer,
    title: "Датчики в холодильниках",
    body: "Wi-Fi датчики раз в час записывают температуру и влажность в журнал. Вышла за норму — руководитель точки получает тревогу.",
    premium: true,
  },
  {
    icon: Truck,
    title: "Накладные iiko, Диадока и СБИС",
    body: "Приходная накладная становится строками журнала приёмки: что, от кого, сколько, по какому документу и «годен до», если поставщик его передал.",
  },
  {
    icon: FileText,
    title: "«Меркурий»",
    body: "Ветеринарные документы приходят сами, строка входного контроля заполняется из ВСД. Гасит документ человек — после настоящей приёмки.",
    premium: true,
  },
  {
    icon: Camera,
    title: "Фото табло",
    body: "Сфотографировали дисплей термометра или холодильника — показание встаёт в журнал. Переписывать цифры не нужно.",
    premium: true,
  },
  {
    icon: Tag,
    title: "Этикетки и сроки",
    body: "Этикетки из «Сетап помощника» попадают в журнал маркировки — видно, у чего сегодня истекает срок.",
  },
  {
    icon: CalendarDays,
    title: "График смен",
    body: "Выходные, отпуска и больничные из графика сами проставляются в гигиеническом журнале — пустые клетки не путают проверяющего.",
  },
  {
    icon: FileSpreadsheet,
    title: "Журналы на новый месяц",
    body: "Документы на следующий месяц создаются сами — с сотрудниками, помещениями и оборудованием. Утром в первый день всё уже готово.",
  },
];

const HUMAN_PART = [
  "Температура продукта на приёмке, упаковка и решение «принять или вернуть»",
  "Органолептика и бракераж готовой продукции",
  "Допуск сотрудника к работе в журнале здоровья",
  "Подпись ответственного",
];

function videoJsonLd(): string {
  return jsonLdSafeString({
    "@context": "https://schema.org",
    "@type": "VideoObject",
    name: "Журналы, которые заполняются сами",
    description: DESCRIPTION,
    thumbnailUrl: [`https://wesetup.ru${AUTOFILL_VIDEO.poster}`],
    uploadDate: AUTOFILL_VIDEO.uploadDate,
    duration: AUTOFILL_VIDEO.durationIso,
    contentUrl: `https://wesetup.ru${AUTOFILL_VIDEO.src}`,
    inLanguage: "ru",
  });
}

export default function AutofillPage() {
  return (
    <div className="min-h-screen bg-white text-[#0b1024]">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: videoJsonLd() }} />
      <PublicHeader />

      <section className="mx-auto max-w-[1200px] px-4 sm:px-6">
        <div className="overflow-hidden rounded-3xl bg-gradient-to-br from-[#0b1024] via-[#1a234a] to-[#3848c7] px-5 py-10 text-white sm:px-10 sm:py-14">
          <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
            <div>
              <span className="inline-flex items-center rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[12px] uppercase tracking-[0.18em] text-white/80">
                Автозаполнение
              </span>
              <h1 className="mt-5 text-[clamp(2rem,2.4vw+1.4rem,3.25rem)] font-semibold leading-[1.08] tracking-[-0.02em]">
                Журналы, которые заполняются сами
              </h1>
              <p className="mt-5 max-w-[560px] text-[16px] leading-[1.6] text-white/80 md:text-[18px]">
                Температура приходит с датчиков, приёмка — из накладных, ветдокументы — из «Меркурия». Сотрудник
                подтверждает факт, а не переписывает цифры смену за сменой.
              </p>
              <div className="mt-7 max-w-[520px]">
                <HeroEmailStart place="autofill" tone="dark" align="start" />
              </div>
              <div className="mt-4">
                <DemoRequestButton place="autofill" variant="onDark" />
              </div>
            </div>
            <div className="overflow-hidden rounded-2xl border border-white/10 bg-black/30 shadow-[0_30px_80px_-30px_rgba(0,0,0,0.6)]">
              {/* Без автозапуска: ролик тяжелее страницы, грузим по нажатию. */}
              <video
                className="block aspect-video w-full"
                controls
                playsInline
                preload="none"
                poster={AUTOFILL_VIDEO.poster}
                data-testid="autofill-video"
              >
                <source src={AUTOFILL_VIDEO.src} type="video/mp4" />
                <track kind="captions" srcLang="ru" label="Русские субтитры" src={AUTOFILL_VIDEO.captions} default />
              </video>
            </div>
          </div>
        </div>
      </section>

      <main className="mx-auto max-w-[1200px] space-y-14 px-4 py-14 sm:px-6">
        <section>
          <h2 className="text-[clamp(1.5rem,1.8vw+1rem,2.25rem)] font-semibold tracking-[-0.02em]">Откуда берутся записи</h2>
          <p className="mt-2 max-w-[680px] text-[15px] leading-[1.6] text-[#3c4053]">
            Только из того, что уже знает прибор, учётная система или документ. Типовых цифр «для галочки» WeSetup
            не подставляет.
          </p>
          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="autofill-sources">
            {SOURCES.map(({ icon: Icon, title, body, premium }) => (
              <article key={title} className="flex flex-col rounded-3xl border border-[#ececf4] bg-white p-5 sm:p-6">
                <div className="flex items-start justify-between gap-3">
                  <span className="flex size-11 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#3848c7]">
                    <Icon className="size-5" aria-hidden />
                  </span>
                  {premium ? (
                    <span className="rounded-full bg-[#f5f6ff] px-2.5 py-1 text-[12px] font-medium text-[#3848c7]">Премиум</span>
                  ) : null}
                </div>
                <h3 className="mt-4 text-[17px] font-semibold tracking-[-0.01em]">{title}</h3>
                <p className="mt-2 text-[15px] leading-[1.6] text-[#3c4053]">{body}</p>
              </article>
            ))}
          </div>
          <p className="mt-4 text-[13px] leading-[1.6] text-[#6f7282]">
            Датчики, автоввод с фото и «Меркурий» — возможности тарифа «Премиум»; первые {TRIAL_DAYS} дней после
            регистрации они работают бесплатно. <Link href="/pricing" className="text-[#3848c7] underline underline-offset-2">Тарифы</Link>
          </p>
        </section>

        <section className="grid gap-6 rounded-3xl border border-[#ececf4] bg-[#fafbff] p-6 sm:p-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div>
            <span className="flex size-11 items-center justify-center rounded-2xl bg-white text-[#3848c7] ring-1 ring-[#ececf4]">
              <Hand className="size-5" aria-hidden />
            </span>
            <h2 className="mt-4 text-[22px] font-semibold tracking-[-0.02em]">Что остаётся человеку</h2>
            <p className="mt-2 text-[15px] leading-[1.6] text-[#3c4053]">
              Смысл журнала в том, что живой сотрудник видел продукт и отвечает за решение. Это мы честно оставляем
              людям — а всё остальное забираем на себя.
            </p>
          </div>
          <ul className="space-y-2.5">
            {HUMAN_PART.map((item) => (
              <li key={item} className="flex gap-3 rounded-2xl bg-white px-4 py-3 text-[15px] leading-[1.5] text-[#0b1024] ring-1 ring-[#ececf4]">
                <span className="mt-2 size-1.5 shrink-0 rounded-full bg-[#5566f6]" aria-hidden />
                {item}
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-3xl bg-[#0b1024] p-8 text-white md:p-10">
          <h2 className="text-[clamp(1.5rem,1.6vw+1rem,2rem)] font-semibold tracking-[-0.02em]">Посмотрите на своём заведении</h2>
          <p className="mt-2 max-w-[560px] text-[15px] leading-relaxed text-white/70">
            {TRIAL_DAYS} дней бесплатно, все возможности включены, карта не нужна. Или покажем за 15 минут: подключим
            датчик или накладные на вашем примере.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Link
              href="/register"
              className="inline-flex h-12 items-center gap-2 rounded-2xl bg-white px-6 text-[15px] font-medium text-[#0b1024] transition-colors hover:bg-white/90"
            >
              Начать бесплатно <ArrowRight className="size-4" />
            </Link>
            <DemoRequestButton place="autofill:bottom" variant="onDark" />
          </div>
        </section>
      </main>
      <PublicFooter />
    </div>
  );
}
