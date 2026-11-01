import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, BookOpenCheck, ClipboardCheck, FileDown, ScrollText } from "lucide-react";

import { DemoRequestButton } from "@/components/public/demo-request-button";
import { PublicFooter, PublicHeader } from "@/components/public/public-chrome";
import { JOURNAL_INFO } from "@/content/journal-info";
import { loadMessages } from "@/i18n/messages";
import { jsonLdSafeString } from "@/lib/json-ld";
import { TRIAL_DAYS } from "@/lib/tariff-plans";

const PAGE_URL = "https://wesetup.ru/sanpin-2-3-2-4-4282-26";
const SANPIN_CODE = "СанПиН 2.3/2.4.4282-26";

export const metadata: Metadata = {
  title: "СанПиН 2.3/2.4.4282-26 для общепита: журналы и требования — WeSetup",
  description:
    "СанПиН 2.3/2.4.4282-26 действует с 1 сентября 2026 года и заменил 3590-20. Какие журналы по нему ведут, можно ли вести их электронно, где взять печатные формы.",
  alternates: { canonical: PAGE_URL },
};

/**
 * Страница про СанПиН 2.3/2.4.4282-26 (2026-11-01). Только то, что уже
 * написано в репозитории и проверено владельцем: глоссарий (дата и замена
 * 3590-20), /blanki (условия электронной формы), основания журналов в
 * `journal-info.ts`. Тест `sanpin-page.test.ts` сверяет обещания с ними.
 */

const FAQ = [
  {
    q: "С какого числа действует СанПиН 2.3/2.4.4282-26?",
    a: "С 1 сентября 2026 года. Он заменил СанПиН 2.3/2.4.3590-20, который действовал с 2021 года.",
  },
  {
    q: "Чем он отличается от СанПиН 2.3/2.4.3590-20?",
    a: "Нумерация другая, суть требований та же: гигиена персонала, бракераж, температурные режимы, уборка и дезинфекция.",
  },
  {
    q: "Можно вести журналы в электронном виде?",
    a: "Да. СанПиН перечисляет, какие сведения фиксировать, но не способ. Электронная форма допустима, если видно, кто внёс запись, и её нельзя незаметно изменить задним числом.",
  },
  {
    q: "Где взять печатные формы журналов?",
    a: "Пустые формы всех журналов для печати — на wesetup.ru/blanki, регистрация не нужна. В сервисе те же поля заполняются с телефона.",
  },
];

