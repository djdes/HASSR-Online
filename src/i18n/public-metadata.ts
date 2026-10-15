import type { Metadata } from "next";
import type { Locale } from "./locales";
import { localizedHref } from "./site-locale";
import { translatorFor } from "./translator";
import { JOURNALS_TOTAL } from "@/lib/journal-catalog";
import { FREE_MAX_USERS } from "@/lib/plan-limits";

export async function publicMetadataFor(locale: Locale): Promise<Metadata> {
  const t = await translatorFor(locale);
  const title = t("landing.metadata.title");
  const description = t("landing.metadata.description", { journalCount: JOURNALS_TOTAL, freeUsers: FREE_MAX_USERS });
  const image = { url: `https://wesetup.ru/og/landing/${locale}`, width: 1200, height: 630, alt: title };
  return {
    formatDetection: { telephone: false, date: false, email: false, address: false },
    metadataBase: new URL("https://wesetup.ru"),
    title: { default: title, template: "%s — WeSetup" },
    description,
    keywords: t("landing.metadata.keywords").split(",").map(value => value.trim()),
    alternates: { types: { "application/rss+xml": [
      { url: `https://wesetup.ru${localizedHref("/blog/feed.xml", locale)}`, title: t("landing.metadata.blogFeed") },
      { url: "https://wesetup.ru/whats-new/feed.xml", title: t("landing.metadata.updatesFeed") },
    ] } },
    applicationName: "WeSetup",
    authors: [{ name: "WeSetup" }],
    openGraph: { type: "website", locale: { ru: "ru_RU", en: "en_GB", uz: "uz_UZ" }[locale], url: `https://wesetup.ru${localizedHref("/", locale)}`, siteName: "WeSetup", title, description, images: [image] },
    twitter: { card: "summary_large_image", title, description, images: [image] },
    robots: { index: true, follow: true },
  };
}
