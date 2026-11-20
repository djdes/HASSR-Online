import { bundledArticleTranslation } from "@/content/article-translations/catalog";
import type { Locale } from "@/i18n/locales";
import {
  localizeArticle,
  type ArticleTranslationContent,
} from "@/lib/article-localization";
import { isArticlePublished } from "@/lib/article-visibility";
import {
  invalidatePublicReviewsCache,
  listPublicReviews,
  type PublicReview,
} from "@/lib/balance/reviews";
import { db } from "@/lib/db";
import { STARTING_REWARD_RULE, type RewardRule } from "@/lib/partners/rewards";
import { getCurrentRewardRule } from "@/lib/partners/schema-extras";
import {
  pickActivePromotion,
  toAppliedPromotion,
  type AppliedPromotion,
} from "@/lib/promo/promotions";
import { readServices } from "@/lib/services/catalog";
import {
  DEFAULT_SERVICES,
  SERVICE_CATEGORY_ORDER,
  type PlatformServiceItem,
  type ServiceCategory,
} from "@/lib/services/constants";
import {
  fallbackTariffs,
  invalidateTariffsCache,
  planPricingFrom,
  readTariffs,
  type PlanPricing,
  type Tariff,
} from "@/lib/tariffs";

import {
  inspectPromoSnapshots,
  readOrBuildPromoSnapshot,
  writePromoSnapshotFile,
  type PromoSnapshotStatus,
} from "./store";

export const PROMO_DATASETS = [
  "tariffs",
  "promotions",
  "public-reviews",
  "journal-usage",
  "partner-reward-rule",
  "services",
  "blog-articles",
  "translation-overrides",
] as const;

export type PromoDatasetName = (typeof PROMO_DATASETS)[number];

export type CachedPromotionRecord = {
  id: string;
  title: string;
  percent: number;
  startsAt: string;
  endsAt: string;
  active: boolean;
};

export type CachedBlogArticleRecord = {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  body: unknown;
  coverIcon: string | null;
  tags: string[];
  readMinutes: number;
  publishedAt: string;
  updatedAt: string;
  translations: ArticleTranslationContent[];
};

export type HydratedBlogArticle = Omit<CachedBlogArticleRecord, "publishedAt" | "updatedAt"> & {
  publishedAt: Date;
  updatedAt: Date;
};

export type LocalizedPromoBlogArticle = ReturnType<typeof localizeArticle<HydratedBlogArticle>>;

export type CachedTranslationOverride = {
  locale: string;
  key: string;
  value: string;
};

type CacheReadOptions = { dir?: string };

const MAX_CACHED_PUBLIC_REVIEWS = 24;

// ---------------------------------------------------------------------------
// Fresh DB builders (used ONLY by refresh / cold-bootstrap, NEVER on warm hits)
// ---------------------------------------------------------------------------

async function buildTariffsSnapshot(): Promise<Tariff[]> {
  invalidateTariffsCache();
  return readTariffs();
}

async function buildPromotionsSnapshot(now = new Date()): Promise<CachedPromotionRecord[]> {
  const rows = await db.pricePromotion.findMany({
    where: { active: true, endsAt: { gt: now } },
    orderBy: [{ startsAt: "asc" }, { id: "asc" }],
    select: { id: true, title: true, percent: true, startsAt: true, endsAt: true, active: true },
  });
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    percent: row.percent,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    active: row.active,
  }));
}

async function buildPublicReviewsSnapshot(): Promise<PublicReview[]> {
  invalidatePublicReviewsCache();
  return listPublicReviews(MAX_CACHED_PUBLIC_REVIEWS);
}

async function buildJournalUsageSnapshot(): Promise<Record<string, number>> {
  const platformOrgId = process.env.PLATFORM_ORG_ID || "platform";
  const [templates, grouped] = await Promise.all([
    db.journalTemplate.findMany({ select: { id: true, code: true } }),
    db.journalDocument.groupBy({
      by: ["templateId", "organizationId"],
      where: {
        organization: { isDemo: false, id: { not: platformOrgId } },
      },
    }),
  ]);
  const codeById = new Map(templates.map((t) => [t.id, t.code]));
  const counts: Record<string, number> = {};
  for (const row of grouped) {
    const code = codeById.get(row.templateId);
    if (!code) continue;
    counts[code] = (counts[code] ?? 0) + 1;
  }
  return counts;
}

