import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  BadgeCheck,
  CalendarClock,
  ClipboardCheck,
  MessageSquareText,
  Phone,
} from "lucide-react";

import { PublicHeader, PublicFooter } from "@/components/public/public-chrome";
import { PublicBreadcrumbs } from "@/components/public/public-breadcrumbs";
import {
  readActiveServices,
  groupServices,
  formatServicePrice,
  isInstantPayable,
  type PlatformServiceItem,
} from "@/lib/services/catalog";
import { jsonLdSafeString } from "@/lib/json-ld";
import {
  DEFAULT_OG_IMAGES,
  DEFAULT_TWITTER_CARD,
  DEFAULT_TWITTER_IMAGES,
} from "@/lib/meta-defaults";
import { TRIAL_DAYS } from "@/lib/tariff-plans";
import { ServiceRequestForm } from "./service-request-form";

/**
 * Витрина платных услуг.
 *
 * Зачем страница. Сервис закрывает «вести журналы», но не закрывает
 * «разобраться, что именно вам обязательно» и «пройти проверку». Эти
 * вопросы приходят в поддержку каждую неделю, и до сих пор ответом было
 * письмо руками. Здесь тот же спрос выражен ценой и кнопкой.
 *
 * Цены живут в БД (`PlatformService`) и правятся ROOT'ом без деплоя,
 * поэтому `force-dynamic`: ISR отдавал бы старый прайс после правки.
 *
 * Форма заявки работает без регистрации сознательно — человек,
 * который ищет аудит перед проверкой, не готов заводить аккаунт ради
 * звонка. Оплата баллами тут недоступна (списывать не с чего), это
 * ветка кабинета.
 */

export const dynamic = "force-dynamic";

const CANONICAL = "https://wesetup.ru/uslugi";

// Layout дописывает « — WeSetup», поэтому заголовок держим коротким:
// с «консультациями» в конце получалось 68 символов и хвост обрезался
// в выдаче. Полная формулировка ушла в description.
const TITLE = "Услуги по пищевой безопасности: аудит и ХАССП";
const DESCRIPTION =
  "Аудит перед проверкой Роспотребнадзора, разработка документации ХАССП и ППК, консультации и обучение персонала. Цены на сайте, заявка без регистрации — перезвоним в течение рабочего дня.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  keywords: [
    "аудит пищевой безопасности",
    "разработка ХАССП",
    "консультация по СанПиН",
    "подготовка к проверке Роспотребнадзора",
    "программа производственного контроля разработка",
    "обучение персонала общепита гигиене",
    "услуги ХАССП для общепита",
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

/** Шаги видимы на странице — из них же собирается HowTo-подобный текст. */
const STEPS = [
  {
    icon: MessageSquareText,
    title: "Оставляете заявку",
    text: "Имя и телефон. Ничего оплачивать на этом шаге не нужно — сначала разговор.",
  },
  {
    icon: Phone,
    title: "Созваниваемся",
    text: "Уточняем формат предприятия, площадь, меню и что именно горит. 15–20 минут.",
  },
  {
    icon: ClipboardCheck,
    title: "Называем объём и цену",
    text: "Фиксируем, что входит и в какой срок. Цены «от» на сайте — ориентир до этого разговора.",
  },
  {
    icon: BadgeCheck,
    title: "Делаем и передаём результат",
    text: "Отчёт, документы или настроенный аккаунт. Остаёмся на связи по вопросам после сдачи.",
  },
];

const FAQ = [
  {
    q: "Нужно ли регистрироваться, чтобы заказать услугу?",
    a: "Нет. Форма на этой странице работает без аккаунта: оставьте имя и телефон, остальное обсудим по звонку. Аккаунт нужен только для самих электронных журналов.",
  },
  {
    q: "Почему у части услуг цена «от»?",
    a: "Стоимость аудита, выезда и разработки документации зависит от площади, числа цехов, ассортимента и города. Указанная цена — нижняя граница; итоговую называем после короткого разговора и до начала работ.",
  },
  {
    q: "Вы работаете только в своём городе?",
    a: "Консультации, разработка документации и обучение проходят онлайн — география не важна. Выезд специалиста и сопровождение с регулярными визитами обсуждаем отдельно: они зависят от города.",
  },
  {
    q: "Чем аудит отличается от разработки документации?",
    a: "Аудит отвечает на вопрос «что у вас не так» — это отчёт с несоответствиями и ссылками на нормативы. Разработка документации закрывает найденное: пакет ХАССП, программа производственного контроля, приказы и инструкции под ваше предприятие.",
  },
  {
    q: "Что делать, если проверка уже назначена?",
    a: "Напишите это в комментарии к заявке. Аудит перед проверкой — самый частый срочный запрос, и такие заявки мы берём в работу вне очереди.",
  },
];

