import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, CheckCircle2, ClipboardList, MapPin, ShieldCheck, Smartphone } from "lucide-react";

import { PublicBreadcrumbs } from "@/components/public/public-breadcrumbs";
import { PublicFooter, PublicHeader } from "@/components/public/public-chrome";
import { CITIES, CITY_ORDER } from "@/content/cities";
import { NICHES } from "@/content/niches";
import { jsonLdSafeString } from "@/lib/json-ld";
import { DEFAULT_TWITTER_CARD } from "@/lib/meta-defaults";
import { ogImages, twitterImages } from "@/lib/og-image";

export const dynamic = "force-static";

const SITE = "https://wesetup.ru";
const JOURNALS = [
  { code: "hygiene", name: "Гигиенический журнал" },
  { code: "health_check", name: "Журнал здоровья" },
  { code: "cold_equipment_control", name: "Температура холодильников" },
  { code: "finished_product", name: "Бракераж готовой продукции" },
  { code: "cleaning", name: "Журнал уборки" },
  { code: "incoming_control", name: "Входной контроль сырья" },
  { code: "disinfectant_usage", name: "Учёт дезсредств" },
  { code: "pest_control", name: "Дезинсекция и дератизация" },
];
const NICHE_SLUGS = ["dlya-kafe", "dlya-pekarni", "dlya-stolovoy", "dlya-proizvodstva", "dlya-otelya", "dlya-keyteringa"];

export function generateStaticParams() {
  return CITY_ORDER.map((city) => ({ city }));
}

function texts(slug: string) {
  const c = CITIES[slug];
  const title = `Электронные журналы СанПиН и ХАССП ${c.inCity}`;
  const description = `Электронные журналы ХАССП для кафе и ресторанов ${c.inCity}: 35 журналов, заполнение с телефона, PDF к проверке Роспотребнадзора. Бесплатно до 3 сотрудников.`;
  return { c, title, description, url: `${SITE}/v/${c.slug}` };
}

export async function generateMetadata({ params }: { params: Promise<{ city: string }> }): Promise<Metadata> {
  const { city } = await params;
  if (!CITIES[city]) return { title: { absolute: "Город не найден — WeSetup" } };
  const { title, description, url } = texts(city);
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { type: "website", locale: "ru_RU", siteName: "WeSetup", url, title, description, images: ogImages({ title, subtitle: description, kind: "landing" }) },
    twitter: { card: DEFAULT_TWITTER_CARD, title, description, images: twitterImages({ title, kind: "landing" }) },
  };
}

