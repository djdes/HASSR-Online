import Link from "next/link";
import {
  ArrowRight,
  Bell,
  BellRing,
  Cloud,
  Leaf,
  Plug,
  QrCode,
  Sparkles,
  Timer,
  UserCheck,
  Wand2,
  type LucideIcon,
} from "lucide-react";
import { PublicHeader, PublicFooter } from "@/components/public/public-chrome";
import { FEATURES_INFO, FEATURES_ORDER } from "@/content/features";
import {
  DEFAULT_OG_IMAGES,
  DEFAULT_TWITTER_CARD,
  DEFAULT_TWITTER_IMAGES,
} from "@/lib/meta-defaults";
import { JOURNALS_TOTAL_LABEL } from "@/lib/journal-catalog";

/**
 * Индекс возможностей — раньше `/features` отдавал 404.
 *
 * Существовал только `/features/[slug]`, восемь детальных страниц были в
 * `sitemap.ts`, а страница тарифов вела кнопкой «Все возможности →» на
 * несуществующий `/features` (`src/app/pricing/page.tsx`). Смоук-тест
 * `npm run qa:smoke:prod` ловил это как единственное настоящее падение.
 *
 * Иконки берём из той же карты, что и детальная страница: `iconName` в
 * контенте — строка, а не компонент, потому что `FEATURES_INFO`
 * импортируется и на сервере.
 */

export const dynamic = "force-dynamic";
export const revalidate = 0;

const PAGE_TITLE = "Возможности WeSetup — электронные журналы ХАССП и СанПиН";
const PAGE_DESC =
  "Что умеет WeSetup: синхронизация с iiko и 1С, автозаполнение журналов, напоминания сотрудникам, контроль температур и доступ по ролям.";

export const metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESC,
  alternates: { canonical: "https://wesetup.ru/features" },
  openGraph: {
    type: "website",
    locale: "ru_RU",
    siteName: "WeSetup",
    url: "https://wesetup.ru/features",
    title: PAGE_TITLE,
    description: PAGE_DESC,
    images: DEFAULT_OG_IMAGES,
  },
  twitter: {
    card: DEFAULT_TWITTER_CARD,
    title: PAGE_TITLE,
    description: PAGE_DESC,
    images: DEFAULT_TWITTER_IMAGES,
  },
};

const ICON_MAP: Record<string, LucideIcon> = {
  QrCode,
  Plug,
  Wand2,
  Cloud,
  UserCheck,
  BellRing,
  Bell,
  Leaf,
  Timer,
};

export default function FeaturesIndexPage() {
  const features = FEATURES_ORDER.map((slug) => FEATURES_INFO[slug]).filter(
    Boolean,
  );

  return (
    <div className="min-h-screen bg-white text-[#0b1024]">
      <PublicHeader />

      {/* HERO */}
      <section className="mx-auto max-w-[1200px] px-4 sm:px-6">
        <div className="relative overflow-hidden rounded-3xl bg-[#0b1024] px-5 py-10 text-white sm:px-6 sm:py-14 md:px-12 md:py-20">
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute -left-24 -top-24 size-[420px] rounded-full bg-[#5566f6] opacity-40 blur-[120px]" />
            <div className="absolute -bottom-32 -right-32 size-[460px] rounded-full bg-[#7a5cff] opacity-30 blur-[140px]" />
          </div>
          <div className="relative">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-[12px] font-medium uppercase tracking-[0.18em] text-white/80 backdrop-blur">
              <Sparkles className="size-3.5" /> Возможности
            </div>
            <h1 className="mt-4 max-w-[780px] text-[40px] font-semibold leading-[1.08] tracking-[-0.02em] md:text-[56px]">
              Что WeSetup делает за вас
            </h1>
            <p className="mt-5 max-w-[720px] text-[16px] leading-[1.6] text-white/80 md:text-[18px]">
              Журналы заполняются с телефона за минуты, часть — сама по
              расписанию. Ниже — как это устроено: от синхронизации с учётной
              системой до напоминаний сотруднику в смене.
            </p>
          </div>
        </div>
      </section>

      {/* FEATURES */}
      <section className="mx-auto max-w-[1200px] px-4 py-10 sm:px-6 sm:py-16">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((feature) => {
            const Icon = ICON_MAP[feature.iconName] ?? Sparkles;
            return (
              <Link
                key={feature.slug}
                href={`/features/${feature.slug}`}
                className="group flex min-w-0 flex-col rounded-2xl border border-[#ececf4] bg-white p-5 transition-all hover:-translate-y-0.5 hover:border-[#5566f6]/40 hover:shadow-[0_16px_40px_-24px_rgba(85,102,246,0.35)]"
              >
                <span className="inline-flex size-10 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#5566f6]">
                  <Icon className="size-5" />
                </span>
                <h2 className="mt-4 text-[18px] font-semibold leading-snug tracking-[-0.01em]">
                  {feature.title}
                </h2>
                <p className="mt-2 flex-1 text-[14px] leading-[1.6] text-[#6f7282]">
                  {feature.tagline}
                </p>
                <span className="mt-4 inline-flex items-center gap-1.5 text-[14px] font-medium text-[#3848c7]">
                  Подробнее
                  <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
                </span>
              </Link>
            );
          })}
        </div>

        <div className="mt-12 rounded-3xl border border-[#ececf4] bg-[#fafbff] p-6 md:p-8">
          <h2 className="text-[22px] font-semibold tracking-[-0.01em]">
            Смотрите сами журналы
          </h2>
          <p className="mt-1.5 max-w-[640px] text-[15px] leading-[1.6] text-[#6f7282]">
            В каталоге — все {JOURNALS_TOTAL_LABEL} с образцами бланков: что заполняется,
            как часто и какая норма этого требует.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link
              href="/journals-info"
              className="inline-flex h-10 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
            >
              Каталог журналов
              <ArrowRight className="size-4 text-[#5566f6]" />
            </Link>
            <Link
              href="/register"
              className="inline-flex h-10 items-center gap-2 rounded-2xl bg-[#5566f6] px-4 text-[14px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors hover:bg-[#4a5bf0]"
            >
              Попробовать бесплатно
              <ArrowRight className="size-4" />
            </Link>
          </div>
        </div>
      </section>

      <PublicFooter />
    </div>
  );
}