async function buildPartnerRewardRuleSnapshot(): Promise<RewardRule> {
  return getCurrentRewardRule();
}

async function buildServicesSnapshot(): Promise<PlatformServiceItem[]> {
  return readServices();
}

async function buildBlogArticlesSnapshot(): Promise<CachedBlogArticleRecord[]> {
  const rows = await db.article.findMany({
    where: { publishedAt: { not: null } },
    orderBy: { publishedAt: "desc" },
    select: {
      id: true,
      slug: true,
      title: true,
      excerpt: true,
      body: true,
      coverIcon: true,
      tags: true,
      readMinutes: true,
      publishedAt: true,
      updatedAt: true,
      translations: {
        select: {
          locale: true,
          sourceHash: true,
          title: true,
          excerpt: true,
          body: true,
          tags: true,
        },
      },
    },
  });
  return rows
    .filter((row): row is typeof row & { publishedAt: Date } => row.publishedAt instanceof Date)
    .map((row) => ({
      id: row.id,
      slug: row.slug,
      title: row.title,
      excerpt: row.excerpt,
      body: row.body,
      coverIcon: row.coverIcon,
      tags: [...row.tags],
      readMinutes: row.readMinutes,
      publishedAt: row.publishedAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      translations: row.translations.map((tr) => ({
        locale: tr.locale,
        sourceHash: tr.sourceHash,
        title: tr.title,
        excerpt: tr.excerpt,
        body: tr.body,
        tags: [...tr.tags],
      })),
    }));
}

async function buildTranslationOverridesSnapshot(): Promise<CachedTranslationOverride[]> {
  const rows = await db.translationOverride.findMany({
    select: { locale: true, key: true, value: true },
    orderBy: [{ locale: "asc" }, { key: "asc" }],
  });
  return rows.map((row) => ({ locale: row.locale, key: row.key, value: row.value }));
}

function defaultServicesFallback(): PlatformServiceItem[] {
  return DEFAULT_SERVICES.map((row) => ({
    ...row,
    category: (SERVICE_CATEGORY_ORDER as string[]).includes(row.category)
      ? (row.category as ServiceCategory)
      : "consult",
  }));
}

// ---------------------------------------------------------------------------
// Zero-SELECT Readers for Promotional Pages
// ---------------------------------------------------------------------------

export async function readPromoTariffs(options?: CacheReadOptions): Promise<Tariff[]> {
  const rows = await readOrBuildPromoSnapshot<Tariff[]>({
    dataset: "tariffs",
    dir: options?.dir,
    build: buildTariffsSnapshot,
    fallback: fallbackTariffs,
  });
  return rows.map((t) => ({ ...t }));
}

export async function readPromoPlanPricing(options?: CacheReadOptions): Promise<PlanPricing> {
  return planPricingFrom(await readPromoTariffs(options));
}

export async function readPromoActivePromotion(
  now: Date = new Date(),
  options?: CacheReadOptions,
): Promise<AppliedPromotion | null> {
  const records = await readOrBuildPromoSnapshot<CachedPromotionRecord[]>({
    dataset: "promotions",
    dir: options?.dir,
    build: () => buildPromotionsSnapshot(now),
    fallback: () => [],
  });
  const hydrated = records.map((r) => ({
    id: r.id,
    title: r.title,
    percent: r.percent,
    startsAt: new Date(r.startsAt),
    endsAt: new Date(r.endsAt),
    active: r.active,
  }));
  const best = pickActivePromotion(hydrated, now);
  return best ? toAppliedPromotion(best) : null;
}

export async function readPromoPublicReviews(
  limit = 12,
  options?: CacheReadOptions,
): Promise<PublicReview[]> {
  const rows = await readOrBuildPromoSnapshot<PublicReview[]>({
    dataset: "public-reviews",
    dir: options?.dir,
    build: buildPublicReviewsSnapshot,
    fallback: () => [],
  });
  return rows.slice(0, Math.max(0, limit));
}

