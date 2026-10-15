import type { Metadata } from "next";
import { createTranslator } from "use-intl/core";
import { JOURNAL_INFO } from "@/content/journal-info";
import { DEFAULT_TWITTER_CARD } from "@/lib/meta-defaults";
import { ogImages, twitterImages } from "@/lib/og-image";
import { loadMessages } from "./messages";
import type { Locale } from "./locales";
import { localizedHref, siteLanguageAlternates } from "./site-locale";

/** Metadata is derived from the request's resolved locale, without shared mutable state. */
export async function publicJournalIndexMetadata(locale: Locale): Promise<Metadata> {
  const messages = await loadMessages(locale);
  const t = createTranslator({ locale, messages, namespace: "publicJournalIndex.metadata" });
  const count = Object.keys(JOURNAL_INFO).length;
  const title = t("title", { count });
  const description = t("description", { count });
  const pathname = "/journals-info";
  const url = `https://wesetup.ru${localizedHref(pathname, locale)}`;
  const image = { title, subtitle: description, kind: "journal" as const, locale };
  return {
    title, description,
    alternates: { canonical: url, languages: siteLanguageAlternates(pathname) },
    openGraph: {
      type: "website", locale: { ru: "ru_RU", en: "en_GB", uz: "uz_UZ" }[locale], siteName: "WeSetup",
      url, title, description, images: ogImages(image),
    },
    twitter: { card: DEFAULT_TWITTER_CARD, title, description, images: twitterImages(image) },
  };
}
