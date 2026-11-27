import type { Metadata } from "next";
import Image from "next/image";
import { ArrowRight, ClipboardList, QrCode, ShieldCheck } from "lucide-react";
import { getTranslations } from "next-intl/server";

import Link from "@/components/i18n/localized-link";
import { GooglePlayAuthorizationCard } from "@/components/public/google-play-authorization-card";
import { PublicBreadcrumbs } from "@/components/public/public-breadcrumbs";
import { PublicFooter, PublicHeader } from "@/components/public/public-chrome";
import { localizedHref, siteLanguageAlternates } from "@/i18n/site-locale";
import { getSiteLocale } from "@/i18n/site-locale-server";
import { COMPANY_EMAIL, COMPANY_PHONE, COMPANY_TELEGRAM } from "@/lib/company-contacts";
import { jsonLdSafeString } from "@/lib/json-ld";
import { DEFAULT_TWITTER_CARD } from "@/lib/meta-defaults";
import { ogImages, twitterImages } from "@/lib/og-image";
import { SHOWCASE_SCREENS_DIR } from "@/components/landing/showcase-screens";

const SITE = "https://wesetup.ru";
const PATH = "/about";
const company = { legalName: "ООО «БФС»", inn: "5018215599", kpp: "501801001", ogrn: "1235000105306" };

const workflow = [
  { key: "select", icon: ClipboardList },
  { key: "record", icon: QrCode },
  { key: "review", icon: ShieldCheck },
] as const;

const journals = [
  { key: "hygiene", code: "hygiene" },
  { key: "temperature", code: "cold_equipment_control" },
  { key: "cleaning", code: "cleaning" },
  { key: "food", code: "finished_product" },
] as const;

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getSiteLocale();
  const t = await getTranslations({ locale, namespace: "publicAbout.metadata" });
  const title = t("title");
  const description = t("description");
  const url = `${SITE}${localizedHref(PATH, locale)}`;
  const image = { title, subtitle: description, kind: "landing" as const, locale };

  return {
    title,
    description,
    alternates: { canonical: url, languages: siteLanguageAlternates(PATH) },
    openGraph: {
      type: "website",
      siteName: "WeSetup",
      locale: { ru: "ru_RU", en: "en_GB", uz: "uz_UZ", tg: "tg_TJ", hy: "hy_AM", ky: "ky_KG", de: "de_DE", fr: "fr_FR" }[locale],
      url,
      title,
      description,
      images: ogImages(image),
    },
    twitter: { card: DEFAULT_TWITTER_CARD, title, description, images: twitterImages(image) },
  };
}

