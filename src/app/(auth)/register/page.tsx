import RegisterClient from "./register-client";
import { getSiteLocale } from "@/i18n/site-locale-server";
import { siteLanguageAlternates, localizedHref } from "@/i18n/site-locale";
import { translatorFor } from "@/i18n/translator";
import { TRIAL_DAYS } from "@/lib/tariff-plans";
import {
  DEFAULT_OG_IMAGES,
  DEFAULT_TWITTER_CARD,
  DEFAULT_TWITTER_IMAGES,
} from "@/lib/meta-defaults";
import { JOURNALS_TOTAL_ELECTRONIC_LABEL } from "@/lib/journal-catalog";
import { FREE_TIER_SHORT } from "@/lib/plan-catalog";
import { discountLabel } from "@/lib/promo/discounts";
import { promoLinkStatus } from "@/lib/promo/personal-codes";
import { linkSphere } from "@/lib/promo/personal-link";

const TITLE = "Регистрация организации";
const DESC =
  `Создайте аккаунт WeSetup за 5 минут: ${FREE_TIER_SHORT}, без карты. Все ${JOURNALS_TOTAL_ELECTRONIC_LABEL} СанПиН и ХАССП включены.`;
const URL = "https://wesetup.ru/register";

const russianMetadata = {
  title: TITLE,
  description: DESC,
  alternates: { canonical: URL },
  openGraph: {
    type: "website",
    locale: "ru_RU",
    siteName: "WeSetup",
    url: URL,
    title: TITLE,
    description: DESC,
    images: DEFAULT_OG_IMAGES,
  },
  twitter: {
    card: DEFAULT_TWITTER_CARD,
    title: TITLE,
    description: DESC,
    images: DEFAULT_TWITTER_IMAGES,
  },
};

export async function generateMetadata() {
  const locale = await getSiteLocale();
  const t = await translatorFor(locale);
  const title = t("auth.metadata.registerTitle");
  const description = t("auth.metadata.registerDescription", { trialDays: TRIAL_DAYS });
  const url = `https://wesetup.ru${localizedHref("/register", locale)}`;
  return {
    ...russianMetadata, title, description,
    alternates: { canonical: url, languages: siteLanguageAlternates("/register") },
    openGraph: { ...russianMetadata.openGraph, title, description, url, locale: { ru: "ru_RU", en: "en_US", uz: "uz_UZ" }[locale], images: locale === "en" ? ["https://wesetup.ru/og/english"] : DEFAULT_OG_IMAGES },
    twitter: { ...russianMetadata.twitter, title, description, images: locale === "en" ? ["https://wesetup.ru/og/english"] : DEFAULT_TWITTER_IMAGES },
  };
}

/**
 * Пришли по ссылке с промокодом (/promo/CODE?s=cafe → /register?promo=…&s=…):
 * сферу подставляем в форму, промокод показываем плашкой — применится на
 * оплате после регистрации. Код проверяем здесь (адресу не доверяем):
 * не действует — плашки нет.
 */
export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const locale = await getSiteLocale();
  const params = await searchParams;
  const pick = (key: string) => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };
  const sphere = linkSphere(pick("s"));
  const code = pick("promo")?.trim();
  const status = code ? await promoLinkStatus(code).catch(() => null) : null;
  const promo =
    status?.ok === true
      ? {
          code: status.promo.code,
          label: discountLabel({ source: "code", ...status.promo }, locale),
        }
      : null;
  if (code || sphere) {
    console.info(
      `[promo] register page: promo=${code ?? "-"} (${status ? (status.ok ? "ok" : status.reason) : "none"}) sphere=${sphere ?? "-"}`
    );
  }
  return <RegisterClient promo={promo} sphere={sphere} />;
}
