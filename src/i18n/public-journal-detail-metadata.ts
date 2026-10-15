import type { Metadata } from "next";
import { DEFAULT_TWITTER_CARD } from "@/lib/meta-defaults";
import { ogImages, twitterImages } from "@/lib/og-image";
import { loadMessages } from "./messages";
import type { Locale } from "./locales";
import { localizedHref, siteLanguageAlternates } from "./site-locale";
import { presentPublicJournalDetail } from "./public-journal-detail-presentation";

export async function publicJournalDetailMetadata(locale: Locale, code: string): Promise<Metadata> {
  const messages = await loadMessages(locale);
  const detail = presentPublicJournalDetail(messages, locale, code);
  if (!detail) return { title: { absolute: messages.publicJournalIndex.detailCommon.notFoundTitle } };
  const { info, seo } = detail;
  const title = seo?.title ?? info.tagline;
  const description = seo?.description ?? info.why;
  const pathname = `/journals-info/${code}`;
  const url = `https://wesetup.ru${localizedHref(pathname, locale)}`;
  const image = { title, subtitle: description, kind: "journal" as const, locale };
  return {
    title, description, keywords: seo?.keywords,
    alternates: { canonical: url, languages: siteLanguageAlternates(pathname) },
    openGraph: {
      title, description, url, type: "article", siteName: "WeSetup",
      locale: { ru: "ru_RU", en: "en_GB", uz: "uz_UZ" }[locale], images: ogImages(image),
    },
    twitter: { card: DEFAULT_TWITTER_CARD, title, description, images: twitterImages(image) },
  };
}