export default async function AboutPage() {
  const locale = await getSiteLocale();
  const [t, chrome] = await Promise.all([
    getTranslations({ locale, namespace: "publicAbout" }),
    getTranslations({ locale, namespace: "publicChrome" }),
  ]);
  const url = `${SITE}${localizedHref(PATH, locale)}`;
  const pageJsonLd = jsonLdSafeString({
    "@context": "https://schema.org",
    "@type": "AboutPage",
    "@id": `${url}#about`,
    name: t("hero.title"),
    description: t("metadata.description"),
    url,
    inLanguage: locale,
    isPartOf: { "@id": `${SITE}/#website` },
    mainEntity: {
      "@type": "Organization",
      "@id": `${SITE}/#org`,
      name: "WeSetup",
      legalName: company.legalName,
      url: SITE,
      logo: `${SITE}/icons/icon-512.png`,
      taxID: company.inn,
      email: COMPANY_EMAIL,
      telephone: COMPANY_PHONE.tel,
    },
  });

  return (
    <div className="min-h-screen bg-white text-[#0b1024]">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: pageJsonLd }} />
      <PublicHeader />

      <main className="mx-auto max-w-[1200px] px-4 pb-16 pt-6 sm:px-6 sm:pb-20">
        <PublicBreadcrumbs
          tone="light"
          className="mb-5"
          ariaLabel={t("breadcrumbs.label")}
          home={{ name: t("breadcrumbs.home"), href: localizedHref("/", locale) }}
          items={[
            { name: chrome("journals"), href: localizedHref("/journals-info", locale) },
            { name: chrome("about") },
          ]}
        />

        <header className="relative isolate overflow-hidden rounded-3xl bg-[#0b1024] text-white">
          <div aria-hidden className="pointer-events-none absolute -right-20 -top-32 size-[420px] rounded-full bg-[#5566f6] opacity-40 blur-[120px]" />
          <div className="relative grid items-center gap-8 px-5 py-9 sm:px-9 sm:py-12 lg:grid-cols-2 lg:px-12 lg:py-16">
            <div>
              <h1 className="text-[clamp(2rem,4vw,3.25rem)] font-semibold leading-[1.08] tracking-[-0.035em]">
                {t("hero.title")}
              </h1>
              <p className="mt-5 max-w-[48ch] text-base leading-relaxed text-white/85 sm:text-lg">
                {t("hero.description")}
              </p>
              <Link href="/journals-info" className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-2xl bg-white px-5 py-2.5 text-sm font-semibold text-[#0b1024] transition-colors hover:bg-[#eef1ff]">
                {t("hero.catalog")} <ArrowRight aria-hidden className="size-4 shrink-0" />
              </Link>
            </div>
            <Image
              src={`${SHOWCASE_SCREENS_DIR}/journals-desktop.webp`}
              alt={t("hero.imageAlt")}
              width={1440}
              height={900}
              loading="eager"
              sizes="(min-width: 1200px) 512px, (min-width: 1024px) 44vw, (min-width: 640px) 82vw, 90vw"
              className="h-auto w-full rounded-2xl border border-white/20 shadow-2xl"
            />
          </div>
        </header>

        <section aria-labelledby="about-workflow" className="mt-12 sm:mt-16">
          <h2 id="about-workflow" className="text-2xl font-semibold tracking-tight sm:text-3xl">{t("workflow.title")}</h2>
          <p className="mt-3 max-w-[70ch] leading-relaxed text-[#3c4053]">{t("workflow.description")}</p>
          <ol className="mt-6 grid gap-4 md:grid-cols-3">
            {workflow.map(({ key, icon: Icon }) => (
              <li key={key} className="rounded-3xl border border-[#ececf4] bg-[#fafbff] p-6">
                <div className="mb-4 flex size-10 items-center justify-center rounded-xl bg-[#eef1ff] text-[#3848c7]">
                  <Icon aria-hidden className="size-5" />
                </div>
                <h3 className="text-lg font-semibold tracking-tight">{t(`workflow.${key}.title`)}</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-[#3c4053]">{t(`workflow.${key}.description`)}</p>
              </li>
            ))}
          </ol>
          <Link href="/features" className="mt-3 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-[#3848c7] hover:underline">
            {chrome("features")} <ArrowRight aria-hidden className="size-4" />
          </Link>
        </section>

        <div className="mt-10 grid gap-5 lg:grid-cols-2">
          <section aria-labelledby="about-journals" className="rounded-3xl border border-[#ececf4] px-5 py-6 sm:p-8">
            <h2 id="about-journals" className="text-2xl font-semibold tracking-tight">{t("journals.title")}</h2>
            <p className="mt-3 text-[15px] leading-relaxed text-[#3c4053]">{t("journals.description")}</p>
            <ul className="mt-4 divide-y divide-[#ececf4]">
              {journals.map(({ key, code }) => (
                <li key={code}>
                  <Link href={`/journals-info/${code}`} className="flex min-h-11 items-center justify-between gap-2 py-2 text-[15px] font-medium text-[#3848c7] hover:underline">
                    {t(`journals.${key}`)} <ArrowRight aria-hidden className="size-4 shrink-0" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="about-company" className="rounded-3xl border border-[#ececf4] bg-[#fafbff] px-5 py-6 sm:p-8">
            <h2 id="about-company" className="text-2xl font-semibold tracking-tight">{t("company.title")}</h2>
            <p className="mt-3 text-[15px] leading-relaxed text-[#3c4053]">{t("company.description")}</p>
            <address className="mt-4 text-sm not-italic leading-relaxed">
              <p className="font-semibold">{company.legalName}</p>
              <p>{chrome("companyTaxIds", { inn: company.inn, kpp: company.kpp })}</p>
              <p>{chrome("companyRegistrationId", { ogrn: company.ogrn })}</p>
              <div className="mt-2 flex flex-wrap gap-x-5">
                <a href={`mailto:${COMPANY_EMAIL}`} className="inline-flex min-h-11 items-center text-[#3848c7] hover:underline">{COMPANY_EMAIL}</a>
                <a href={`tel:${COMPANY_PHONE.tel}`} className="inline-flex min-h-11 items-center text-[#3848c7] hover:underline">{COMPANY_PHONE.display}</a>
                <a href={COMPANY_TELEGRAM.url} className="inline-flex min-h-11 items-center text-[#3848c7] hover:underline">Telegram</a>
              </div>
            </address>
            <Link href="/privacy" className="inline-flex min-h-11 items-center text-sm font-medium text-[#3848c7] hover:underline">
              {chrome("privacyPolicy")}
            </Link>
            <GooglePlayAuthorizationCard
              compact
              copy={{
                heading: t("googlePlayAuth.heading"),
                statement: t("googlePlayAuth.statement"),
                signatureAlt: t("googlePlayAuth.signatureAlt"),
                pageLinkLabel: t("googlePlayAuth.pageLinkLabel"),
                pdfLinkLabel: t("googlePlayAuth.pdfLinkLabel"),
              }}
            />
          </section>
        </div>

        <section aria-labelledby="about-start" className="mt-10 flex flex-wrap items-center justify-between gap-5 rounded-3xl border border-[#ececf4] bg-[#fafbff] px-5 py-6 sm:p-8">
          <div>
            <h2 id="about-start" className="text-2xl font-semibold tracking-tight">{t("start.title")}</h2>
            <p className="mt-2 max-w-[64ch] text-[15px] leading-relaxed text-[#3c4053]">{t("start.description")}</p>
          </div>
          <Link href="/register" className="inline-flex min-h-11 items-center gap-2 rounded-2xl bg-[#3848c7] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#4a5bf0]">
            {t("start.action")} <ArrowRight aria-hidden className="size-4 shrink-0" />
          </Link>
        </section>
      </main>

      <PublicFooter />
    </div>
  );
}