/** Городской лендинг: один шаблон, разные город и территориальное управление. */
export default async function CityLandingPage({ params }: { params: Promise<{ city: string }> }) {
  const { city } = await params;
  if (!CITIES[city]) notFound();
  const { c, title, description, url } = texts(city);
  const faq = [
    { q: `Подходят ли электронные журналы для проверок ${c.inCity}?`, a: `Да. ${c.rpn} принимает журналы производственного контроля в электронном виде при условии, что записи можно распечатать и подписать. WeSetup формирует PDF по форме СанПиН с подписями за любой период.` },
    { q: "Какие журналы обязательны для кафе или столовой?", a: "Минимум: гигиенический журнал, журнал здоровья, температура холодильников, бракераж готовой продукции, уборка и дезинфекция, входной контроль сырья. Полный набор зависит от типа заведения — калькулятор на сайте подберёт список." },
    { q: `По какому времени ведутся записи ${c.inCity}?`, a: `По местному (${c.timezone}). Часовой пояс задаётся в настройках организации, и напоминания, отчёты и печатные формы идут по нему.` },
  ];
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Service",
        name: title,
        serviceType: "Электронные журналы производственного контроля",
        provider: { "@type": "Organization", name: "WeSetup", url: SITE },
        areaServed: { "@type": "City", name: c.name, containedInPlace: { "@type": "AdministrativeArea", name: c.region } },
        url,
        description,
        offers: { "@type": "Offer", price: "0", priceCurrency: "RUB", description: "Бесплатный тариф до 3 сотрудников" },
      },
      { "@type": "FAQPage", mainEntity: faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) },
    ],
  };
  const otherCities = CITY_ORDER.filter((s) => s !== c.slug).slice(0, 8);

  return (
    <div className="min-h-screen bg-white text-[#0b1024]">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdSafeString(jsonLd) }} />
      <PublicHeader />
      <section className="mx-auto max-w-[1200px] px-4 pt-6 sm:px-6">
        <PublicBreadcrumbs items={[{ name: "Города", href: "/v/moskva" }, { name: c.name }]} tone="light" />
        <div className="relative mt-6 overflow-hidden rounded-3xl border border-[#ececf4] bg-[#0b1024] text-white shadow-[0_20px_60px_-30px_rgba(11,16,36,0.55)]">
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute -left-24 -top-24 size-[420px] rounded-full bg-[#5566f6] opacity-40 blur-[120px]" />
            <div className="absolute -bottom-40 -right-32 size-[460px] rounded-full bg-[#7a5cff] opacity-30 blur-[140px]" />
          </div>
          <div className="relative z-10 p-8 md:p-12">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-[12px] font-semibold uppercase tracking-[0.16em] text-white/80">
              <MapPin className="size-3.5" />
              {c.name} · {c.region}
            </div>
            <h1 className="mt-5 max-w-[820px] text-[36px] font-semibold leading-[1.08] tracking-[-0.02em] md:text-[52px]">{title}</h1>
            <p className="mt-5 max-w-[720px] text-[16px] leading-[1.7] text-white/80 md:text-[18px]">
              35 журналов СанПиН и ХАССП в одном кабинете: сотрудники заполняют с телефона, руководитель видит пропуски в Telegram, инспектору — PDF за минуту. Особенность города: {c.note}.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/register" className="inline-flex h-12 items-center gap-2 rounded-2xl bg-[#5566f6] px-6 text-[15px] font-medium text-white shadow-[0_12px_36px_-12px_rgba(85,102,246,0.65)] transition-colors hover:bg-[#4a5bf0]">
                Начать бесплатно
                <ArrowRight className="size-4" />
              </Link>
              <Link href="/calc/journals" className="inline-flex h-12 items-center gap-2 rounded-2xl border border-white/25 bg-white/10 px-6 text-[15px] font-medium text-white transition-colors hover:bg-white/15">
                Какие журналы нужны мне
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[1200px] px-4 py-14 sm:px-6">
        <div className="grid gap-5 md:grid-cols-3">
          {[
            { icon: ShieldCheck, title: `Проверки ${c.inCity}`, text: `${c.rpn} проверяет наличие и заполнение журналов производственного контроля. Электронные записи с датой и автором печатаются по форме СанПиН — инспектор получает то, к чему привык.` },
            { icon: Smartphone, title: "Заполнение с телефона", text: "Повар, уборщица и заведующий производством отмечаются в Telegram или в приложении. Напоминания приходят по местному времени, пропуски видны руководителю сразу." },
            { icon: ClipboardList, title: "Готовые формы", text: "Гигиена, здоровье, бракераж, температура, уборка, входной контроль, дезсредства и ещё 28 журналов — под общепит, пекарни, столовые и производства." },
          ].map((item) => (
            <div key={item.title} className="rounded-3xl border border-[#ececf4] bg-white p-6 shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
              <div className="flex size-11 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#3848c7]">
                <item.icon className="size-5" />
              </div>
              <h2 className="mt-4 text-[18px] font-semibold tracking-[-0.01em]">{item.title}</h2>
              <p className="mt-2 text-[14px] leading-[1.65] text-[#3c4053]">{item.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-[1200px] px-4 pb-14 sm:px-6">
        <div className="rounded-3xl border border-[#ececf4] bg-[#fafbff] p-6 md:p-8">
          <h2 className="text-[clamp(1.5rem,1.8vw+1rem,2rem)] font-semibold tracking-[-0.02em]">Обязательные журналы для заведений {c.inCity}</h2>
          <ul className="mt-5 grid gap-2.5 sm:grid-cols-2">
            {JOURNALS.map((j) => (
              <li key={j.code}>
                <Link href={`/journals-info/${j.code}`} className="flex items-center gap-2.5 rounded-2xl border border-[#ececf4] bg-white px-4 py-3 text-[14px] font-medium transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]">
                  <CheckCircle2 className="size-4 shrink-0 text-[#5566f6]" />
                  {j.name}
                </Link>
              </li>
            ))}
          </ul>
          <Link href="/journals-info" className="mt-5 inline-flex items-center gap-1.5 text-[14px] font-medium text-[#3848c7] underline-offset-2 hover:underline">
            Все 35 журналов каталога
            <ArrowRight className="size-4" />
          </Link>
        </div>
      </section>

      <section className="mx-auto max-w-[1200px] px-4 pb-14 sm:px-6">
        <h2 className="text-[clamp(1.5rem,1.8vw+1rem,2rem)] font-semibold tracking-[-0.02em]">Под ваш тип заведения</h2>
        <div className="mt-5 flex flex-wrap gap-2">
          {NICHE_SLUGS.filter((s) => NICHES[s]).map((s) => (
            <Link key={s} href={`/${s}`} className="rounded-full border border-[#dcdfed] bg-white px-4 py-2 text-[14px] font-medium transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]">
              {NICHES[s].navLabel}
            </Link>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-[1200px] px-4 pb-14 sm:px-6">
        <h2 className="text-[clamp(1.5rem,1.8vw+1rem,2rem)] font-semibold tracking-[-0.02em]">Вопросы и ответы</h2>
        <div className="mt-5 grid gap-4 md:grid-cols-3">
          {faq.map((f) => (
            <div key={f.q} className="rounded-3xl border border-[#ececf4] bg-white p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
              <div className="text-[15px] font-semibold">{f.q}</div>
              <p className="mt-2 text-[14px] leading-[1.65] text-[#3c4053]">{f.a}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-[1200px] px-4 pb-20 sm:px-6">
        <div className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">Другие города</div>
        <div className="mt-3 flex flex-wrap gap-2">
          {otherCities.map((s) => (
            <Link key={s} href={`/v/${s}`} className="rounded-full bg-[#f5f6ff] px-3 py-1.5 text-[13px] text-[#3848c7] hover:bg-[#eef1ff]">
              {CITIES[s].name}
            </Link>
          ))}
        </div>
      </section>
      <PublicFooter />
    </div>
  );
}