/**
 * `Service` в разметке: у фиксированной цены — `Offer` с точной суммой,
 * у «от N ₽» — `PriceSpecification` с `minPrice`, чтобы не заявлять
 * поисковику точную цену, которой у нас нет. «Цена по запросу» остаётся
 * вовсе без offers — пустой Offer Google считает ошибкой.
 */
function serviceJsonLd(item: PlatformServiceItem) {
  const offers =
    item.priceRub === null
      ? {}
      : {
          offers: {
            "@type": "Offer",
            url: `${CANONICAL}#${item.key}`,
            priceCurrency: "RUB",
            availability: "https://schema.org/InStock",
            ...(item.priceFrom
              ? {
                  priceSpecification: {
                    "@type": "PriceSpecification",
                    minPrice: item.priceRub,
                    priceCurrency: "RUB",
                  },
                }
              : { price: item.priceRub }),
          },
        };

  return {
    "@type": "Service",
    name: item.title,
    description: item.description,
    serviceType: item.title,
    areaServed: { "@type": "Country", name: "Россия" },
    provider: { "@id": "https://wesetup.ru/#org" },
    ...offers,
  };
}

export default async function UslugiPage() {
  // Каталог сидируется на первом чтении, но если БД недоступна —
  // страница не должна отдавать 500: шапка, «как мы работаем» и FAQ
  // ценны сами по себе, а заявку человек оставит через чат поддержки.
  const services = await readActiveServices().catch(() => []);
  const groups = groupServices(services);

  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      // Provider объявляем прямо здесь: Google разбирает разметку
      // постранично, и ссылка `@id` на узел, который живёт только в
      // графе лендинга, ни во что не разрезолвится. `@id` тот же, что
      // на главной, — для агрегаторов это одна сущность.
      {
        "@type": "Organization",
        "@id": "https://wesetup.ru/#org",
        name: "WeSetup",
        url: "https://wesetup.ru",
        logo: "https://wesetup.ru/icons/icon-512.png",
      },
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
        "@id": `${CANONICAL}#services`,
        name: "Услуги WeSetup по пищевой безопасности",
        numberOfItems: services.length,
        itemListElement: services.map((item, index) => ({
          "@type": "ListItem",
          position: index + 1,
          item: serviceJsonLd(item),
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
            <PublicBreadcrumbs className="mb-5" items={[{ name: "Услуги" }]} />
            <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[12px] font-medium uppercase tracking-[0.18em] text-white/80 backdrop-blur">
              <CalendarClock className="size-3.5" />
              Ответим в течение рабочего дня
            </div>
            <h1 className="mt-5 max-w-[880px] text-[36px] font-semibold leading-[1.08] tracking-[-0.02em] md:text-[48px]">
              Услуги по пищевой безопасности
            </h1>
            <p className="mt-4 max-w-[720px] text-[16px] leading-[1.65] text-white/80 md:text-[18px]">
              Аудит перед проверкой, разработка документации ХАССП и программы
              производственного контроля, консультации, обучение смены и
              настройка журналов под ваше предприятие. Цены — на странице,
              заявка — без регистрации.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <a
                href="#catalog"
                className="inline-flex h-12 items-center gap-2 rounded-2xl bg-white px-6 text-[15px] font-medium text-[#0b1024] transition-colors duration-150 hover:bg-white/90"
              >
                Смотреть услуги и цены
                <ArrowRight className="size-4" />
              </a>
              <a
                href="#how"
                className="inline-flex h-12 items-center gap-2 rounded-2xl border border-white/20 bg-white/5 px-5 text-[15px] font-medium text-white transition-colors duration-150 hover:bg-white/10"
              >
                Как мы работаем
              </a>
            </div>
          </div>
        </div>
      </section>

      <section id="how" className="mx-auto max-w-[1200px] px-4 py-10 sm:px-6 sm:py-14">
        <h2 className="text-[26px] font-semibold tracking-[-0.02em]">
          Как мы работаем
        </h2>
        <p className="mt-2 max-w-[720px] text-[15px] leading-[1.65] text-[#3c4053]">
          Четыре шага и ни одного, на котором с вас просят деньги вслепую.
        </p>
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((step, index) => (
            <div
              key={step.title}
              className="rounded-3xl border border-[#ececf4] bg-white p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)]"
            >
              <div className="flex items-center gap-3">
                <span className="flex size-10 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#5566f6]">
                  <step.icon className="size-5" />
                </span>
                <span className="text-[13px] font-semibold tabular-nums text-[#9b9fb3]">
                  Шаг {index + 1}
                </span>
              </div>
              <div className="mt-4 text-[15px] font-medium text-[#0b1024]">
                {step.title}
              </div>
              <p className="mt-1.5 text-[13px] leading-[1.6] text-[#6f7282]">
                {step.text}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section id="catalog" className="mx-auto max-w-[1200px] px-4 pb-10 sm:px-6 sm:pb-14">
        {groups.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-6 py-14 text-center">
            <div className="text-[15px] font-medium text-[#0b1024]">
              Каталог услуг временно недоступен
            </div>
            <p className="mx-auto mt-1.5 max-w-[420px] text-[13px] leading-[1.6] text-[#6f7282]">
              Напишите нам в чат в правом нижнем углу — ответим и подберём
              формат работы вручную.
            </p>
          </div>
        ) : (
          groups.map((group) => (
            <div key={group.category} className="mb-12 last:mb-0">
              <div className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h2 className="text-[22px] font-semibold tracking-[-0.02em]">
                  {group.label}
                </h2>
                <span className="text-[13px] tabular-nums text-[#9b9fb3]">
                  {group.items.length}
                </span>
              </div>

              <div className="grid gap-5 lg:grid-cols-2">
                {group.items.map((item) => (
                  <article
                    key={item.key}
                    id={item.key}
                    className="flex scroll-mt-24 flex-col rounded-3xl border border-[#ececf4] bg-white p-6 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] transition-shadow duration-200 hover:shadow-[0_16px_40px_-24px_rgba(85,102,246,0.35)] md:p-7"
                  >
                    <h3 className="text-[18px] font-semibold leading-[1.3] tracking-[-0.01em]">
                      {item.title}
                    </h3>
                    <p className="mt-2 text-[14px] leading-[1.6] text-[#3c4053]">
                      {item.summary}
                    </p>
                    <p className="mt-3 text-[13px] leading-[1.65] text-[#6f7282]">
                      {item.description}
                    </p>

                    <div className="mt-6 flex flex-wrap items-end justify-between gap-4 border-t border-[#ececf4] pt-5">
                      <div>
                        <div className="text-[22px] font-semibold tracking-[-0.02em] tabular-nums text-[#0b1024]">
                          {formatServicePrice(item)}
                        </div>
                        <div className="mt-1 text-[12px] leading-[1.5] text-[#9b9fb3]">
                          {isInstantPayable(item)
                            ? "Фиксированная цена, пересчёта не будет"
                            : "Итоговую стоимость назовём после разговора"}
                        </div>
                      </div>
                      {/* Форма живёт в самой карточке: она раскрывается
                          под ценой и не уводит человека со страницы. */}
                      <ServiceRequestForm
                        serviceKey={item.key}
                        serviceTitle={item.title}
                      />
                    </div>
                  </article>
                ))}
              </div>
            </div>
          ))
        )}
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
            {`Половину вопросов закрывает сам сервис — первые ${TRIAL_DAYS} дней бесплатно`}
          </h2>
          <p className="mt-3 max-w-[620px] text-[15px] leading-[1.65] text-[#3c4053]">
            Журналы, напоминания смене и PDF для проверки доступны сразу после
            регистрации, без карты. Услуги нужны там, где требуется живой
            специалист: аудит, документация под ваше производство, разбор
            замечаний.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href="/register"
              className="inline-flex h-12 items-center gap-2 rounded-2xl bg-[#5566f6] px-6 text-[15px] font-medium text-white shadow-[0_12px_36px_-12px_rgba(85,102,246,0.65)] transition-colors duration-150 hover:bg-[#4a5bf0]"
            >
              Начать бесплатно <ArrowRight className="size-4" />
            </Link>
            <Link
              href="/prikazy"
              className="inline-flex h-12 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-5 text-[15px] font-medium text-[#0b1024] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
            >
              Образцы приказов
              <ArrowRight className="size-4 text-[#5566f6]" />
            </Link>
          </div>
        </div>
      </section>

      <PublicFooter />
    </div>
  );
}
