import { bundledArticleTranslation } from "@/content/article-translations/catalog";
import { isCurrentArticleTranslation, type ArticleSource, type ArticleTranslationContent } from "./article-localization";
import { localizedHref } from "@/i18n/site-locale";

/** Advertise only current translations; a newly edited article may have fewer alternates. */
export function articleLanguageAlternates(source: ArticleSource & { slug: string }, translations: readonly ArticleTranslationContent[]) {
  const path = `/blog/${source.slug}`;
  const result: Record<string, string> = { ru: `https://wesetup.ru${path}`, "x-default": `https://wesetup.ru${path}` };
  for (const locale of ["en", "uz"] as const) {
    const bundled = bundledArticleTranslation(source.slug, locale);
    if ([...translations, ...(bundled ? [bundled] : [])].some(item => isCurrentArticleTranslation(source, item, locale))) {
      result[locale] = `https://wesetup.ru${localizedHref(path, locale)}`;
    }
  }
  return result;
}