export default async function SanpinPage() {
  const messages = await loadMessages("ru");
  const journals = Object.values(JOURNAL_INFO)
    .filter((journal) => journal.normative.some((item) => item.title.includes("4282-26")))
    .map((journal) => ({
      code: journal.code,
      name: messages.journals.names[journal.code as keyof typeof messages.journals.names] ?? journal.code,
      tagline: journal.tagline,
      pointer: journal.normative.find((item) => item.title.includes("4282-26"))?.pointer || "",
      appendix: journal.normative.find((item) => item.title.includes("4282-26"))?.title.startsWith("Приложение") ?? false,
    }));

  const faqJsonLd = jsonLdSafeString({
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQ.map((item) => ({ "@type": "Question", name: item.q, acceptedAnswer: { "@type": "Answer", text: item.a } })),
  });

  return (
    <div className="min-h-screen bg-white text-[#0b1024]">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: faqJsonLd }} />
      <PublicHeader />
      <main className="mx-auto max-w-[1000px] space-y-12 px-4 py-12 sm:px-6">
        <header className="max-w-[780px]">
          <span className="inline-flex items-center gap-2 rounded-full bg-[#eef1ff] px-3 py-1 text-[12px] font-semibold uppercase tracking-[0.16em] text-[#3848c7]">
            <ScrollText className="size-3.5" aria-hidden />
            Норматив
          </span>
          <h1 className="mt-4 text-[clamp(2rem,2vw+1.5rem,2.75rem)] font-semibold leading-[1.1] tracking-[-0.02em]">
            {SANPIN_CODE}: что нужно знать общепиту
          </h1>
          <p className="mt-3 text-[16px] leading-[1.6] text-[#3c4053]">
            Действующие с 1 сентября 2026 года санитарные правила для общепита. Заменили СанПиН 2.3/2.4.3590-20:
            нумерация другая, требования те же.
          </p>
        </header>

        <section className="grid gap-4 md:grid-cols-2">
          <article className="rounded-3xl border border-[#ececf4] bg-white p-6">
            <h2 className="text-[20px] font-semibold tracking-[-0.01em]">Что это за документ</h2>
            <p className="mt-2 text-[15px] leading-[1.6] text-[#3c4053]">
              Основной санитарный документ для кафе, ресторанов, столовых и пищевых производств: гигиена персонала,
              бракераж, температурные режимы, уборка и дезинфекция. Он перечисляет, какие сведения фиксируются в журналах.
            </p>
          </article>
          <article className="rounded-3xl border border-[#ececf4] bg-white p-6">
            <h2 className="text-[20px] font-semibold tracking-[-0.01em]">Можно ли вести журналы электронно</h2>
            <p className="mt-2 text-[15px] leading-[1.6] text-[#3c4053]">
              Да. СанПиН задаёт, что фиксировать, но не способ. Электронная форма допустима, если видно, кто внёс запись,
              и её нельзя незаметно изменить задним числом. В WeSetup у каждой записи есть автор и время, а правки видны
              в журнале действий.
            </p>
          </article>
        </section>

        <section>
          <h2 className="text-[clamp(1.5rem,1.6vw+1rem,2rem)] font-semibold tracking-[-0.02em]">Какие журналы ведут по этому СанПиН</h2>
          <p className="mt-2 max-w-[700px] text-[15px] leading-[1.6] text-[#3c4053]">
            Журналы каталога WeSetup, у которых основание — {SANPIN_CODE}. Состав для вашего заведения зависит от
            сферы и оборудования.
          </p>
          <ul className="mt-5 grid gap-3 sm:grid-cols-2" data-testid="sanpin-journals">
            {journals.map((journal) => (
              <li key={journal.code}>
                <Link
                  href={`/journals-info/${journal.code}`}
                  className="flex h-full items-start gap-3 rounded-2xl border border-[#ececf4] bg-white p-4 transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
                >
                  <BookOpenCheck className="mt-0.5 size-5 shrink-0 text-[#5566f6]" aria-hidden />
                  <span className="min-w-0">
                    <span className="block text-[15px] font-semibold text-[#0b1024]">{journal.name}</span>
                    <span className="mt-0.5 block text-[13.5px] leading-[1.5] text-[#6f7282]">{journal.tagline}</span>
                    {journal.pointer || journal.appendix ? (
                      <span className="mt-1 block text-[12px] text-[#9b9fb3]">
                        {journal.appendix ? "Форма — в приложении к СанПиН" : journal.pointer}
                      </span>
                    ) : null}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-3xl border border-[#ececf4] bg-[#fafbff] p-6" data-testid="sanpin-inspection">
          <h2 className="flex items-center gap-2 text-[20px] font-semibold tracking-[-0.01em]">
            <ClipboardCheck className="size-5 text-[#5566f6]" aria-hidden />
            Если пришла проверка
          </h2>
          <p className="mt-2 max-w-[760px] text-[15px] leading-[1.6] text-[#3c4053]">
            В разделе «Пришла проверка» журналы за нужный период собираются одной кнопкой — архивом или одним PDF с
            содержанием: журналы, программа производственного контроля и ХАССП-план, журнал посещений проверяющих, CAPA.
          </p>
        </section>

        <section className="grid gap-3 sm:grid-cols-3">
          <Link href="/blanki" className="flex items-center gap-3 rounded-2xl border border-[#ececf4] bg-[#fafbff] p-4 text-[15px] font-medium hover:border-[#5566f6]/40">
            <FileDown className="size-5 text-[#5566f6]" aria-hidden />
            Печатные формы журналов
          </Link>
          <Link href="/prikazy" className="flex items-center gap-3 rounded-2xl border border-[#ececf4] bg-[#fafbff] p-4 text-[15px] font-medium hover:border-[#5566f6]/40">
            <ScrollText className="size-5 text-[#5566f6]" aria-hidden />
            Приказы для общепита
          </Link>
          <Link href="/elektronnyy-zhurnal-sanpin" className="flex items-center gap-3 rounded-2xl border border-[#ececf4] bg-[#fafbff] p-4 text-[15px] font-medium hover:border-[#5566f6]/40">
            <BookOpenCheck className="size-5 text-[#5566f6]" aria-hidden />
            Электронный журнал
          </Link>
        </section>

        <section className="max-w-[820px]">
          <h2 className="text-[clamp(1.5rem,1.6vw+1rem,2rem)] font-semibold tracking-[-0.02em]">Вопросы и ответы</h2>
          <div className="mt-5 space-y-3">
            {FAQ.map((item) => (
              <details key={item.q} className="group rounded-2xl border border-[#ececf4] bg-white p-5 open:bg-[#fafbff]">
                <summary className="cursor-pointer list-none text-[15px] font-medium text-[#0b1024] group-hover:text-[#5566f6]">{item.q}</summary>
                <p className="mt-3 text-[15px] leading-[1.65] text-[#3c4053]">{item.a}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="rounded-3xl bg-[#0b1024] p-8 text-white md:p-10">
          <h2 className="text-[24px] font-semibold tracking-[-0.02em]">Все журналы по СанПиН — в одном кабинете</h2>
          <p className="mt-2 max-w-[560px] text-[15px] leading-relaxed text-white/70">
            {TRIAL_DAYS} дней бесплатно, карта не нужна. Или покажем за 15 минут на примере вашего заведения.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Link
              href="/register"
              className="inline-flex h-12 items-center gap-2 rounded-2xl bg-white px-6 text-[15px] font-medium text-[#0b1024] transition-colors hover:bg-white/90"
            >
              Начать бесплатно <ArrowRight className="size-4" />
            </Link>
            <DemoRequestButton place="sanpin" variant="onDark" />
          </div>
        </section>
      </main>
      <PublicFooter />
    </div>
  );
}
