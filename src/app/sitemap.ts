import type { MetadataRoute } from "next";
import { db } from "@/lib/db";
import { JOURNAL_INFO } from "@/content/journal-info";
import { FEATURES_ORDER } from "@/content/features";
import { NICHES } from "@/components/landing/niche-landing";
import { SEO_LANDINGS } from "@/components/landing/seo-journal-landing";
import { CITY_ORDER } from "@/content/cities";
import { COMPARISON_ORDER } from "@/content/comparisons";
import { GLOSSARY } from "@/content/glossary";
import { publicLocaleRoute, publicLocalesForPath, localizedHref, siteLanguageAlternates } from "@/i18n/site-locale";
import { articleLanguageAlternates } from "@/lib/article-language-alternates";

/**
 * Dynamic sitemap for crawlers. Combines:
 * - Static public pages (landing, blog list, journals-info list)
 * - All 34 /journals-info/[code] entries
 * - /features index + 8 /features/[slug] entries
 * - Every published blog article
 *
 * Rebuilt on each request because `dynamic = "force-dynamic"` is set
 * across the app — sitemap would otherwise cache stale article lists.
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

const SITE = "https://wesetup.ru";
const now = new Date();

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const articles = await db.article
    .findMany({
      where: { publishedAt: { not: null } },
      select: { slug: true, publishedAt: true, updatedAt: true, title: true, excerpt: true, body: true, tags: true, translations: true },
      orderBy: { publishedAt: "desc" },
    })
    .catch(() => []);

  const staticPages: MetadataRoute.Sitemap = [
    { url: `${SITE}/`, lastModified: now, changeFrequency: "weekly", priority: 1.0 },
    { url: `${SITE}/blog`, lastModified: now, changeFrequency: "weekly", priority: 0.8 },
    { url: `${SITE}/journals-info`, lastModified: now, changeFrequency: "monthly", priority: 0.9 },
    // Хаб бланков: закрывает запросы «журнал X бланк скачать». Сами
    // файлы лежат под /api/ и закрыты в robots.ts — это намеренно,
    // иначе в выдачу попадал бы PDF вместо страницы.
    { url: `${SITE}/blanki`, lastModified: now, changeFrequency: "monthly", priority: 0.9 },
    { url: `${SITE}/prikazy`, lastModified: now, changeFrequency: "monthly", priority: 0.9 },
    { url: `${SITE}/uslugi`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: `${SITE}/whats-new`, lastModified: now, changeFrequency: "weekly", priority: 0.6 },
    { url: `${SITE}/developers`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    // Индекс возможностей: до 2026-09-08 страницы `/features` не
    // существовало (были только детальные `/features/[slug]`), и ссылка
    // с /pricing вела в 404.
    { url: `${SITE}/features`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    // /pricing — высоко-конверсионная страница (ROI калькулятор + тарифы),
    // высокий приоритет для индексации. Раньше отсутствовала в sitemap'е.
    { url: `${SITE}/pricing`, lastModified: now, changeFrequency: "monthly", priority: 0.85 },
    { url: `${SITE}/partners`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    // /login и /register в sitemap не входят: это служебные экраны без
    // контента под запрос. Их присутствие размывает краулинговый бюджет
    // и тянет вниз среднее качество набора страниц. Индексации они не
    // требуют — вход всегда происходит по прямой ссылке или из шапки.
    { url: `${SITE}/oferta`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
    { url: `${SITE}/privacy`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
    { url: `${SITE}/terms`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
    { url: `${SITE}/consent`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
  ];

  const journalPages: MetadataRoute.Sitemap = Object.keys(JOURNAL_INFO).map(
    (code) => ({
      url: `${SITE}/journals-info/${code}`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.75,
    })
  );

  const featurePages: MetadataRoute.Sitemap = FEATURES_ORDER.map((slug) => ({
    url: `${SITE}/features/${slug}`,
    lastModified: now,
    changeFrequency: "monthly",
    priority: 0.65,
  }));

  const articlePages: MetadataRoute.Sitemap = articles.map((a) => ({
    url: `${SITE}/blog/${a.slug}`,
    lastModified: a.updatedAt ?? a.publishedAt ?? now,
    changeFrequency: "monthly",
    priority: 0.6,
    alternates: { languages: articleLanguageAlternates(a, a.translations) },
  }));

  // E19 — niche-лендинги (/dlya-kafe, /dlya-bara, /dlya-otelya, /dlya-azs
  // и т.д.). Итерируем весь словарь NICHES, поэтому новые сферы
  // (посадочные /dlya-*) попадают в sitemap автоматически при добавлении
  // записи в NICHES — отдельно перечислять URL не нужно.
  const nichePages: MetadataRoute.Sitemap = Object.keys(NICHES).map((slug) => ({
    url: `${SITE}/${slug}`,
    lastModified: now,
    changeFrequency: "monthly",
    priority: 0.85,
  }));

  // E17 — SEO-лендинги под ключевые запросы (журнал ХАССП и т.д.)
  const seoPages: MetadataRoute.Sitemap = Object.keys(SEO_LANDINGS).map(
    (slug) => ({
      url: `${SITE}/${slug}`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.85,
    }),
  );

  // Контентные SEO-страницы: города, глоссарий, сравнения, калькуляторы.
  const contentPages: MetadataRoute.Sitemap = [
    { url: `${SITE}/glossary`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    ...GLOSSARY.map((t) => ({ url: `${SITE}/glossary/${t.slug}`, lastModified: now, changeFrequency: "yearly" as const, priority: 0.5 })),
    { url: `${SITE}/compare`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    ...COMPARISON_ORDER.map((slug) => ({ url: `${SITE}/compare/${slug}`, lastModified: now, changeFrequency: "monthly" as const, priority: 0.75 })),
    { url: `${SITE}/calc/journals`, lastModified: now, changeFrequency: "monthly", priority: 0.75 },
    { url: `${SITE}/calc/fines`, lastModified: now, changeFrequency: "monthly", priority: 0.75 },
    ...CITY_ORDER.map((slug) => ({ url: `${SITE}/v/${slug}`, lastModified: now, changeFrequency: "monthly" as const, priority: 0.7 })),
  ];

  const pages: MetadataRoute.Sitemap = [
    ...staticPages,
    ...journalPages,
    ...featurePages,
    ...articlePages,
    ...nichePages,
    ...seoPages,
    ...contentPages,
  ];
  return pages.flatMap((page) => {
    const pathname = new URL(page.url).pathname;
    if (!publicLocaleRoute(pathname)) return [page];
    const alternates = page.alternates ?? { languages: siteLanguageAlternates(pathname) };
    return publicLocalesForPath(pathname)
      .filter(locale => Boolean(alternates.languages?.[locale]))
      .map(locale => ({ ...page, url: `${SITE}${localizedHref(pathname, locale)}`, alternates }));
  });
}
