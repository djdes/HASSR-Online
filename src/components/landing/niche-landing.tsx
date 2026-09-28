import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  Clock,
  ExternalLink,
  FileSignature,
  ListChecks,
  Printer,
  Scale,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { PublicHeader, PublicFooter } from "@/components/public/public-chrome";
import { PublicBreadcrumbs } from "@/components/public/public-breadcrumbs";
import { jsonLdSafeString } from "@/lib/json-ld";
import { buildNicheFaq, nicheFaqJsonLd } from "@/lib/niche-faq";
import { NICHES, type Niche } from "@/content/niches";
import { JOURNALS_TOTAL_LABEL } from "@/lib/journal-catalog";
import { pluralRu } from "@/lib/plural-ru";
import {
  buildSpherePublicContent,
  type PublicJournal,
} from "@/lib/sphere-public-content";
export { NICHES };
export type { Niche };
import {
  DEFAULT_TWITTER_CARD,
  } from "@/lib/meta-defaults";
import { ogImages, twitterImages } from "@/lib/og-image";
import { FREE_SEATS_LABEL } from "@/lib/plan-catalog";

/**
 * E19 — лендинги под ниши. У каждой ниши свой заголовок и выгоды, а
 * журналы (с основаниями и условиями), бумажные бланки, приказы и
 * чек-листы строятся из правил её сферы (`SPHERE_RULES` через
 * `buildSpherePublicContent`) — тех же, что включает кабинет. Цель —
 * поднять SEO под запросы типа «электронные журналы для кафе» и
 * улучшить релевантность для конкретного посетителя.
 *
 * Роуты подключают этот компонент по slug из `NICHES`
 * (`/dlya-kafe`, `/dlya-pekarni`, …, `/dlya-fitnes-centra`,
 * `/dlya-salona-krasoty`).
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
  const content = buildSpherePublicContent(data.sphere);

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
              {data.sphere === "fitness" || data.sphere === "beauty"
                ? "Электронные записи производственного контроля — законно"
                : "Разрешено СанПиН 2.3/2.4.4282-26"}
            </div>
          </div>
        </div>
      </section>

      {/* INSPECTOR — что проверяют и чем грозит (intro/introLaw сферы) */}
      <section className="mx-auto max-w-[1200px] px-4 pt-14 sm:px-6 sm:pt-20">
        <div className="rounded-3xl border border-[#ececf4] bg-[#fafbff] p-6 sm:p-8">
          <div className="flex flex-col gap-5 md:flex-row md:items-start">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#5566f6]">
              <Scale className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="mb-2 text-[12px] uppercase tracking-[0.18em] text-[#5566f6]">
                Что проверяет инспектор
              </div>
              <h2 className="text-[clamp(1.375rem,1.6vw+1rem,1.75rem)] font-semibold leading-tight tracking-[-0.02em]">
                {data.navLabel}: какие записи должны быть
              </h2>
              <p className="mt-3 max-w-[860px] text-[15px] leading-[1.7] text-[#3c4053]">
                {content.intro}
              </p>
              <a
                href={content.introLaw.url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-medium text-[#3848c7] underline-offset-2 hover:underline"
              >
                {content.introLaw.label}
                <ExternalLink className="size-3.5" />
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* REQUIRED JOURNALS */}
      <section className="mx-auto max-w-[1200px] px-4 pt-14 sm:px-6 sm:pt-20">
        <SectionHeading
          eyebrow="Обязательные журналы"
          title="Что включим сразу после регистрации"
          hint="У каждого журнала указано основание. Условные журналы нужны, только если условие про вас."
        />
        <div className="grid gap-3 sm:grid-cols-2">
          {content.required.map((journal) => (
            <RequiredJournalCard key={journal.code} journal={journal} />
          ))}
        </div>
      </section>

      {/* RECOMMENDED JOURNALS */}
      {content.recommended.length > 0 ? (
        <section className="mx-auto max-w-[1200px] px-4 pt-12 sm:px-6 sm:pt-14">
          <SectionHeading
            eyebrow="Рекомендуемые журналы"
            title="Что стоит вести дополнительно"
            hint="Закон прямо не обязывает, но эти журналы часто спрашивают, и с ними проще держать порядок. В кабинете включаются одним переключателем."
          />
          <div className="flex flex-wrap gap-2">
            {content.recommended.map((journal) =>
              journal.href ? (
                <Link
                  key={journal.code}
                  href={journal.href}
                  className="inline-flex items-center gap-1.5 rounded-full border border-[#ececf4] bg-white px-3.5 py-2 text-[13px] text-[#3c4053] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] hover:text-[#3848c7]"
                >
                  {journal.name}
                  <ArrowRight className="size-3.5 shrink-0 text-[#9b9fb3]" />
                </Link>
              ) : (
                <span
                  key={journal.code}
                  className="inline-flex items-center rounded-full border border-[#ececf4] bg-white px-3.5 py-2 text-[13px] text-[#3c4053]"
                >
                  {journal.name}
                </span>
              ),
            )}
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
      ) : null}

      {/* PAPER JOURNALS */}
      {content.paper.length > 0 ? (
        <section className="mx-auto max-w-[1200px] px-4 pt-12 sm:px-6 sm:pt-14">
          <SectionHeading
            eyebrow="Бумажные журналы"
            title="Охрана труда и пожарная безопасность"
            hint="Это не санитария, но эти журналы проверяют трудовая инспекция и пожарный надзор. Бланки для печати есть в кабинете."
          />
          <div className="grid gap-3 md:grid-cols-2">
            {content.paper.map((journal) => (
              <div
                key={journal.id}
                className="flex flex-col gap-2 rounded-2xl border border-[#ececf4] bg-white p-4 sm:p-5"
              >
                <div className="flex items-start gap-2.5">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-[#fff8eb] text-[#b45309]">
                    <Printer className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1 text-[14px] font-semibold leading-snug text-[#0b1024]">
                    {journal.name}
                  </div>
                </div>
                <p className="text-[13px] leading-[1.6] text-[#3c4053]">
                  {journal.why}
                </p>
                <div className="mt-auto flex flex-wrap items-center gap-2 pt-1 text-[12px]">
                  <span
                    className={`rounded-full px-2.5 py-1 font-medium ${
                      journal.paperOnly
                        ? "bg-[#fff4f2] text-[#a13a32]"
                        : "bg-[#fff1d6] text-[#b45309]"
                    }`}
                  >
                    {journal.paperOnly
                      ? "Только на бумаге"
                      : "Бумага или электронно с подписью"}
                  </span>
                  <span className="text-[#6f7282]">Штраф {journal.fineHint}</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* ORDERS */}
      <section className="mx-auto max-w-[1200px] px-4 pt-12 sm:px-6 sm:pt-14">
        <SectionHeading
          eyebrow="Приказы"
          title="Кто за что отвечает — с подписью руководителя"
          hint="Журнал без приказа о назначении ответственного — лишний вопрос на проверке. Шаблоны заполняются реквизитами из кабинета."
        />
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-3xl border border-[#ececf4] bg-white p-5 sm:p-6">
            <div className="mb-3 flex items-center gap-2 text-[13px] font-semibold text-[#0b1024]">
              <FileSignature className="size-4 text-[#5566f6]" />
              Обязательные
              <span className="rounded-full bg-[#eef1ff] px-2 py-0.5 text-[11px] font-medium tabular-nums text-[#3848c7]">
                {content.ordersRequired.length}
              </span>
            </div>
            <ul className="space-y-1">
              {content.ordersRequired.map((order) => (
                <li key={order.code}>
                  <Link
                    href={`/prikazy#${order.code}`}
                    className="group flex items-start gap-2 rounded-2xl px-2 py-1.5 text-[14px] leading-snug text-[#0b1024] transition-colors duration-150 hover:bg-[#f5f6ff]"
                  >
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                    <span className="min-w-0 flex-1 group-hover:text-[#3848c7]">
                      {order.title}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          {content.ordersRecommended.length > 0 ? (
            <div className="rounded-3xl border border-[#ececf4] bg-[#fafbff] p-5 sm:p-6">
              <div className="mb-3 flex items-center gap-2 text-[13px] font-semibold text-[#3c4053]">
                Рекомендуемые
                <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-medium tabular-nums text-[#6f7282]">
                  {content.ordersRecommended.length}
                </span>
              </div>
              <ul className="space-y-1">
                {content.ordersRecommended.map((order) => (
                  <li key={order.code}>
                    <Link
                      href={`/prikazy#${order.code}`}
                      className="group flex items-start gap-2 rounded-2xl px-2 py-1.5 text-[14px] leading-snug text-[#3c4053] transition-colors duration-150 hover:bg-white"
                    >
                      <ArrowRight className="mt-0.5 size-4 shrink-0 text-[#9b9fb3]" />
                      <span className="min-w-0 flex-1 group-hover:text-[#3848c7]">
                        {order.title}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
        <div className="mt-6">
          <Link
            href="/prikazy"
            className="inline-flex h-11 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
          >
            Все шаблоны приказов
            <ArrowRight className="size-4 text-[#5566f6]" />
          </Link>
        </div>
      </section>

      {/* CHECKLISTS */}
      {content.checklists.length > 0 ? (
        <section className="mx-auto max-w-[1200px] px-4 pt-12 sm:px-6 sm:pt-14">
          <SectionHeading
            eyebrow="Чек-листы ежедневного контроля"
            title="Сотрудник видит не «помой», а что именно сделать"
            hint="Типовые пункты вставляются в кабинете одной кнопкой и правятся под ваш объект. Так они выглядят:"
          />
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {content.checklists.map((checklist) => (
              <div
                key={checklist.code}
                className="flex flex-col rounded-2xl border border-[#ececf4] bg-white p-4 sm:p-5"
              >
                <div className="flex items-start gap-2.5">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-[#eef1ff] text-[#5566f6]">
                    <ListChecks className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[14px] font-semibold leading-snug text-[#0b1024]">
                      {checklist.name}
                    </div>
                    <div className="mt-0.5 text-[12px] tabular-nums text-[#6f7282]">
                      Типовой набор: {checklist.total} {pluralRu(checklist.total, "пункт", "пункта", "пунктов")}
                    </div>
                  </div>
                </div>
                <ul className="mt-3 space-y-2">
                  {checklist.examples.map((example) => (
                    <li
                      key={example}
                      className="flex items-start gap-2 text-[13px] leading-[1.55] text-[#3c4053]"
                    >
                      <span
                        aria-hidden
                        className="mt-[3px] size-3.5 shrink-0 rounded border border-[#dcdfed] bg-[#fafbff]"
                      />
                      <span className="min-w-0">{example}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      ) : null}

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
            Бесплатный тариф навсегда: {FREE_SEATS_LABEL}, все {JOURNALS_TOTAL_LABEL}
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

function SectionHeading({
  eyebrow,
  title,
  hint,
}: {
  eyebrow: string;
  title: string;
  hint?: string;
}) {
  return (
    <div className="mb-6 max-w-[720px]">
      <div className="mb-3 text-[12px] uppercase tracking-[0.18em] text-[#5566f6]">
        {eyebrow}
      </div>
      <h2 className="text-[clamp(1.5rem,1.8vw+1rem,2rem)] font-semibold leading-tight tracking-[-0.02em]">
        {title}
      </h2>
      {hint ? (
        <p className="mt-2 text-[14px] leading-[1.6] text-[#6f7282]">{hint}</p>
      ) : null}
    </div>
  );
}

/** Обязательный журнал: название, основание, норма, условие, уточнение. */
function RequiredJournalCard({ journal }: { journal: PublicJournal }) {
  const body = (
    <>
      <div className="flex items-start gap-2.5">
        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />
        <div className="min-w-0 flex-1 text-[14px] font-semibold leading-snug text-[#0b1024] group-hover:text-[#3848c7]">
          {journal.name}
        </div>
        {journal.href ? (
          <ArrowRight className="mt-0.5 size-4 shrink-0 text-[#9b9fb3] transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-[#5566f6]" />
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-1.5 pl-[26px] text-[12px]">
        {journal.basisLabel ? (
          <span className="rounded-full bg-[#f5f6ff] px-2.5 py-1 text-[#3848c7]">
            {journal.basisLabel}
          </span>
        ) : null}
        {journal.law ? (
          <span className="rounded-full bg-[#fafbff] px-2.5 py-1 text-[#6f7282] ring-1 ring-[#ececf4]">
            {journal.law.label}
          </span>
        ) : null}
        {journal.condition ? (
          <span className="rounded-full bg-[#fff8eb] px-2.5 py-1 text-[#a16d32]">
            {journal.condition}
          </span>
        ) : null}
      </div>
      {journal.note ? (
        <p className="pl-[26px] text-[13px] leading-[1.55] text-[#6f7282]">
          {journal.note}
        </p>
      ) : null}
    </>
  );
  const className =
    "group flex h-full flex-col gap-2 rounded-2xl border border-[#ececf4] bg-white p-4 transition-colors duration-150 sm:p-5";
  return journal.href ? (
    <Link
      href={journal.href}
      className={`${className} hover:border-[#5566f6]/40 hover:bg-[#fafbff]`}
    >
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}
