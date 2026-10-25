import Link from "@/components/i18n/localized-link";
import { getSiteLocale } from "@/i18n/site-locale-server";
import { loadMessages } from "@/i18n/messages";
import { isFeatureSlug, presentFeature } from "@/i18n/feature-presentation";
import { featureMetadata } from "@/i18n/feature-metadata";
import { localizedHref } from "@/i18n/site-locale";
import { createTranslator } from "use-intl/core";
import { notFound } from "next/navigation";
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
import { PublicBreadcrumbs } from "@/components/public/public-breadcrumbs";
import { ArticleRenderer } from "@/components/public/article-renderer";
import { FEATURES_ORDER } from "@/content/features";
import { TRIAL_DAYS } from "@/lib/tariff-plans";

export const dynamic = "force-dynamic";
export const revalidate = 0;

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

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  return featureMetadata(await getSiteLocale(), (await params).slug);
}

export default async function FeatureDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  if (!isFeatureSlug(slug)) notFound();
  const locale = await getSiteLocale();
  const messages = await loadMessages(locale);
  const t = createTranslator({ locale, messages, namespace: "publicFeatures.detail" });
  const info = presentFeature(slug, messages);

  const Icon = ICON_MAP[info.iconName] ?? Sparkles;

  const others = FEATURES_ORDER.filter((s) => s !== slug)
    .slice(0, 4)
    .filter(isFeatureSlug)
    .map((s) => presentFeature(s, messages));

  return (
    <div className="min-h-screen bg-white text-[#0b1024]">
      <PublicHeader activeSection="home" />

      {/* BREADCRUMB — разметка BreadcrumbList идёт из того же массива */}
      <PublicBreadcrumbs
        tone="light"
        className="mx-auto max-w-[1200px] px-4 pb-2 sm:px-6"
        home={{ name: t("home"), href: localizedHref("/", locale) }}
        ariaLabel={t("breadcrumbAria")}
        items={[{ name: t("breadcrumb"), href: localizedHref("/features", locale) }, { name: info.title }]}
      />

      {/* HERO */}
      <section className="mx-auto max-w-[1200px] px-4 sm:px-6">
        <div className="relative overflow-hidden rounded-3xl bg-[#0b1024] px-5 py-10 text-white sm:px-6 sm:py-14 md:px-12 md:py-16">
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute -left-24 -top-24 size-[380px] rounded-full bg-[#5566f6] opacity-40 blur-[120px]" />
            <div className="absolute -bottom-32 -right-32 size-[420px] rounded-full bg-[#7a5cff] opacity-30 blur-[140px]" />
          </div>
          <div className="relative">
            <div className="inline-flex size-14 items-center justify-center rounded-2xl bg-white/10 text-white backdrop-blur">
              <Icon className="size-7" />
            </div>
            <h1 className="mt-5 max-w-[760px] text-[clamp(1.625rem,6vw+0.5rem,3rem)] font-semibold leading-[1.1] tracking-[-0.02em] [overflow-wrap:anywhere] hyphens-auto">
              {info.title}
            </h1>
            <p className="mt-4 max-w-[720px] text-[15px] leading-[1.6] text-white/80 sm:text-[16px] md:text-[18px]">
              {info.tagline}
            </p>
          </div>
        </div>
      </section>

      {/* BODY */}
      <section className="mx-auto max-w-[1200px] px-4 py-8 sm:px-6 sm:py-12">
        <div className="grid gap-8 md:grid-cols-[1fr_320px]">
          <div className="min-w-0">
            <ArticleRenderer blocks={info.body} />
          </div>
          <aside className="space-y-5">
            <div className="rounded-3xl border border-[#ececf4] bg-[#fafbff] p-6">
              <div className="text-[13px] font-medium text-[#6f7282]">
                {t("trialHeading")}
              </div>
              <p className="mt-2 text-[13px] leading-[1.5] text-[#6f7282]">
                {t("trialDescription", { trialDays: TRIAL_DAYS })}
              </p>
              <Link
                href="/register"
                className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-[#5566f6] px-4 py-3 text-[14px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors hover:bg-[#4a5bf0]"
              >
                {t("trialButton")}
                <ArrowRight className="size-4" />
              </Link>
            </div>
            {others.length > 0 && (
              <div className="rounded-3xl border border-[#ececf4] bg-white p-6">
                <div className="text-[13px] font-medium uppercase tracking-[0.14em] text-[#6f7282]">
                  {t("moreFeatures")}
                </div>
                <ul className="mt-3 space-y-1">
                  {others.map((o) => {
                    const OIcon = ICON_MAP[o.iconName] ?? Sparkles;
                    return (
                      <li key={o.slug}>
                        <Link
                          href={`/features/${o.slug}`}
                          className="group flex items-center gap-3 rounded-xl p-2 transition-colors hover:bg-[#f5f6ff]"
                        >
                          <span className="flex size-8 items-center justify-center rounded-lg bg-[#eef1ff] text-[#5566f6]">
                            <OIcon className="size-4" />
                          </span>
                          <span className="text-[14px] font-medium text-[#0b1024] group-hover:text-[#3848c7]">
                            {o.title}
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </aside>
        </div>
      </section>

      <PublicFooter />
    </div>
  );
}