export async function readPromoJournalUsageCount(
  code: string,
  options?: CacheReadOptions,
): Promise<number> {
  const map = await readOrBuildPromoSnapshot<Record<string, number>>({
    dataset: "journal-usage",
    dir: options?.dir,
    build: buildJournalUsageSnapshot,
    fallback: () => ({}),
  });
  return map[code] ?? 0;
}

export async function readPromoPartnerRewardRule(
  options?: CacheReadOptions,
): Promise<RewardRule> {
  return readOrBuildPromoSnapshot<RewardRule>({
    dataset: "partner-reward-rule",
    dir: options?.dir,
    build: buildPartnerRewardRuleSnapshot,
    fallback: () => ({ ...STARTING_REWARD_RULE }),
  });
}

export async function readPromoActiveServices(
  options?: CacheReadOptions,
): Promise<PlatformServiceItem[]> {
  const all = await readOrBuildPromoSnapshot<PlatformServiceItem[]>({
    dataset: "services",
    dir: options?.dir,
    build: buildServicesSnapshot,
    fallback: defaultServicesFallback,
  });
  return all.filter((item) => item.active);
}

function hydrateArticle(record: CachedBlogArticleRecord): HydratedBlogArticle {
  return {
    ...record,
    publishedAt: new Date(record.publishedAt),
    updatedAt: new Date(record.updatedAt),
  };
}

function localizeHydratedArticle(
  article: HydratedBlogArticle,
  locale: Locale,
): LocalizedPromoBlogArticle {
  const bundled = bundledArticleTranslation(article.slug, locale);
  const candidates = bundled
    ? [...article.translations, bundled]
    : article.translations;
  return localizeArticle(article, candidates, locale);
}

export async function readPromoBlogSnapshot(
  options?: CacheReadOptions,
): Promise<HydratedBlogArticle[]> {
  const records = await readOrBuildPromoSnapshot<CachedBlogArticleRecord[]>({
    dataset: "blog-articles",
    dir: options?.dir,
    build: buildBlogArticlesSnapshot,
    fallback: () => [],
  });
  return records
    .map(hydrateArticle)
    .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());
}

export async function readPromoPublishedArticles(
  locale: Locale,
  now: Date = new Date(),
  options?: CacheReadOptions,
): Promise<LocalizedPromoBlogArticle[]> {
  const all = await readPromoBlogSnapshot(options);
  return all
    .filter((a) => isArticlePublished(a.publishedAt, now))
    .map((a) => localizeHydratedArticle(a, locale));
}

export async function readPromoSitemapArticles(
  now: Date = new Date(),
  options?: CacheReadOptions,
): Promise<HydratedBlogArticle[]> {
  const all = await readPromoBlogSnapshot(options);
  return all.filter((a) => isArticlePublished(a.publishedAt, now));
}

export async function readPromoBlogArticleDetail(
  slug: string,
  locale: Locale,
  now: Date = new Date(),
  options?: CacheReadOptions,
): Promise<{
  source: HydratedBlogArticle;
  article: LocalizedPromoBlogArticle;
  related: LocalizedPromoBlogArticle[];
} | null> {
  const all = await readPromoBlogSnapshot(options);
  const source = all.find((a) => a.slug === slug);
  if (!source || !isArticlePublished(source.publishedAt, now)) {
    return null;
  }
  const article = localizeHydratedArticle(source, locale);
  const currentTags = new Set(article.tags.map((t) => t.toLowerCase()));
  const related = all
    .filter((r) => r.slug !== slug && isArticlePublished(r.publishedAt, now))
    .slice(0, 30)
    .map((r) => {
      const overlap = r.tags.reduce(
        (acc, t) => (currentTags.has(t.toLowerCase()) ? acc + 1 : acc),
        0,
      );
      return { item: r, overlap };
    })
    .sort((a, b) => {
      if (b.overlap !== a.overlap) return b.overlap - a.overlap;
      return b.item.publishedAt.getTime() - a.item.publishedAt.getTime();
    })
    .slice(0, 3)
    .map(({ item }) => localizeHydratedArticle(item, locale));

  return { source, article, related };
}

