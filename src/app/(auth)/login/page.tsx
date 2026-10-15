import LoginClient from "./login-client";
import { getSiteLocale } from "@/i18n/site-locale-server";
import { siteLanguageAlternates, localizedHref } from "@/i18n/site-locale";
import { translatorFor } from "@/i18n/translator";
import { MiniShellReset } from "@/components/layout/mini-shell-reset";
import {
  DEFAULT_OG_IMAGES,
  DEFAULT_TWITTER_CARD,
  DEFAULT_TWITTER_IMAGES,
} from "@/lib/meta-defaults";

const TITLE = "Вход в кабинет";
const DESC =
  "Вход в личный кабинет WeSetup. Электронные журналы СанПиН и ХАССП для общепита и пищевых производств.";
const URL = "https://wesetup.ru/login";

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
  const title = t("auth.metadata.loginTitle");
  const description = t("auth.metadata.loginDescription");
  const url = `https://wesetup.ru${localizedHref("/login", locale)}`;
  return {
    ...russianMetadata, title, description,
    alternates: { canonical: url, languages: siteLanguageAlternates("/login") },
    openGraph: { ...russianMetadata.openGraph, title, description, url, locale: { ru: "ru_RU", en: "en_US", uz: "uz_UZ" }[locale], images: locale === "en" ? ["https://wesetup.ru/og/english"] : DEFAULT_OG_IMAGES },
    twitter: { ...russianMetadata.twitter, title, description, images: locale === "en" ? ["https://wesetup.ru/og/english"] : DEFAULT_TWITTER_IMAGES },
  };
}

export default function LoginPage() {
  return (
    <>
      {/* Дошли до формы с паролем — значит это обычный браузер, а не
          Telegram: режим мобильной оболочки снимаем. */}
      <MiniShellReset />
      <LoginClient />
    </>
  );
}
