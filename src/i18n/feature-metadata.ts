import type { Metadata } from "next";
import { createTranslator } from "use-intl/core";
import { DEFAULT_TWITTER_CARD } from "@/lib/meta-defaults";
import { ogImages, twitterImages } from "@/lib/og-image";
import { loadMessages } from "./messages";
import type { Locale } from "./locales";
import { isFeatureSlug, presentFeature } from "./feature-presentation";
import { localizedHref, siteLanguageAlternates } from "./site-locale";

/** Explicit locale keeps public metadata independent of another visitor's preference. */
export async function featureMetadata(locale: Locale, slug?: string): Promise<Metadata> {
  const messages = await loadMessages(locale);
  const t = createTranslator({ locale, messages, namespace: "publicFeatures" });
  if (slug !== undefined && !isFeatureSlug(slug)) return { title: { absolute: t("detail.notFound") } };
  const feature = slug !== undefined && isFeatureSlug(slug) ? presentFeature(slug, messages) : null;
  const title = feature?.title ?? t("index.metadataTitle");
  const description = feature?.tagline ?? t("index.metadataDescription");
  const pathname = feature ? `/features/${feature.slug}` : "/features";
  const url = `https://wesetup.ru${localizedHref(pathname, locale)}`;
  const image = { title, subtitle: description, kind: "feature" as const, locale };
  return {
    title,
    description,
    alternates: { canonical: url, languages: siteLanguageAlternates(pathname) },
    openGraph: {
      type: "website", locale: { ru: "ru_RU", en: "en_GB", uz: "uz_UZ" }[locale], siteName: "WeSetup",
      url, title, description, images: ogImages(image),
    },
    twitter: { card: DEFAULT_TWITTER_CARD, title, description, images: twitterImages(image) },
  };
}