export async function readPromoTranslationOverrides(
  options?: CacheReadOptions,
): Promise<CachedTranslationOverride[]> {
  return readOrBuildPromoSnapshot<CachedTranslationOverride[]>({
    dataset: "translation-overrides",
    dir: options?.dir,
    build: buildTranslationOverridesSnapshot,
    fallback: () => [],
  });
}

// ---------------------------------------------------------------------------
// Explicit Refresh & Invalidation Hooks
// ---------------------------------------------------------------------------

export type PromoDatasetRefreshSummary = {
  dataset: PromoDatasetName;
  generatedAt: string;
  itemCount: number;
};

export async function refreshPromoDataset(
  dataset: PromoDatasetName,
  options?: { dir?: string; now?: Date },
): Promise<PromoDatasetRefreshSummary> {
  const now = options?.now ?? new Date();
  switch (dataset) {
    case "tariffs": {
      const data = await buildTariffsSnapshot();
      const env = await writePromoSnapshotFile(dataset, data, { dir: options?.dir, now });
      return { dataset, generatedAt: env.generatedAt, itemCount: data.length };
    }
    case "promotions": {
      const data = await buildPromotionsSnapshot(now);
      const env = await writePromoSnapshotFile(dataset, data, { dir: options?.dir, now });
      return { dataset, generatedAt: env.generatedAt, itemCount: data.length };
    }
    case "public-reviews": {
      const data = await buildPublicReviewsSnapshot();
      const env = await writePromoSnapshotFile(dataset, data, { dir: options?.dir, now });
      return { dataset, generatedAt: env.generatedAt, itemCount: data.length };
    }
    case "journal-usage": {
      const data = await buildJournalUsageSnapshot();
      const env = await writePromoSnapshotFile(dataset, data, { dir: options?.dir, now });
      return { dataset, generatedAt: env.generatedAt, itemCount: Object.keys(data).length };
    }
    case "partner-reward-rule": {
      const data = await buildPartnerRewardRuleSnapshot();
      const env = await writePromoSnapshotFile(dataset, data, { dir: options?.dir, now });
      return { dataset, generatedAt: env.generatedAt, itemCount: 1 };
    }
    case "services": {
      const data = await buildServicesSnapshot();
      const env = await writePromoSnapshotFile(dataset, data, { dir: options?.dir, now });
      return { dataset, generatedAt: env.generatedAt, itemCount: data.length };
    }
    case "blog-articles": {
      const data = await buildBlogArticlesSnapshot();
      const env = await writePromoSnapshotFile(dataset, data, { dir: options?.dir, now });
      return { dataset, generatedAt: env.generatedAt, itemCount: data.length };
    }
    case "translation-overrides": {
      const data = await buildTranslationOverridesSnapshot();
      const env = await writePromoSnapshotFile(dataset, data, { dir: options?.dir, now });
      return { dataset, generatedAt: env.generatedAt, itemCount: data.length };
    }
  }
}

export async function refreshAllPromoDatasets(options?: {
  dir?: string;
  now?: Date;
  datasets?: readonly PromoDatasetName[];
}): Promise<PromoDatasetRefreshSummary[]> {
  const list = options?.datasets ?? PROMO_DATASETS;
  const summaries: PromoDatasetRefreshSummary[] = [];
  for (const dataset of list) {
    summaries.push(await refreshPromoDataset(dataset, options));
  }
  return summaries;
}

/**
 * Non-blocking refresh triggered from synchronous invalidation helpers
 * (`invalidateTariffsCache`, `invalidatePromotionCache`, etc.).
 * Skips automatic background DB connection during `node --test` unless
 * `PROMO_CACHE_DIR` is explicitly under test.
 */
export function schedulePromoDatasetRefresh(dataset: PromoDatasetName): void {
  if (process.env.NODE_TEST_CONTEXT && !process.env.PROMO_CACHE_DIR) {
    return;
  }
  if (!process.env.DATABASE_URL) {
    return;
  }
  void refreshPromoDataset(dataset).catch((error) => {
    console.error(`[promo-cache] background refresh failed for ${dataset}`, error);
  });
}

export async function getPromoCacheStatus(options?: {
  dir?: string;
}): Promise<PromoSnapshotStatus[]> {
  return inspectPromoSnapshots(PROMO_DATASETS, options);
}
