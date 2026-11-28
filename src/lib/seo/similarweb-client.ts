/**
 * Pure Similarweb payload parsers, cookie format parsers, and keyword-to-canonical-URL
 * mapper for WeSetup's SEO / GoGetLinks planner.
 *
 * Strictly enforces:
 * - No 301-merged slugs (`src/content/seo-redirects.ts` -> `seoRedirectTarget()`)
 * - No private post-registration workspace routes (`/sanpin`, `/journals`, `/dashboard`, `/orders`)
 * - Normalized percentages (both 0..1 ratios and 0..100 percentages handled cleanly)
 */

import type { StoredCookie } from "api-anything";
import { seoRedirectTarget } from "@/content/seo-redirects";
import type {
  ParsedSimilarwebCluster,
  ParsedSimilarwebCountryShare,
  ParsedSimilarwebReferralSite,
  ParsedSimilarwebSimilarSite,
  ParsedSimilarwebSnapshot,
  ParsedSimilarwebSubfolder,
  ParsedSimilarwebTelemetry,
  ParsedSimilarwebTopPage,
} from "@/lib/seo/gogetlinks-article-ai.server";
import {
  buildDefaultCandidateSitePages,
  type CandidateSitePage,
  normalizeDomainName,
  resolvePublicSeoTargetPath,
} from "@/lib/seo/gogetlinks-planner";

export type {
  ParsedSimilarwebCluster,
  ParsedSimilarwebCountryShare,
  ParsedSimilarwebReferralSite,
  ParsedSimilarwebSimilarSite,
  ParsedSimilarwebSnapshot,
  ParsedSimilarwebSubfolder,
  ParsedSimilarwebTelemetry,
  ParsedSimilarwebTopPage,
};

export interface SimilarwebConnectionStatus {
  configured: boolean;
  hasCookies: boolean;
  hasApiKey: boolean;
  cookieCount: number;
  cookieNames: string[];
  updatedAt: string | null;
  lastSyncedAt: string | null;
  lastError: string | null;
  operations: string[];
}

export interface SimilarwebSnapshotLike {
  id: string;
  domain: string;
  periodLabel: string;
  visitsMonthly: number;
  organicSharePct: number | null;
  paidSharePct: number | null;
  bouncePct: number | null;
  pagesPerVisit: number | null;
  clusters: unknown;
  sourceKind: string;
  createdAt?: string | Date | null;
}

export type CompetitorBenchmarkVerdict =
  | "leader"
  | "push_top3"
  | "gap_no_rank"
  | "need_links"
  | "parity";

export interface CompetitorClusterGapRow {
  phrase: string;
  mappedTargetUrl: string;
  competitorDomain: string;
  competitorVisitsMonthly: number;
  competitorTrafficSharePct: number;
  estimatedMonthlyTraffic: number;
  competitorChannel: "organic" | "paid";
  volume: number | null;
  cpcUsd: number | null;
  competitorUrl: string | null;
  competitorPos: number | null;
  changePct: number | null;
  isExclusiveToCompetitors: boolean;
  sharedWithDomainsCount: number;
  wesetupSharePct: number | null;
  yandexPos: number | null;
  googlePos: number | null;
  purchasedLinksCount: number;
  verdict: CompetitorBenchmarkVerdict;
  verdictLabel: string;
  recommendation: string;
}

export interface CompetitorDomainSummaryRow {
  domain: string;
  isWesetup: boolean;
  periodLabel: string;
  visitsMonthly: number;
  visitsTrendPct: number | null;
  visitsRatioVsWesetup: number;
  brandedSharePct: number | null;
  nonBrandedSharePct: number | null;
  organicSharePct: number | null;
  paidSharePct: number | null;
  directSharePct: number | null;
  referralsSharePct: number | null;
  socialSharePct: number | null;
  mailSharePct: number | null;
  displaySharePct: number | null;
  otherSharePct: number;
  estimatedOrganicVisits: number;
  estimatedPaidVisits: number;
  estimatedDirectVisits: number;
  estimatedReferralVisits: number;
  estimatedSocialVisits: number;
  estimatedOtherVisits: number;
  primaryChannelLabel: string;
  channelStrategySummary: string;
  bouncePct: number | null;
  pagesPerVisit: number | null;
  avgVisitDurationSec: number | null;
  avgVisitDurationFormatted: string | null;
  globalRank: number | null;
  countryRank: number | null;
  categoryRank: number | null;
  category: string | null;
  topReferrals: ParsedSimilarwebReferralSite[];
  similarSites: ParsedSimilarwebSimilarSite[];
  topPages: ParsedSimilarwebTopPage[];
  topSubfolders: ParsedSimilarwebSubfolder[];
  topCountries: ParsedSimilarwebCountryShare[];
  clustersCount: number;
  gapClustersCount: number;
  sourceKind: string;
}

export type SeoImprovementActionKind =
  | "push_top3_links"
  | "capture_paid_via_seo"
  | "create_or_expand_content"
  | "engagement_and_pf";

export interface SeoImprovementActionItem {
  id: string;
  priority: "high" | "medium";
  kind: SeoImprovementActionKind;
  badgeLabel: string;
  title: string;
  competitorDomain: string;
  targetUrl: string;
  keyword: string;
  potentialVisitsMonthly: number;
  volume: number | null;
  cpcUsd: number | null;
  yandexPos: number | null;
  googlePos: number | null;
  purchasedLinksCount: number;
  whyText: string;
  actionSteps: string[];
  ctaLabel: string;
  ctaHref: string;
}

export interface CompetitorBenchmarkReport {
  ownDomain: string;
  ownVisitsMonthly: number;
  domains: CompetitorDomainSummaryRow[];
  clusterGaps: CompetitorClusterGapRow[];
  actionPlan: SeoImprovementActionItem[];
  discoveredReferrals: Array<{
    domain: string;
    sharePct: number;
    targetCompetitors: string[];
  }>;
  discoveredSimilarSites: Array<{
    domain: string;
    affinityPct: number | null;
    alreadyTracked: boolean;
    sourceCompetitors: string[];
  }>;
  summary: {
    totalCompetitors: number;
    leaderVisitsDomain: string | null;
    leaderVisitsMonthly: number;
    totalTrackedKeywords: number;
    paidKeywordsCount: number;
    organicKeywordsCount: number;
    risingKeywordsCount: number;
    exclusiveKeywordsCount: number;
    gapNoRankCount: number;
    pushTop3Count: number;
    needLinksCount: number;
    leaderCount: number;
    totalPotentialMonthlyVisits: number;
  };
}

export interface ParsedSimilarwebKeywordRow {
  phrase: string;
  trafficSharePct: number;
  channel: "organic" | "paid";
  notes?: string;
  volume?: number | null;
  cpcUsd?: number | null;
  organicSharePct?: number | null;
  paidSharePct?: number | null;
  competitorUrl?: string | null;
  competitorPos?: number | null;
  changePct?: number | null;
}

export const SIMILARWEB_TELEMETRY_META_PHRASE = "__sw_meta__";

/**
 * Encodes `clusters` + `telemetry` into a JSON-compatible array for `SeoCompetitorSnapshot.clusters`
 * while staying 100% backwards-compatible with array readers.
 */
export function encodeSimilarwebClustersPayload(
  clusters: readonly ParsedSimilarwebCluster[],
  telemetry?: ParsedSimilarwebTelemetry | null,
): unknown[] {
  const cleanClusters = clusters.filter(
    (c) => c.phrase && c.phrase !== SIMILARWEB_TELEMETRY_META_PHRASE,
  );
  if (!telemetry) return [...cleanClusters];
  const hasTelemetryData = Object.values(telemetry).some((v) =>
    Array.isArray(v) ? v.length > 0 : v !== null && v !== undefined,
  );
  if (!hasTelemetryData) return [...cleanClusters];
  return [
    ...cleanClusters,
    {
      phrase: SIMILARWEB_TELEMETRY_META_PHRASE,
      trafficSharePct: 0,
      channel: "organic",
      mappedTargetUrl: "/journals-info",
      __swTelemetry: telemetry,
    },
  ];
}

/**
 * Decodes `SeoCompetitorSnapshot.clusters` (which may be a plain cluster array, an array with
 * a `__sw_meta__` telemetry entry, or an object `{ items, telemetry }`) into `{ clusters, telemetry }`.
 */
export function decodeSimilarwebClustersPayload(raw: unknown): {
  clusters: ParsedSimilarwebCluster[];
  telemetry: ParsedSimilarwebTelemetry;
} {
  const clusters: ParsedSimilarwebCluster[] = [];
  let telemetry: ParsedSimilarwebTelemetry = {};

  const rawList: unknown[] = Array.isArray(raw)
    ? raw
    : raw &&
        typeof raw === "object" &&
        Array.isArray((raw as { items?: unknown }).items)
      ? ((raw as { items: unknown[] }).items ?? [])
      : raw &&
          typeof raw === "object" &&
          Array.isArray((raw as { clusters?: unknown }).clusters)
        ? ((raw as { clusters: unknown[] }).clusters ?? [])
        : [];

  if (
    raw &&
    typeof raw === "object" &&
    !Array.isArray(raw) &&
    (raw as { telemetry?: unknown }).telemetry &&
    typeof (raw as { telemetry?: unknown }).telemetry === "object"
  ) {
    telemetry = {
      ...telemetry,
      ...((raw as { telemetry: ParsedSimilarwebTelemetry }).telemetry ?? {}),
    };
  }

  for (const item of rawList) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    if (
      rec.phrase === SIMILARWEB_TELEMETRY_META_PHRASE ||
      rec.__swTelemetry !== undefined
    ) {
      if (rec.__swTelemetry && typeof rec.__swTelemetry === "object") {
        telemetry = {
          ...telemetry,
          ...(rec.__swTelemetry as ParsedSimilarwebTelemetry),
        };
      }
      continue;
    }

    const phrase = typeof rec.phrase === "string" ? rec.phrase.trim() : "";
    if (!phrase) continue;

    const numOrNull = (v: unknown): number | null => {
      if (v === null || v === undefined || v === "") return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };

    clusters.push({
      phrase,
      trafficSharePct: Math.max(0, Number(rec.trafficSharePct ?? 0) || 0),
      channel: rec.channel === "paid" ? "paid" : "organic",
      mappedTargetUrl:
        typeof rec.mappedTargetUrl === "string" && rec.mappedTargetUrl.trim()
          ? rec.mappedTargetUrl.trim()
          : "/journals-info",
      ...(typeof rec.notes === "string" && rec.notes.trim()
        ? { notes: rec.notes.trim() }
        : {}),
      volume: numOrNull(rec.volume),
      cpcUsd: numOrNull(rec.cpcUsd),
      organicSharePct: numOrNull(rec.organicSharePct),
      paidSharePct: numOrNull(rec.paidSharePct),
      competitorUrl:
        typeof rec.competitorUrl === "string" && rec.competitorUrl.trim()
          ? rec.competitorUrl.trim()
          : null,
      competitorPos: numOrNull(rec.competitorPos),
      changePct: numOrNull(rec.changePct),
    });
  }

  return { clusters, telemetry };
}

export function formatDurationMmSs(secondsInput: number | null | undefined): string | null {
  if (
    secondsInput === null ||
    secondsInput === undefined ||
    !Number.isFinite(secondsInput) ||
    secondsInput <= 0
  ) {
    return null;
  }
  const totalSec = Math.round(secondsInput);
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

export const DEFAULT_COMPETITOR_NICHE_PHRASES: Readonly<
  Record<string, readonly string[]>
> = {
  "rushaccp.ru": [
    "разработка хассп для общепита",
    "программа производственного контроля общепит",
    "хассп журналы и их заполнение",
    "бракеражный журнал готовой продукции",
    "гигиенический журнал здоровья сотрудников",
    "журнал учета температуры и влажности",
    "приказы по хассп для общепита",
    "аудит хассп в ресторане и кафе",
    "штрафы роспотребнадзора общепит хассп",
    "журнал входного контроля сырья",
  ],
  "haccp-online.ru": [
    "хассп журналы и их заполнение",
    "бракеражный журнал готовой продукции",
    "журнал проведения генеральных уборок",
    "санпин",
    "журналы по хассп для пищевого производства",
    "гигиенический журнал сотрудников",
    "температурный лист холодильника",
    "журнал учета температуры и влажности",
    "журнал учета фритюрных жиров",
    "журнал учета дезсредств",
    "бактерицидный журнал уф ламп",
    "журнал входного контроля сырья",
  ],
  "checkoffice.ru": [
    "чек-лист приемки сырья в ресторане",
    "условия хранения продукции",
    "электронные чек-листы для общепита",
    "чек-лист открытия и закрытия ресторана",
    "чек-лист уборки помещений общепита",
    "проверка роспотребнадзора в общепите чек-лист",
    "контроль личной гигиены сотрудников общепита",
    "аудит пищевой безопасности хассп",
  ],
  "sanpin-obr.ru": [
    "санпин для общепита журналы",
    "журнал отбора суточных проб",
    "журнал здоровья детей",
    "гигиенический журнал сотрудников",
    "бракеражный журнал готовой продукции",
    "температурный лист холодильника",
    "бактерицидный журнал уф ламп",
  ],
  "norma-pb.ru": [
    "разработка хассп для общепита",
    "программа производственного контроля для кафе",
    "калькулятор журналов хассп",
    "журналы по хассп для пищевого производства",
    "аудит пищевой безопасности хассп",
  ],
};

export interface CompetitorSerpFallbackInput {
  domain: string;
  latestDate?: string | null;
  totalKeywords: number;
  rankedRows: ReadonlyArray<{
    phrase: string;
    position: number;
    url?: string | null;
  }>;
  sitemapPhrases?: readonly string[];
  candidatePages?: readonly CandidateSitePage[];
}

const CTR_WEIGHT_BY_POS = (pos: number): number => {
  if (pos === 1) return 28;
  if (pos === 2) return 18;
  if (pos === 3) return 12;
  if (pos <= 5) return 8;
  if (pos <= 10) return 4.5;
  if (pos <= 20) return 1.8;
  if (pos <= 30) return 0.9;
  return 0.35;
};

/**
 * Builds an automated competitor snapshot from live Topvisor SERP competitor positions
 * and/or public sitemap headings when direct Similarweb requests are blocked by CloudFront WAF.
 */
export function buildCompetitorSnapshotFromSerpAndSite(
  input: CompetitorSerpFallbackInput,
): ParsedSimilarwebSnapshot {
  const cleanDomain = normalizeDomainName(input.domain);
  if (!cleanDomain || !cleanDomain.includes(".")) {
    throw new Error("Некорректный домен конкурента");
  }

  const candidatePages =
    input.candidatePages && input.candidatePages.length > 0
      ? input.candidatePages
      : buildDefaultCandidateSitePages();

  if (input.rankedRows.length > 0) {
    const topRows = [...input.rankedRows]
      .filter((r) => r.phrase.trim() && Number.isFinite(r.position) && r.position > 0)
      .sort((a, b) => a.position - b.position);

    const totalWeight = topRows.reduce(
      (sum, r) => sum + CTR_WEIGHT_BY_POS(r.position),
      0,
    );

    const top10Count = topRows.filter((r) => r.position <= 10).length;
    const top30Count = topRows.filter((r) => r.position <= 30).length;
    const estimatedVisits = Math.max(
      150,
      Math.round(top10Count * 210 + Math.max(0, top30Count - top10Count) * 45),
    );
    const visibilityPct =
      input.totalKeywords > 0
        ? Math.min(
            100,
            Math.round((topRows.length / input.totalKeywords) * 1000) / 10,
          )
        : 50;

    const clusters: ParsedSimilarwebCluster[] = topRows.slice(0, 20).map((r) => {
      const weight = CTR_WEIGHT_BY_POS(r.position);
      const sharePct =
        totalWeight > 0
          ? Math.max(0.5, Math.round((weight / totalWeight) * 1000) / 10)
          : Math.round((100 / Math.min(20, topRows.length)) * 10) / 10;
      return {
        phrase: r.phrase.trim().slice(0, 200),
        trafficSharePct: sharePct,
        channel: "organic" as const,
        mappedTargetUrl: mapSimilarwebPhraseToWesetupUrl(
          r.phrase,
          candidatePages,
        ),
        competitorPos: r.position,
        competitorUrl: r.url ?? null,
        notes: `SERP Topvisor: #${r.position}${
          r.url ? ` (${r.url})` : ""
        }`,
      };
    });

    return {
      domain: cleanDomain,
      periodLabel: input.latestDate
        ? `SERP ${input.latestDate}`
        : formatSimilarwebPeriodLabel({}),
      visitsMonthly: estimatedVisits,
      organicSharePct: visibilityPct,
      paidSharePct: null,
      bouncePct: null,
      pagesPerVisit: null,
      clusters,
    };
  }

  // Fallback to phrases extracted from competitor's public sitemap / HTML pages or niche defaults
  const presetPhrases = DEFAULT_COMPETITOR_NICHE_PHRASES[cleanDomain] ?? [
    "хассп журналы и их заполнение",
    "бракеражный журнал готовой продукции",
    "гигиенический журнал здоровья сотрудников",
    "санпин для общепита",
  ];
  const rawPhrases = [
    ...(input.sitemapPhrases ?? []),
    ...presetPhrases,
  ]
    .map((p) => p.trim())
    .filter((p) => p.length >= 4);
  const uniquePhrases = [...new Set(rawPhrases)].slice(0, 15);
  const equalShare =
    uniquePhrases.length > 0
      ? Math.round((100 / uniquePhrases.length) * 10) / 10
      : 0;

  return {
    domain: cleanDomain,
    periodLabel: formatSimilarwebPeriodLabel({}),
    visitsMonthly: uniquePhrases.length > 0 ? uniquePhrases.length * 140 : 250,
    organicSharePct: uniquePhrases.length > 0 ? 58 : null,
    paidSharePct: null,
    bouncePct: null,
    pagesPerVisit: null,
    clusters: uniquePhrases.map((phrase) => ({
      phrase: phrase.slice(0, 200),
      trafficSharePct: equalShare,
      channel: "organic" as const,
      mappedTargetUrl: mapSimilarwebPhraseToWesetupUrl(phrase, candidatePages),
      notes: "Автосверка конкурента + регистрация домена в Topvisor",
    })),
  };
}

const MONTH_NAMES_EN = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

const DIRECT_KEYWORD_RULES: ReadonlyArray<{
  pattern: RegExp;
  targetUrl: string;
}> = [
  {
    pattern: /бракераж[^/]*готов|готов[^/]*бракераж|журнал\s+бракераж/i,
    targetUrl: "/journals-info/finished_product",
  },
  {
    pattern: /бракераж[^/]*сыр|бракераж[^/]*скоропорт|входн\S*\s+контрол/i,
    targetUrl: "/journals-info/incoming_control",
  },
  {
    pattern: /приемк\S*\s+сыр|чек[-\s]*лист\s+приемк/i,
    targetUrl: "/blog/chek-list-priemki-syrya-v-restorane",
  },
  {
    pattern: /бактерицид|уф[-\s]*ламп|кварцеван/i,
    targetUrl: "/journals-info/uv_lamp_runtime",
  },
  {
    pattern: /генеральн\S*\s+убор|график\s+(?:генеральн\S*\s+)?убор/i,
    targetUrl: "/journals-info/general_cleaning",
  },
  {
    pattern: /текущ\S*\s+убор|журнал\s+убор|чек[-\s]*лист\s+убор/i,
    targetUrl: "/journals-info/cleaning",
  },
  {
    pattern: /гнойничков|журнал\s+здоров|осмотр\S*\s+рук/i,
    targetUrl: "/journals-info/health_check",
  },
  {
    pattern: /гигиеническ\S*\s+журнал|личн\S*\s+гигиен/i,
    targetUrl: "/journals-info/hygiene",
  },
  {
    pattern: /медицинск\S*\s+книж|медкниж|медосмотр/i,
    targetUrl: "/journals-info/med_books",
  },
  {
    pattern: /температур[^/]*влажност|микроклимат|психрометр|гигрометр|журнал\s+температур$/i,
    targetUrl: "/journals-info/climate_control",
  },
  {
    pattern: /температур[^/]*холодильн|холодильн[^/]*температур/i,
    targetUrl: "/journals-info/cold_equipment_control",
  },
  {
    pattern: /фритюр\S*\s+жир|масл\S*\s+во\s+фритюр|фритюр/i,
    targetUrl: "/journals-info/fryer_oil",
  },
  {
    pattern: /суточн\S*\s+проб/i,
    targetUrl: "/journals-info/daily_samples",
  },
  {
    pattern: /дезинфекц|дезсредств/i,
    targetUrl: "/journals-info/disinfectant_usage",
  },
  {
    pattern: /списани\S*\s+продукт|журнал\s+списани|утилизац\S*\s+пищев|забраковк|отбраковк/i,
    targetUrl: "/journals-info/product_writeoff",
  },
  {
    pattern: /интенсивн\S*\s+охлажден/i,
    targetUrl: "/journals-info/intensive_cooling",
  },
  {
    pattern: /металлопримес/i,
    targetUrl: "/journals-info/metal_impurity",
  },
  {
    pattern: /стекл\S*\s+и\s+хрупк|контрол\S*\s+стекл/i,
    targetUrl: "/journals-info/glass_control",
  },
  {
    pattern: /мойк\S*\s+и\s+дезинфекц\S*\s+оборудован/i,
    targetUrl: "/journals-info/equipment_cleaning",
  },
  {
    pattern: /авари\S*\s+ситуац|учет\S*\s+авари/i,
    targetUrl: "/journals-info/accident_journal",
  },
  {
    pattern: /дератизац|дезинсекц|вредител|пест[-\s]*контрол/i,
    targetUrl: "/journals-info/pest_control",
  },
  {
    pattern: /услови\S*\s+(?:и\s+срок\S*\s+)?хранени\S*\s+продукт/i,
    targetUrl: "/blog/usloviya-i-sroki-hraneniya-produktov-obshchepit",
  },
  {
    pattern: /приказ[^/]*(?:хассп|haccp|санпин|бракераж)/i,
    targetUrl: "/prikazy",
  },
  {
    pattern: /разработк\S*\s+(?:хассп|haccp|ппк)|программ\S*\s+производственн\S*\s+контрол|внедрен\S*\s+хассп|аудит\s+хассп|документ\S*\s+хассп/i,
    targetUrl: "/uslugi",
  },
  {
    pattern: /комплект\s+журнал|какие\s+журналы\s+нужны|подбор\s+журнал|журналы\s+по\s+хассп\s+для\s+пищевого/i,
    targetUrl: "/calc/journals",
  },
  {
    pattern: /фастфуд|шаурм|бургерн/i,
    targetUrl: "/dlya-fastfuda",
  },
  {
    pattern: /отел\S*|гостиниц/i,
    targetUrl: "/dlya-otelya",
  },
  {
    pattern: /пекарн|кондитерск/i,
    targetUrl: "/dlya-pekarni",
  },
  {
    pattern: /кафе|кофейн|ресторан/i,
    targetUrl: "/dlya-kafe",
  },
  {
    pattern: /санпин|санитарн\S*\s+правил|роспотребнадзор|штраф/i,
    targetUrl: "/sanpin-2-3-2-4-4282-26",
  },
  {
    pattern: /хассп\s+журнал|журнал\S*\s+(?:по\s+)?хассп|электронн\S*\s+журнал|чек[-\s]*лист/i,
    targetUrl: "/journals-info",
  },
  {
    pattern: /хассп|haccp/i,
    targetUrl: "/zhurnal-haccp",
  },
];

function normalizeText(raw: string): string {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}\s/-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Ensures a target path on wesetup.ru is both public/allowed AND follows any 301 redirect
 * in `SEO_REDIRECTS` so we never point backlinks or clusters at a redirected URL.
 */
export function toCanonicalPublicWesetupPath(rawPath: string | null | undefined): string {
  const publicPath = resolvePublicSeoTargetPath(rawPath) ?? "/journals-info";
  const redirected = seoRedirectTarget(publicPath);
  if (redirected && redirected !== "/") {
    return resolvePublicSeoTargetPath(redirected) ?? publicPath;
  }
  return publicPath;
}

/**
 * Maps a Similarweb search keyword phrase to the best canonical `200 OK` public
 * landing page on `wesetup.ru`.
 */
export function mapSimilarwebPhraseToWesetupUrl(
  phrase: string,
  candidatePages?: readonly CandidateSitePage[],
): string {
  const cleanPhrase = normalizeText(phrase);
  if (!cleanPhrase) return "/journals-info";

  for (const rule of DIRECT_KEYWORD_RULES) {
    if (rule.pattern.test(cleanPhrase)) {
      return toCanonicalPublicWesetupPath(rule.targetUrl);
    }
  }

  const pages =
    candidatePages && candidatePages.length > 0
      ? candidatePages
      : buildDefaultCandidateSitePages();

  const words = cleanPhrase.split(" ").filter((w) => w.length >= 3);
  let bestUrl = "/journals-info";
  let bestScore = 0;

  for (const page of pages) {
    const candidateUrl = toCanonicalPublicWesetupPath(page.url);
    const haystack = normalizeText(
      [page.title, ...(page.keywords ?? []), ...(page.facts ?? [])].join(" "),
    );
    if (!haystack) continue;

    let score = 0;
    for (const kw of page.keywords ?? []) {
      const normKw = normalizeText(kw);
      if (!normKw) continue;
      if (normKw === cleanPhrase) score += 20;
      else if (cleanPhrase.includes(normKw) || normKw.includes(cleanPhrase)) score += 10;
    }

    for (const word of words) {
      if (haystack.includes(word)) score += 2;
    }

    if (score > bestScore) {
      bestScore = score;
      bestUrl = candidateUrl;
    }
  }

  return toCanonicalPublicWesetupPath(bestUrl);
}

/**
 * Normalizes a share percentage from Similarweb (which can come as `0.1761` or `17.61`)
 * into a 0..100 percentage rounded to 2 decimal places.
 */
export function normalizeSimilarwebSharePct(
  raw: unknown,
  opts?: { assumeRatioBelowOrEqualOne?: boolean },
): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const num =
    typeof raw === "number"
      ? raw
      : typeof raw === "string"
        ? Number.parseFloat(raw.replace(/%/g, "").replace(/,/g, ".").trim())
        : NaN;
  if (!Number.isFinite(num) || num < 0) return null;

  const isRatio =
    opts?.assumeRatioBelowOrEqualOne !== false &&
    num > 0 &&
    num <= 1 &&
    !String(raw).includes("%");

  const pct = isRatio ? num * 100 : num;
  return Math.min(100, Math.round(pct * 100) / 100);
}

export function parseSimilarwebNumber(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  if (typeof raw === "number") {
    return Number.isFinite(raw) ? raw : null;
  }
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const suffixMatch = /^([\d.,]+)\s*([kmb]|тыс|млн)?$/i.exec(trimmed);
    if (suffixMatch) {
      const base = Number.parseFloat(suffixMatch[1].replace(/,/g, "."));
      if (!Number.isFinite(base)) return null;
      const suffix = (suffixMatch[2] ?? "").toLowerCase();
      if (suffix === "k" || suffix === "тыс") return base * 1_000;
      if (suffix === "m" || suffix === "млн") return base * 1_000_000;
      if (suffix === "b") return base * 1_000_000_000;
      return base;
    }
    const clean = Number.parseFloat(trimmed.replace(/[^\d.-]/g, ""));
    return Number.isFinite(clean) ? clean : null;
  }
  return null;
}

export function formatSimilarwebPeriodLabel(
  raw: Record<string, unknown>,
  fallbackDate: Date = new Date(),
): string {
  if (typeof raw.periodLabel === "string" && raw.periodLabel.trim().length >= 3) {
    return raw.periodLabel.trim().slice(0, 100);
  }

  const engagements =
    raw.Engagments && typeof raw.Engagments === "object"
      ? (raw.Engagments as Record<string, unknown>)
      : raw.Engagements && typeof raw.Engagements === "object"
        ? (raw.Engagements as Record<string, unknown>)
        : null;

  const monthRaw = engagements?.Month ?? raw.Month ?? raw.month;
  const yearRaw = engagements?.Year ?? raw.Year ?? raw.year;
  const monthNum = Number(monthRaw);
  const yearNum = Number(yearRaw);

  if (
    Number.isInteger(monthNum) &&
    monthNum >= 1 &&
    monthNum <= 12 &&
    Number.isInteger(yearNum) &&
    yearNum >= 2020 &&
    yearNum <= 2100
  ) {
    const endIdx = monthNum - 1;
    const startIdx = (endIdx + 10) % 12;
    const startMonth = MONTH_NAMES_EN[startIdx];
    const endMonth = MONTH_NAMES_EN[endIdx];
    return `${startMonth}–${endMonth} ${yearNum}`;
  }

  const snapshotDate =
    typeof raw.SnapshotDate === "string"
      ? raw.SnapshotDate
      : typeof (raw.Header as Record<string, unknown> | undefined)?.date === "string"
        ? String((raw.Header as Record<string, unknown>).date)
        : null;
  if (snapshotDate) {
    const d = new Date(snapshotDate);
    if (!Number.isNaN(d.getTime())) {
      const endIdx = d.getUTCMonth();
      const startIdx = (endIdx + 10) % 12;
      return `${MONTH_NAMES_EN[startIdx]}–${MONTH_NAMES_EN[endIdx]} ${d.getUTCFullYear()}`;
    }
  }

  const endIdx = fallbackDate.getUTCMonth();
  const startIdx = (endIdx + 10) % 12;
  return `${MONTH_NAMES_EN[startIdx]}–${MONTH_NAMES_EN[endIdx]} ${fallbackDate.getUTCFullYear()}`;
}

/**
 * Extracts keyword rows from either:
 * - `TopKeywords` array in `getDomainOverview` (`{ Name, Volume, EstimatedValue, Share, Cpc }`)
 * - `Data` / `Records` array in `getProSearchKeywords` (`{ SearchTerm, TotalShare, Organic, Paid, Volume, Cpc, DestUrl, Position, Change }`)
 * - `clusters` / `keywords` arrays in embedded state
 */
export function extractSimilarwebKeywordRows(raw: unknown): ParsedSimilarwebKeywordRow[] {
  if (!raw || typeof raw !== "object") return [];
  const obj = raw as Record<string, unknown>;

  const candidateLists: unknown[] = [
    obj.Data,
    obj.Records,
    obj.TopKeywords,
    obj.topKeywords,
    obj.SearchKeywords,
    obj.keywords,
    obj.clusters,
    (obj.overview as Record<string, unknown> | undefined)?.TopKeywords,
    (obj.search as Record<string, unknown> | undefined)?.TopKeywords,
  ];

  const rows: ParsedSimilarwebKeywordRow[] = [];
  const seen = new Set<string>();

  for (const list of candidateLists) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (!item || typeof item !== "object") continue;
      const rec = item as Record<string, unknown>;
      const phraseRaw =
        rec.SearchTerm ??
        rec.searchTerm ??
        rec.Name ??
        rec.name ??
        rec.Keyword ??
        rec.keyword ??
        rec.phrase;
      const phrase = typeof phraseRaw === "string" ? phraseRaw.trim() : "";
      if (!phrase || phrase === SIMILARWEB_TELEMETRY_META_PHRASE) continue;

      const dedupeKey = phrase.toLowerCase();
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      const rawShare =
        rec.TotalShare ??
        rec.Share ??
        rec.share ??
        rec.trafficSharePct ??
        rec.TrafficShare ??
        rec.VolumeShare ??
        null;

      let sharePct = normalizeSimilarwebSharePct(rawShare) ?? 0;
      if (sharePct <= 0) {
        const estVal = parseSimilarwebNumber(rec.EstimatedValue ?? rec.Volume);
        if (estVal && estVal > 0 && estVal <= 100) {
          sharePct = Math.round(estVal * 100) / 100;
        }
      }

      const paidPart = normalizeSimilarwebSharePct(rec.Paid ?? rec.paidShare ?? rec.paidSharePct);
      const orgPart = normalizeSimilarwebSharePct(
        rec.Organic ?? rec.organicShare ?? rec.organicSharePct,
      );
      const cpcVal = parseSimilarwebNumber(rec.Cpc ?? rec.cpc ?? rec.cpcUsd);
      const volVal = parseSimilarwebNumber(rec.Volume ?? rec.volume ?? rec.SearchVolume);
      const changeVal = normalizeSimilarwebSharePct(rec.Change ?? rec.change ?? rec.changePct);
      const posVal = parseSimilarwebNumber(rec.Position ?? rec.position ?? rec.competitorPos);
      const urlRaw =
        rec.DestUrl ??
        rec.destUrl ??
        rec.Url ??
        rec.url ??
        rec.LandingPage ??
        rec.competitorUrl ??
        null;
      const competitorUrl =
        typeof urlRaw === "string" && urlRaw.trim() ? urlRaw.trim() : null;

      let channel: "organic" | "paid" = "organic";
      if (rec.channel === "paid" || rec.Channel === "paid" || rec.IsPaid === true) {
        channel = "paid";
      } else if (paidPart !== null && orgPart !== null && paidPart > orgPart) {
        channel = "paid";
      } else if (paidPart !== null && orgPart === null && paidPart > 50) {
        channel = "paid";
      } else if (cpcVal !== null && cpcVal > 0 && rec.IsPaid !== false && paidPart !== 0) {
        channel = "paid";
      }

      rows.push({
        phrase: phrase.slice(0, 200),
        trafficSharePct: sharePct,
        channel,
        notes:
          typeof rec.notes === "string" && rec.notes.trim()
            ? rec.notes.trim()
            : "Импорт Similarweb (api-anything)",
        volume: volVal !== null && volVal > 0 ? Math.round(volVal) : null,
        cpcUsd: cpcVal !== null && cpcVal > 0 ? Math.round(cpcVal * 100) / 100 : null,
        organicSharePct: orgPart,
        paidSharePct: paidPart,
        competitorUrl,
        competitorPos: posVal !== null && posVal > 0 ? Math.round(posVal) : null,
        changePct: changeVal,
      });
    }
  }

  return rows.slice(0, 45);
}

function extractRankValue(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number" || typeof raw === "string") {
    const n = parseSimilarwebNumber(raw);
    return n !== null && n > 0 ? Math.round(n) : null;
  }
  if (typeof raw === "object") {
    const r = (raw as Record<string, unknown>).Rank ?? (raw as Record<string, unknown>).rank;
    const n = parseSimilarwebNumber(r);
    return n !== null && n > 0 ? Math.round(n) : null;
  }
  return null;
}

export function extractSimilarwebReferrals(raw: unknown): ParsedSimilarwebReferralSite[] {
  if (!raw || typeof raw !== "object") return [];
  const obj = raw as Record<string, unknown>;
  const candidates: unknown[] = [
    obj.TopReferringSites,
    obj.topReferrals,
    obj.Referrals,
    obj.referrals,
    obj.Data,
    obj.Records,
    (obj.referrals as Record<string, unknown> | undefined)?.TopReferringSites,
  ];
  const out: ParsedSimilarwebReferralSite[] = [];
  const seen = new Set<string>();
  for (const list of candidates) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (!item || typeof item !== "object") continue;
      const rec = item as Record<string, unknown>;
      const domRaw = rec.Site ?? rec.Domain ?? rec.domain ?? rec.Name ?? rec.name;
      if (typeof domRaw !== "string") continue;
      const domain = normalizeDomainName(domRaw);
      if (!domain || !domain.includes(".") || seen.has(domain)) continue;
      seen.add(domain);
      const sharePct =
        normalizeSimilarwebSharePct(
          rec.Share ?? rec.Value ?? rec.TotalShare ?? rec.sharePct,
        ) ?? 0;
      out.push({ domain, sharePct });
    }
  }
  return out.slice(0, 12);
}

export function extractSimilarwebSimilarSites(raw: unknown): ParsedSimilarwebSimilarSite[] {
  if (!raw || typeof raw !== "object") return [];
  const obj = raw as Record<string, unknown>;
  const candidates: unknown[] = [
    obj.SimilarSites,
    obj.similarSites,
    obj.TopSimilarityCompetitors,
    obj.Competitors,
    obj.Data,
    obj.Records,
  ];
  const out: ParsedSimilarwebSimilarSite[] = [];
  const seen = new Set<string>();
  for (const list of candidates) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (!item || typeof item !== "object") continue;
      const rec = item as Record<string, unknown>;
      const domRaw = rec.Site ?? rec.Domain ?? rec.domain ?? rec.Name ?? rec.Url;
      if (typeof domRaw !== "string") continue;
      const domain = normalizeDomainName(domRaw);
      if (!domain || !domain.includes(".") || seen.has(domain)) continue;
      seen.add(domain);
      const affinityPct = normalizeSimilarwebSharePct(
        rec.Similarity ?? rec.Affinity ?? rec.Score ?? rec.affinityPct ?? rec.Share,
      );
      const rank = extractRankValue(rec.Rank ?? rec.GlobalRank ?? rec.rank);
      out.push({ domain, affinityPct, rank });
    }
  }
  return out.slice(0, 12);
}

export function extractSimilarwebTopPages(raw: unknown): ParsedSimilarwebTopPage[] {
  if (!raw || typeof raw !== "object") return [];
  const obj = raw as Record<string, unknown>;
  const candidates: unknown[] = [
    obj.TopPages,
    obj.topPages,
    obj.PopularPages,
    obj.LandingPages,
    obj.Data,
    obj.Records,
  ];
  const out: ParsedSimilarwebTopPage[] = [];
  const seen = new Set<string>();
  for (const list of candidates) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (!item || typeof item !== "object") continue;
      const rec = item as Record<string, unknown>;
      const rawUrl = rec.Url ?? rec.urlPath ?? rec.Page ?? rec.Path ?? rec.Name;
      if (typeof rawUrl !== "string" || !rawUrl.trim()) continue;
      const urlPath = rawUrl.trim();
      if (seen.has(urlPath)) continue;
      seen.add(urlPath);
      const sharePct =
        normalizeSimilarwebSharePct(rec.Share ?? rec.Value ?? rec.sharePct) ?? 0;
      const changePct = normalizeSimilarwebSharePct(rec.Change ?? rec.changePct);
      out.push({
        urlPath,
        sharePct,
        ...(changePct !== null ? { changePct } : {}),
      });
    }
  }
  return out.slice(0, 10);
}

export function extractSimilarwebSubfolders(raw: unknown): ParsedSimilarwebSubfolder[] {
  if (!raw || typeof raw !== "object") return [];
  const obj = raw as Record<string, unknown>;
  const candidates: unknown[] = [
    obj.Subfolders,
    obj.topSubfolders,
    obj.Data,
    obj.Records,
  ];
  const out: ParsedSimilarwebSubfolder[] = [];
  const seen = new Set<string>();
  for (const list of candidates) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (!item || typeof item !== "object") continue;
      const rec = item as Record<string, unknown>;
      const rawFolder =
        rec.Subfolder ?? rec.subfolder ?? rec.Folder ?? rec.Path ?? rec.Name;
      if (typeof rawFolder !== "string" || !rawFolder.trim()) continue;
      const subfolder = rawFolder.trim();
      if (seen.has(subfolder)) continue;
      seen.add(subfolder);
      const sharePct =
        normalizeSimilarwebSharePct(rec.Share ?? rec.Value ?? rec.sharePct) ?? 0;
      const changePct = normalizeSimilarwebSharePct(rec.Change ?? rec.changePct);
      out.push({
        subfolder,
        sharePct,
        ...(changePct !== null ? { changePct } : {}),
      });
    }
  }
  return out.slice(0, 8);
}

export function extractSimilarwebBrandedSplit(raw: unknown): {
  brandedSharePct: number | null;
  nonBrandedSharePct: number | null;
} {
  if (!raw || typeof raw !== "object") {
    return { brandedSharePct: null, nonBrandedSharePct: null };
  }
  const obj = raw as Record<string, unknown>;
  const dataObj =
    obj.Data && typeof obj.Data === "object" && !Array.isArray(obj.Data)
      ? (obj.Data as Record<string, unknown>)
      : obj;

  const branded = normalizeSimilarwebSharePct(
    dataObj.Branded ??
      dataObj.branded ??
      dataObj.BrandedShare ??
      dataObj.brandedSharePct ??
      obj.brandedSharePct,
  );
  const nonBranded = normalizeSimilarwebSharePct(
    dataObj.NonBranded ??
      dataObj.nonBranded ??
      dataObj.NonBrandedShare ??
      dataObj.nonBrandedSharePct ??
      obj.nonBrandedSharePct,
  );

  if (branded !== null && nonBranded === null) {
    return {
      brandedSharePct: branded,
      nonBrandedSharePct: Math.max(0, Math.round((100 - branded) * 100) / 100),
    };
  }
  if (nonBranded !== null && branded === null) {
    return {
      brandedSharePct: Math.max(0, Math.round((100 - nonBranded) * 100) / 100),
      nonBrandedSharePct: nonBranded,
    };
  }
  return { brandedSharePct: branded, nonBrandedSharePct: nonBranded };
}

export function extractSimilarwebVisitsTrendPct(raw: unknown): number | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const direct = normalizeSimilarwebSharePct(obj.visitsTrendPct);
  if (direct !== null) return direct;

  const history =
    obj.EstimatedMonthlyVisits &&
    typeof obj.EstimatedMonthlyVisits === "object" &&
    !Array.isArray(obj.EstimatedMonthlyVisits)
      ? (obj.EstimatedMonthlyVisits as Record<string, unknown>)
      : null;
  if (!history) return null;

  const entries = Object.entries(history)
    .map(([date, val]) => ({ date, visits: parseSimilarwebNumber(val) }))
    .filter(
      (e): e is { date: string; visits: number } =>
        e.visits !== null && e.visits > 0,
    )
    .sort((a, b) => a.date.localeCompare(b.date));

  if (entries.length < 2) return null;
  const first = entries[0]!.visits;
  const last = entries[entries.length - 1]!.visits;
  if (first <= 0) return null;
  return Math.round(((last - first) / first) * 1000) / 10;
}

const COUNTRY_CODE_MAP: Record<string, { code: string; name: string }> = {
  "643": { code: "RU", name: "Россия" },
  ru: { code: "RU", name: "Россия" },
  rus: { code: "RU", name: "Россия" },
  "112": { code: "BY", name: "Беларусь" },
  by: { code: "BY", name: "Беларусь" },
  "398": { code: "KZ", name: "Казахстан" },
  kz: { code: "KZ", name: "Казахстан" },
  "840": { code: "US", name: "США" },
  us: { code: "US", name: "США" },
};

export function extractSimilarwebCountries(raw: unknown): ParsedSimilarwebCountryShare[] {
  if (!raw || typeof raw !== "object") return [];
  const obj = raw as Record<string, unknown>;
  const candidates: unknown[] = [
    obj.TopCountryShares,
    obj.topCountries,
    obj.Countries,
  ];
  const out: ParsedSimilarwebCountryShare[] = [];
  for (const list of candidates) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (!item || typeof item !== "object") continue;
      const rec = item as Record<string, unknown>;
      const rawCode = String(
        rec.CountryCode ?? rec.countryCode ?? rec.Country ?? rec.Code ?? "",
      )
        .trim()
        .toLowerCase();
      if (!rawCode) continue;
      const mapped = COUNTRY_CODE_MAP[rawCode];
      const countryCode = mapped?.code ?? rawCode.toUpperCase();
      const countryName =
        typeof rec.CountryName === "string"
          ? rec.CountryName
          : typeof rec.countryName === "string"
            ? rec.countryName
            : mapped?.name;
      const sharePct =
        normalizeSimilarwebSharePct(rec.Value ?? rec.Share ?? rec.sharePct) ?? 0;
      if (sharePct <= 0) continue;
      out.push({ countryCode, countryName, sharePct });
    }
  }
  return out.slice(0, 5);
}

/**
 * Normalizes raw data returned by `api-anything` Similarweb operations (`getDomainOverview`,
 * `getWebsiteAnalysis`, `getProSearchKeywords`, `getProTrafficSources`, `getProSimilarSites`)
 * into a `ParsedSimilarwebSnapshot`.
 */
export function parseSimilarwebApiPayload(
  domainInput: string,
  overviewPayload: unknown,
  keywordsPayload?: unknown,
  opts?: {
    candidatePages?: readonly CandidateSitePage[];
    fallbackDate?: Date;
    trafficSourcesPayload?: unknown;
    similarSitesPayload?: unknown;
    popularPagesPayload?: unknown;
    subfoldersPayload?: unknown;
    brandedSplitPayload?: unknown;
  },
): ParsedSimilarwebSnapshot {
  const cleanDomain = normalizeDomainName(domainInput);
  if (!cleanDomain || !cleanDomain.includes(".")) {
    throw new Error("Некорректный домен для Similarweb");
  }

  const root =
    overviewPayload && typeof overviewPayload === "object"
      ? (overviewPayload as Record<string, unknown>)
      : {};

  const overviewObj =
    root.overview && typeof root.overview === "object"
      ? { ...root, ...(root.overview as Record<string, unknown>) }
      : root;

  const engagements =
    overviewObj.Engagments && typeof overviewObj.Engagments === "object"
      ? (overviewObj.Engagments as Record<string, unknown>)
      : overviewObj.Engagements && typeof overviewObj.Engagements === "object"
        ? (overviewObj.Engagements as Record<string, unknown>)
        : overviewObj;

  const trafficSources =
    overviewObj.TrafficSources && typeof overviewObj.TrafficSources === "object"
      ? (overviewObj.TrafficSources as Record<string, unknown>)
      : overviewObj.trafficSources && typeof overviewObj.trafficSources === "object"
        ? (overviewObj.trafficSources as Record<string, unknown>)
        : {};

  const rawVisits =
    engagements.Visits ??
    engagements.visits ??
    overviewObj.visitsMonthly ??
    overviewObj.TotalVisits ??
    overviewObj.totalVisits ??
    null;
  const parsedVisits = parseSimilarwebNumber(rawVisits);
  const visitsMonthly =
    parsedVisits !== null && parsedVisits >= 0 ? Math.round(parsedVisits) : 0;

  const rawBounce =
    engagements.BounceRate ??
    engagements.bounceRate ??
    overviewObj.bouncePct ??
    overviewObj.BounceRate ??
    null;
  const bouncePct = normalizeSimilarwebSharePct(rawBounce);

  const rawPpv =
    engagements.PagePerVisit ??
    engagements.PagesPerVisit ??
    engagements.pagesPerVisit ??
    overviewObj.pagesPerVisit ??
    null;
  const parsedPpv = parseSimilarwebNumber(rawPpv);
  const pagesPerVisit =
    parsedPpv !== null && parsedPpv >= 0
      ? Math.round(parsedPpv * 100) / 100
      : null;

  const rawTimeOnSite =
    engagements.TimeOnSite ??
    engagements.timeOnSite ??
    engagements.AvgVisitDuration ??
    overviewObj.avgVisitDurationSec ??
    overviewObj.TimeOnSite ??
    null;
  const parsedTimeOnSite = parseSimilarwebNumber(rawTimeOnSite);
  const avgVisitDurationSec =
    parsedTimeOnSite !== null && parsedTimeOnSite > 0
      ? Math.round(parsedTimeOnSite)
      : null;

  const rawOrganic =
    overviewObj.organicSharePct ??
    trafficSources["Organic Search"] ??
    trafficSources.OrganicSearch ??
    trafficSources.Search ??
    trafficSources.search ??
    overviewObj.OrganicSearchShare ??
    null;
  const organicSharePct = normalizeSimilarwebSharePct(rawOrganic);

  const rawPaid =
    overviewObj.paidSharePct ??
    trafficSources["Paid Search"] ??
    trafficSources.PaidSearch ??
    trafficSources["Paid Referrals"] ??
    overviewObj.PaidSearchShare ??
    null;
  const paidSharePct = normalizeSimilarwebSharePct(rawPaid);

  const directSharePct = normalizeSimilarwebSharePct(
    overviewObj.directSharePct ?? trafficSources.Direct ?? trafficSources.direct,
  );
  const referralsSharePct = normalizeSimilarwebSharePct(
    overviewObj.referralsSharePct ??
      trafficSources.Referrals ??
      trafficSources.referrals,
  );
  const socialSharePct = normalizeSimilarwebSharePct(
    overviewObj.socialSharePct ?? trafficSources.Social ?? trafficSources.social,
  );
  const mailSharePct = normalizeSimilarwebSharePct(
    overviewObj.mailSharePct ?? trafficSources.Mail ?? trafficSources.mail,
  );
  const displaySharePct = normalizeSimilarwebSharePct(
    overviewObj.displaySharePct ??
      trafficSources["Display Ads"] ??
      trafficSources.DisplayAds,
  );

  const globalRank = extractRankValue(
    overviewObj.GlobalRank ?? overviewObj.globalRank,
  );
  const countryRank = extractRankValue(
    overviewObj.CountryRank ?? overviewObj.countryRank,
  );
  const categoryRank = extractRankValue(
    overviewObj.CategoryRank ?? overviewObj.categoryRank,
  );
  const categoryRaw =
    overviewObj.Category ??
    overviewObj.category ??
    (overviewObj.CategoryRank as Record<string, unknown> | undefined)?.Category ??
    null;
  const category =
    typeof categoryRaw === "string" && categoryRaw.trim()
      ? categoryRaw.trim().replace(/_/g, " / ")
      : null;

  const topReferrals = [
    ...extractSimilarwebReferrals(opts?.trafficSourcesPayload),
    ...extractSimilarwebReferrals(overviewObj),
  ].filter(
    (item, idx, arr) => arr.findIndex((x) => x.domain === item.domain) === idx,
  );

  const similarSites = [
    ...extractSimilarwebSimilarSites(opts?.similarSitesPayload),
    ...extractSimilarwebSimilarSites(overviewObj),
  ].filter(
    (item, idx, arr) => arr.findIndex((x) => x.domain === item.domain) === idx,
  );

  const topPages = [
    ...extractSimilarwebTopPages(opts?.popularPagesPayload),
    ...extractSimilarwebTopPages(overviewObj),
  ].filter(
    (item, idx, arr) => arr.findIndex((x) => x.urlPath === item.urlPath) === idx,
  );
  const topSubfolders = [
    ...extractSimilarwebSubfolders(opts?.subfoldersPayload),
    ...extractSimilarwebSubfolders(overviewObj),
  ].filter(
    (item, idx, arr) =>
      arr.findIndex((x) => x.subfolder === item.subfolder) === idx,
  );
  const topCountries = extractSimilarwebCountries(overviewObj);
  const visitsTrendPct = extractSimilarwebVisitsTrendPct(overviewObj);
  const brandedFromPayload = extractSimilarwebBrandedSplit(
    opts?.brandedSplitPayload ?? overviewObj,
  );

  const periodLabel = formatSimilarwebPeriodLabel(
    overviewObj,
    opts?.fallbackDate,
  );

  // Merge keyword rows from pro keywords endpoint first, then overview payload
  const proRows = keywordsPayload ? extractSimilarwebKeywordRows(keywordsPayload) : [];
  const overviewRows = extractSimilarwebKeywordRows(overviewObj);

  const combinedRows: ParsedSimilarwebKeywordRow[] = [];
  const seenPhrases = new Set<string>();
  for (const row of [...proRows, ...overviewRows]) {
    const key = row.phrase.toLowerCase();
    if (seenPhrases.has(key)) continue;
    seenPhrases.add(key);
    combinedRows.push(row);
  }

  const hasAnyPositiveShare = combinedRows.some((r) => r.trafficSharePct > 0);
  if (!hasAnyPositiveShare && combinedRows.length > 0) {
    const equalShare = Math.round((100 / combinedRows.length) * 100) / 100;
    for (const row of combinedRows) {
      row.trafficSharePct = equalShare;
    }
  }

  const candidatePages =
    opts?.candidatePages && opts.candidatePages.length > 0
      ? opts.candidatePages
      : buildDefaultCandidateSitePages();

  const clusters: ParsedSimilarwebCluster[] = combinedRows.map((row) => ({
    phrase: row.phrase,
    trafficSharePct: row.trafficSharePct,
    channel: row.channel,
    mappedTargetUrl: mapSimilarwebPhraseToWesetupUrl(row.phrase, candidatePages),
    ...(row.notes ? { notes: row.notes } : {}),
    ...(row.volume != null ? { volume: row.volume } : {}),
    ...(row.cpcUsd != null ? { cpcUsd: row.cpcUsd } : {}),
    ...(row.organicSharePct != null ? { organicSharePct: row.organicSharePct } : {}),
    ...(row.paidSharePct != null ? { paidSharePct: row.paidSharePct } : {}),
    ...(row.competitorUrl ? { competitorUrl: row.competitorUrl } : {}),
    ...(row.competitorPos != null ? { competitorPos: row.competitorPos } : {}),
    ...(row.changePct != null ? { changePct: row.changePct } : {}),
  }));

  const telemetry: ParsedSimilarwebTelemetry = {
    ...(avgVisitDurationSec !== null ? { avgVisitDurationSec } : {}),
    ...(visitsTrendPct !== null ? { visitsTrendPct } : {}),
    ...(brandedFromPayload.brandedSharePct !== null
      ? { brandedSharePct: brandedFromPayload.brandedSharePct }
      : {}),
    ...(brandedFromPayload.nonBrandedSharePct !== null
      ? { nonBrandedSharePct: brandedFromPayload.nonBrandedSharePct }
      : {}),
    ...(globalRank !== null ? { globalRank } : {}),
    ...(countryRank !== null ? { countryRank } : {}),
    ...(categoryRank !== null ? { categoryRank } : {}),
    ...(category ? { category } : {}),
    ...(directSharePct !== null ? { directSharePct } : {}),
    ...(referralsSharePct !== null ? { referralsSharePct } : {}),
    ...(socialSharePct !== null ? { socialSharePct } : {}),
    ...(mailSharePct !== null ? { mailSharePct } : {}),
    ...(displaySharePct !== null ? { displaySharePct } : {}),
    ...(topReferrals.length > 0 ? { topReferrals } : {}),
    ...(similarSites.length > 0 ? { similarSites } : {}),
    ...(topPages.length > 0 ? { topPages } : {}),
    ...(topSubfolders.length > 0 ? { topSubfolders } : {}),
    ...(topCountries.length > 0 ? { topCountries } : {}),
  };

  return {
    domain: cleanDomain,
    periodLabel,
    visitsMonthly,
    organicSharePct,
    paidSharePct,
    bouncePct,
    pagesPerVisit,
    clusters,
    ...(Object.keys(telemetry).length > 0 ? { telemetry } : {}),
  };
}

/**
 * Parses a user-provided cookie input (either a raw `Cookie: name=val; name2=val2` header,
 * a JSON array of browser cookies from DevTools/EditThisCookie, or a JSON session object)
 * into `StoredCookie[]` compatible with `api-anything`.
 */
export function parseSimilarwebCookieInput(rawInput: string): StoredCookie[] {
  const trimmed = String(rawInput ?? "").trim();
  if (!trimmed) return [];

  const defaultExpires = Math.floor(Date.now() / 1000) + 180 * 86_400;

  // 1. JSON array or object
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      const list = Array.isArray(parsed)
        ? parsed
        : parsed &&
            typeof parsed === "object" &&
            Array.isArray((parsed as { cookies?: unknown }).cookies)
          ? ((parsed as { cookies: unknown[] }).cookies ?? [])
          : [];
      const out: StoredCookie[] = [];
      for (const item of list) {
        if (!item || typeof item !== "object") continue;
        const rec = item as Record<string, unknown>;
        const name = typeof rec.name === "string" ? rec.name.trim() : "";
        const value =
          typeof rec.value === "string"
            ? rec.value.trim()
            : rec.value != null
              ? String(rec.value)
              : "";
        if (!name || !value) continue;
        const rawDomain =
          typeof rec.domain === "string" && rec.domain.trim()
            ? rec.domain.trim().replace(/^\./, "")
            : "similarweb.com";
        const expRaw = Number(rec.expires ?? rec.expirationDate);
        const expires =
          Number.isFinite(expRaw) && expRaw > 0
            ? Math.floor(expRaw)
            : defaultExpires;
        out.push({
          name,
          value,
          domain: rawDomain,
          path: typeof rec.path === "string" && rec.path ? rec.path : "/",
          expires,
          httpOnly: Boolean(rec.httpOnly),
          secure: rec.secure !== false,
        });
      }
      if (out.length > 0) return out;
    } catch {
      // Fall through to header/line parser
    }
  }

  // 2. Raw `Cookie:` header or semicolon/newline-separated pairs
  const withoutPrefix = trimmed.replace(/^cookie\s*:\s*/i, "").trim();
  const segments = withoutPrefix
    .split(/[;\r\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const ignoreAttrs = new Set([
    "path",
    "domain",
    "expires",
    "max-age",
    "samesite",
    "secure",
    "httponly",
    "priority",
  ]);

  const cookies: StoredCookie[] = [];
  const seenNames = new Set<string>();
  for (const seg of segments) {
    const eqIdx = seg.indexOf("=");
    if (eqIdx <= 0) continue;
    const name = seg.slice(0, eqIdx).trim();
    const value = seg.slice(eqIdx + 1).trim();
    if (!name || !value || ignoreAttrs.has(name.toLowerCase())) continue;
    if (seenNames.has(name)) continue;
    seenNames.add(name);

    cookies.push({
      name,
      value,
      domain: "similarweb.com",
      path: "/",
      expires: defaultExpires,
      httpOnly: false,
      secure: true,
    });
  }

  return cookies;
}

/**
 * Builds a comprehensive side-by-side Competitor Benchmark Report comparing `wesetup.ru`
 * against competitor snapshots (`haccp-online.ru`, `checkoffice.ru`, `rushaccp.ru`, etc.),
 * Topvisor positions, and purchased GoGetLinks backlinks.
 */
export function buildCompetitorBenchmarkReport(input: {
  snapshots: readonly SimilarwebSnapshotLike[];
  topvisorRows?: ReadonlyArray<{
    phrase: string;
    yandexPos?: string | number | null;
    googlePos?: string | number | null;
    relevantUrl?: string | null;
  }>;
  existingOrders?: ReadonlyArray<{
    targetUrl: string;
    status?: string | null;
  }>;
}): CompetitorBenchmarkReport {
  const freshestByDomain = new Map<
    string,
    {
      snap: SimilarwebSnapshotLike;
      clusters: ParsedSimilarwebCluster[];
      telemetry: ParsedSimilarwebTelemetry;
    }
  >();

  for (const snap of input.snapshots) {
    const d = normalizeDomainName(snap.domain);
    if (!d || freshestByDomain.has(d)) continue;
    const decoded = decodeSimilarwebClustersPayload(snap.clusters);
    freshestByDomain.set(d, {
      snap: { ...snap, domain: d },
      clusters: decoded.clusters,
      telemetry: decoded.telemetry,
    });
  }

  const ownEntry = freshestByDomain.get("wesetup.ru") ?? null;
  const ownVisits = Math.max(0, ownEntry?.snap.visitsMonthly ?? 0);

  // Build own cluster lookup by phrase and by canonical target URL
  const ownShareByPhrase = new Map<string, number>();
  const ownShareByTarget = new Map<string, number>();
  if (ownEntry) {
    for (const c of ownEntry.clusters) {
      const phrase = normalizeText(c.phrase);
      const share = Number(c.trafficSharePct ?? 0) || 0;
      const target = toCanonicalPublicWesetupPath(
        c.mappedTargetUrl || mapSimilarwebPhraseToWesetupUrl(phrase),
      );
      if (phrase) {
        ownShareByPhrase.set(
          phrase,
          Math.max(ownShareByPhrase.get(phrase) ?? 0, share),
        );
      }
      if (target) {
        ownShareByTarget.set(
          target,
          Math.max(ownShareByTarget.get(target) ?? 0, share),
        );
      }
    }
  }

  // Count active purchased backlinks per canonical target URL
  const linksByTarget = new Map<string, number>();
  for (const ord of input.existingOrders ?? []) {
    if (
      ord.status === "rejected" ||
      ord.status === "failed" ||
      ord.status === "cancelled"
    ) {
      continue;
    }
    const target = toCanonicalPublicWesetupPath(ord.targetUrl);
    linksByTarget.set(target, (linksByTarget.get(target) ?? 0) + 1);
  }

  const parsePos = (val: string | number | null | undefined): number | null => {
    if (typeof val === "number") {
      return Number.isFinite(val) && val > 0 ? Math.trunc(val) : null;
    }
    if (typeof val === "string") {
      const t = val.trim();
      if (!t || t === "--") return null;
      const n = Number(t);
      return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
    }
    return null;
  };

  const tvRows = input.topvisorRows ?? [];

  // Count how many competitor domains rank/capture each normalized phrase or target URL
  const domainCountByPhrase = new Map<string, Set<string>>();
  for (const [domain, entry] of freshestByDomain.entries()) {
    for (const rec of entry.clusters) {
      const normP = normalizeText(rec.phrase);
      if (!normP) continue;
      const set = domainCountByPhrase.get(normP) ?? new Set<string>();
      set.add(domain);
      domainCountByPhrase.set(normP, set);
    }
  }

  const clusterGaps: CompetitorClusterGapRow[] = [];
  const gapCountByDomain = new Map<string, number>();

  for (const [domain, entry] of freshestByDomain.entries()) {
    if (domain === "wesetup.ru") continue;
    const { snap, clusters } = entry;
    for (const rec of clusters) {
      const phrase = rec.phrase.trim();
      if (!phrase) continue;
      const normP = normalizeText(phrase);
      const sharePct = Math.max(
        0,
        Math.round((Number(rec.trafficSharePct ?? 0) || 0) * 100) / 100,
      );
      const channel: "organic" | "paid" =
        rec.channel === "paid" ? "paid" : "organic";
      const mappedTargetUrl = toCanonicalPublicWesetupPath(
        rec.mappedTargetUrl?.trim()
          ? rec.mappedTargetUrl
          : mapSimilarwebPhraseToWesetupUrl(phrase),
      );

      let bestYandex: number | null = null;
      let bestGoogle: number | null = null;
      for (const row of tvRows) {
        const rowPhrase = normalizeText(row.phrase);
        const rowTarget = row.relevantUrl
          ? toCanonicalPublicWesetupPath(row.relevantUrl)
          : null;
        if (rowPhrase !== normP && rowTarget !== mappedTargetUrl) continue;
        const y = parsePos(row.yandexPos);
        const g = parsePos(row.googlePos);
        if (y !== null && (bestYandex === null || y < bestYandex)) bestYandex = y;
        if (g !== null && (bestGoogle === null || g < bestGoogle)) bestGoogle = g;
      }

      const wesetupSharePct =
        ownShareByPhrase.get(normP) ??
        ownShareByTarget.get(mappedTargetUrl) ??
        null;
      const isExclusiveToCompetitors = !ownShareByPhrase.has(normP);
      const sharedWithDomainsCount =
        domainCountByPhrase.get(normP)?.size ?? 1;
      const purchasedLinksCount = linksByTarget.get(mappedTargetUrl) ?? 0;
      const estimatedMonthlyTraffic = Math.round(
        (snap.visitsMonthly * sharePct) / 100,
      );
      const bestPos = bestYandex ?? bestGoogle;

      let verdict: CompetitorBenchmarkVerdict;
      let verdictLabel: string;
      let recommendation: string;

      if (bestPos !== null && bestPos <= 3) {
        verdict = "leader";
        verdictLabel = `ТОП-3 (#${bestPos})`;
        recommendation = `Удержание #${bestPos}`;
      } else if (bestPos !== null && bestPos >= 4 && bestPos <= 30) {
        verdict = "push_top3";
        verdictLabel = `Дожим с #${bestPos}`;
        recommendation =
          purchasedLinksCount === 0
            ? "+1–2 ссылки (0 ссыл.)"
            : `Анкор + ПФ (${purchasedLinksCount} ссыл.)`;
        gapCountByDomain.set(domain, (gapCountByDomain.get(domain) ?? 0) + 1);
      } else if (bestPos === null || bestPos > 30) {
        if (purchasedLinksCount === 0) {
          verdict = "gap_no_rank";
          verdictLabel = "Не в ТОП-30";
          recommendation = "Контент + 1 ссылка";
        } else {
          verdict = "need_links";
          verdictLabel = "Дожим интента";
          recommendation = `H1/FAQ (${purchasedLinksCount} ссыл.)`;
        }
        gapCountByDomain.set(domain, (gapCountByDomain.get(domain) ?? 0) + 1);
      } else {
        verdict = "parity";
        verdictLabel = "Контроль";
        recommendation = "Мониторинг";
      }

      clusterGaps.push({
        phrase,
        mappedTargetUrl,
        competitorDomain: domain,
        competitorVisitsMonthly: snap.visitsMonthly,
        competitorTrafficSharePct: sharePct,
        estimatedMonthlyTraffic,
        competitorChannel: channel,
        volume: rec.volume ?? null,
        cpcUsd: rec.cpcUsd ?? null,
        competitorUrl: rec.competitorUrl ?? null,
        competitorPos: rec.competitorPos ?? null,
        changePct: rec.changePct ?? null,
        isExclusiveToCompetitors,
        sharedWithDomainsCount,
        wesetupSharePct,
        yandexPos: bestYandex,
        googlePos: bestGoogle,
        purchasedLinksCount,
        verdict,
        verdictLabel,
        recommendation,
      });
    }
  }

  clusterGaps.sort((a, b) => {
    const rankVerdict = (v: CompetitorBenchmarkVerdict): number => {
      if (v === "push_top3") return 0;
      if (v === "gap_no_rank") return 1;
      if (v === "need_links") return 2;
      if (v === "parity") return 3;
      return 4;
    };
    const rDiff = rankVerdict(a.verdict) - rankVerdict(b.verdict);
    if (rDiff !== 0) return rDiff;
    return b.estimatedMonthlyTraffic - a.estimatedMonthlyTraffic;
  });

  // Aggregate discovered referrals and similar sites across competitors
  const referralMap = new Map<
    string,
    { domain: string; sharePct: number; targetCompetitors: Set<string> }
  >();
  const similarMap = new Map<
    string,
    {
      domain: string;
      affinityPct: number | null;
      sourceCompetitors: Set<string>;
    }
  >();

  const domains: CompetitorDomainSummaryRow[] = [...freshestByDomain.values()]
    .map(({ snap, clusters: clustersArr, telemetry }) => {
      const isWesetup = snap.domain === "wesetup.ru";
      const ratio =
        ownVisits > 0
          ? Math.round((snap.visitsMonthly / ownVisits) * 10) / 10
          : isWesetup
            ? 1
            : 0;

      let orgPct = snap.organicSharePct;
      let paidPct = snap.paidSharePct;
      if (orgPct === null && paidPct === null && clustersArr.length > 0) {
        let orgClusterSum = 0;
        let paidClusterSum = 0;
        for (const c of clustersArr) {
          const s = Math.max(0, Number(c.trafficSharePct ?? 0) || 0);
          if (c.channel === "paid") paidClusterSum += s;
          else orgClusterSum += s;
        }
        if (orgClusterSum + paidClusterSum > 0) {
          orgPct = Math.min(100, Math.round(orgClusterSum * 10) / 10);
          paidPct = Math.min(
            100 - orgPct,
            Math.round(paidClusterSum * 10) / 10,
          );
        }
      }

      const safeOrg = Math.max(0, Math.min(100, orgPct ?? 0));
      const safePaid = Math.max(0, Math.min(100 - safeOrg, paidPct ?? 0));
      const directSharePct = telemetry.directSharePct ?? null;
      const referralsSharePct = telemetry.referralsSharePct ?? null;
      const socialSharePct = telemetry.socialSharePct ?? null;
      const mailSharePct = telemetry.mailSharePct ?? null;
      const displaySharePct = telemetry.displaySharePct ?? null;

      const safeDirect = Math.max(
        0,
        Math.min(100 - safeOrg - safePaid, directSharePct ?? 0),
      );
      const safeReferral = Math.max(
        0,
        Math.min(
          100 - safeOrg - safePaid - safeDirect,
          referralsSharePct ?? 0,
        ),
      );
      const safeSocial = Math.max(
        0,
        Math.min(
          100 - safeOrg - safePaid - safeDirect - safeReferral,
          socialSharePct ?? 0,
        ),
      );

      const otherSharePct = Math.max(
        0,
        Math.round((100 - safeOrg - safePaid) * 10) / 10,
      );

      const estimatedOrganicVisits = Math.round(
        (snap.visitsMonthly * safeOrg) / 100,
      );
      const estimatedPaidVisits = Math.round(
        (snap.visitsMonthly * safePaid) / 100,
      );
      const estimatedDirectVisits = Math.round(
        (snap.visitsMonthly * safeDirect) / 100,
      );
      const estimatedReferralVisits = Math.round(
        (snap.visitsMonthly * safeReferral) / 100,
      );
      const estimatedSocialVisits = Math.round(
        (snap.visitsMonthly * safeSocial) / 100,
      );
      const estimatedOtherVisits = Math.max(
        0,
        snap.visitsMonthly - estimatedOrganicVisits - estimatedPaidVisits,
      );

      let primaryChannelLabel = "Смешанный трафик";
      let channelStrategySummary = "";

      if (isWesetup) {
        primaryChannelLabel = "SEO + Прямой";
        channelStrategySummary =
          "Качаем коммерческие /journals-info/* и /zhurnal-haccp ссылками + ПФ.";
      } else if (safePaid >= 15 && safePaid >= safeOrg * 0.8) {
        primaryChannelLabel = "Директ + Бренд";
        channelStrategySummary = `Платный трафик ~${estimatedPaidVisits.toLocaleString("ru-RU")} виз./мес (${safePaid}%) по журналам ХАССП — перехватываем через ТОП-3 SEO.`;
      } else if (safeOrg >= 45) {
        primaryChannelLabel = "Контентное SEO";
        channelStrategySummary = `Органика ~${estimatedOrganicVisits.toLocaleString("ru-RU")} виз./мес (${safeOrg}%) на чек-листах, шаблонах и статьях.`;
      } else {
        primaryChannelLabel = "Прямые + SEO";
        channelStrategySummary = `Прямые/рефералы ${otherSharePct}%, органика ${safeOrg}%.`;
      }

      const topReferrals = telemetry.topReferrals ?? [];
      const similarSites = telemetry.similarSites ?? [];
      const topPages = telemetry.topPages ?? [];
      const topCountries = telemetry.topCountries ?? [];

      if (!isWesetup) {
        for (const ref of topReferrals) {
          const cur = referralMap.get(ref.domain);
          if (cur) {
            cur.sharePct = Math.max(cur.sharePct, ref.sharePct);
            cur.targetCompetitors.add(snap.domain);
          } else {
            referralMap.set(ref.domain, {
              domain: ref.domain,
              sharePct: ref.sharePct,
              targetCompetitors: new Set([snap.domain]),
            });
          }
        }
        for (const sim of similarSites) {
          if (sim.domain === "wesetup.ru") continue;
          const cur = similarMap.get(sim.domain);
          if (cur) {
            if (
              sim.affinityPct != null &&
              (cur.affinityPct == null || sim.affinityPct > cur.affinityPct)
            ) {
              cur.affinityPct = sim.affinityPct;
            }
            cur.sourceCompetitors.add(snap.domain);
          } else {
            similarMap.set(sim.domain, {
              domain: sim.domain,
              affinityPct: sim.affinityPct ?? null,
              sourceCompetitors: new Set([snap.domain]),
            });
          }
        }
      }

      const avgVisitDurationSec = telemetry.avgVisitDurationSec ?? null;
      const topSubfolders = telemetry.topSubfolders ?? [];

      let brandedSharePct = telemetry.brandedSharePct ?? null;
      let nonBrandedSharePct = telemetry.nonBrandedSharePct ?? null;
      if (brandedSharePct === null && nonBrandedSharePct === null && clustersArr.length > 0) {
        const brandToken = snap.domain.split(".")[0]?.replace(/[-_]/g, "") ?? "";
        let totalShare = 0;
        let brandedSum = 0;
        for (const c of clustersArr) {
          const s = Math.max(0, Number(c.trafficSharePct ?? 0) || 0);
          totalShare += s;
          const pNorm = c.phrase.toLowerCase().replace(/[-_\s]/g, "");
          if (
            (brandToken.length >= 4 && pNorm.includes(brandToken)) ||
            /wesetup|висетап|чекофис|checkoffice|rushaccp|русхассп/i.test(c.phrase)
          ) {
            brandedSum += s;
          }
        }
        if (totalShare > 0) {
          brandedSharePct = Math.min(
            100,
            Math.round((brandedSum / totalShare) * 1000) / 10,
          );
          nonBrandedSharePct = Math.max(
            0,
            Math.round((100 - brandedSharePct) * 10) / 10,
          );
        }
      }

      return {
        domain: snap.domain,
        isWesetup,
        periodLabel: snap.periodLabel,
        visitsMonthly: snap.visitsMonthly,
        visitsTrendPct: telemetry.visitsTrendPct ?? null,
        visitsRatioVsWesetup: ratio,
        brandedSharePct,
        nonBrandedSharePct,
        organicSharePct: orgPct,
        paidSharePct: paidPct,
        directSharePct,
        referralsSharePct,
        socialSharePct,
        mailSharePct,
        displaySharePct,
        otherSharePct,
        estimatedOrganicVisits,
        estimatedPaidVisits,
        estimatedDirectVisits,
        estimatedReferralVisits,
        estimatedSocialVisits,
        estimatedOtherVisits,
        primaryChannelLabel,
        channelStrategySummary,
        bouncePct: snap.bouncePct,
        pagesPerVisit: snap.pagesPerVisit,
        avgVisitDurationSec,
        avgVisitDurationFormatted: formatDurationMmSs(avgVisitDurationSec),
        globalRank: telemetry.globalRank ?? null,
        countryRank: telemetry.countryRank ?? null,
        categoryRank: telemetry.categoryRank ?? null,
        category: telemetry.category ?? null,
        topReferrals,
        similarSites,
        topPages,
        topSubfolders,
        topCountries,
        clustersCount: clustersArr.length,
        gapClustersCount: isWesetup
          ? 0
          : (gapCountByDomain.get(snap.domain) ?? 0),
        sourceKind: snap.sourceKind,
      };
    })
    .sort((a, b) => {
      if (a.isWesetup !== b.isWesetup) return a.isWesetup ? -1 : 1;
      return b.visitsMonthly - a.visitsMonthly;
    });

  // Build concise, scannable SEO Action Plan
  const actionPlan: SeoImprovementActionItem[] = [];
  const seenActionTargets = new Set<string>();

  for (const gap of clusterGaps) {
    if (gap.verdict === "leader") continue;
    const dedupeKey = `${gap.mappedTargetUrl}::${gap.verdict}`;
    if (seenActionTargets.has(dedupeKey)) continue;
    seenActionTargets.add(dedupeKey);

    const bestPos = gap.yandexPos ?? gap.googlePos;

    if (gap.verdict === "push_top3") {
      actionPlan.push({
        id: `act_${actionPlan.length + 1}`,
        priority: "high",
        kind: "push_top3_links",
        badgeLabel: `Дожим #${bestPos} → ТОП-3`,
        title: `«${gap.phrase}»`,
        competitorDomain: gap.competitorDomain,
        targetUrl: gap.mappedTargetUrl,
        keyword: gap.phrase,
        potentialVisitsMonthly: Math.max(40, gap.estimatedMonthlyTraffic),
        volume: gap.volume,
        cpcUsd: gap.cpcUsd,
        yandexPos: gap.yandexPos,
        googlePos: gap.googlePos,
        purchasedLinksCount: gap.purchasedLinksCount,
        whyText: `${gap.competitorDomain}: ${gap.competitorTrafficSharePct}% (~${gap.estimatedMonthlyTraffic.toLocaleString("ru-RU")} виз./мес) · мы на #${bestPos}`,
        actionSteps: [
          `+1–2 ссылки в GGL на ${gap.mappedTargetUrl} (50% бренд / 50% «${gap.phrase}»)`,
          `Проверить FAQ + PDF-образец на ${gap.mappedTargetUrl}`,
        ],
        ctaLabel: "В план GGL",
        ctaHref: `/root/seo/links?targetUrl=${encodeURIComponent(gap.mappedTargetUrl)}&keyword=${encodeURIComponent(gap.phrase)}`,
      });
    } else if (
      gap.competitorChannel === "paid" &&
      gap.estimatedMonthlyTraffic >= 100
    ) {
      actionPlan.push({
        id: `act_${actionPlan.length + 1}`,
        priority: "high",
        kind: "capture_paid_via_seo",
        badgeLabel: "Платный ключ Директа",
        title: `«${gap.phrase}»`,
        competitorDomain: gap.competitorDomain,
        targetUrl: gap.mappedTargetUrl,
        keyword: gap.phrase,
        potentialVisitsMonthly: gap.estimatedMonthlyTraffic,
        volume: gap.volume,
        cpcUsd: gap.cpcUsd,
        yandexPos: gap.yandexPos,
        googlePos: gap.googlePos,
        purchasedLinksCount: gap.purchasedLinksCount,
        whyText: `${gap.competitorDomain} покупает в Директе ~${gap.estimatedMonthlyTraffic.toLocaleString("ru-RU")} виз./мес (${gap.competitorTrafficSharePct}%)`,
        actionSteps: [
          `Включить «${gap.phrase}» в H2/FAQ на ${gap.mappedTargetUrl}`,
          `Поставить стартовую вечную ссылку на ${gap.mappedTargetUrl}`,
        ],
        ctaLabel: "В план GGL",
        ctaHref: `/root/seo/links?targetUrl=${encodeURIComponent(gap.mappedTargetUrl)}&keyword=${encodeURIComponent(gap.phrase)}`,
      });
    } else {
      const isBlogTarget = gap.mappedTargetUrl.startsWith("/blog/");
      actionPlan.push({
        id: `act_${actionPlan.length + 1}`,
        priority: "medium",
        kind: "create_or_expand_content",
        badgeLabel: isBlogTarget ? "Статья блога" : "Точка роста",
        title: `«${gap.phrase}»`,
        competitorDomain: gap.competitorDomain,
        targetUrl: gap.mappedTargetUrl,
        keyword: gap.phrase,
        potentialVisitsMonthly: Math.max(30, gap.estimatedMonthlyTraffic),
        volume: gap.volume,
        cpcUsd: gap.cpcUsd,
        yandexPos: gap.yandexPos,
        googlePos: gap.googlePos,
        purchasedLinksCount: gap.purchasedLinksCount,
        whyText: `${gap.competitorDomain}: ~${gap.estimatedMonthlyTraffic.toLocaleString("ru-RU")} виз./мес (${gap.competitorTrafficSharePct}%) · мы ${bestPos ? `#${bestPos}` : "вне ТОП-50"}`,
        actionSteps: [
          isBlogTarget
            ? `Усилить ${gap.mappedTargetUrl}: таблица СанПиН 4282-26 + CTA в журнал`
            : `Добавить образец заполнения + 1 внешнюю ссылку на ${gap.mappedTargetUrl}`,
        ],
        ctaLabel: isBlogTarget ? "Блог" : "В план GGL",
        ctaHref: isBlogTarget
          ? "/root/blog"
          : `/root/seo/links?targetUrl=${encodeURIComponent(gap.mappedTargetUrl)}&keyword=${encodeURIComponent(gap.phrase)}`,
      });
    }

    if (actionPlan.length >= 6) break;
  }

  const competitorsOnly = domains.filter((d) => !d.isWesetup);
  const leader = competitorsOnly[0] ?? null;
  const totalPotentialMonthlyVisits = actionPlan.reduce(
    (sum, item) => sum + item.potentialVisitsMonthly,
    0,
  );

  const discoveredReferrals = [...referralMap.values()]
    .map((r) => ({
      domain: r.domain,
      sharePct: r.sharePct,
      targetCompetitors: [...r.targetCompetitors],
    }))
    .sort((a, b) => b.sharePct - a.sharePct);

  const trackedSet = new Set(freshestByDomain.keys());
  const discoveredSimilarSites = [...similarMap.values()]
    .map((s) => ({
      domain: s.domain,
      affinityPct: s.affinityPct,
      alreadyTracked: trackedSet.has(s.domain),
      sourceCompetitors: [...s.sourceCompetitors],
    }))
    .sort((a, b) => (b.affinityPct ?? 0) - (a.affinityPct ?? 0));

  return {
    ownDomain: "wesetup.ru",
    ownVisitsMonthly: ownVisits,
    domains,
    clusterGaps,
    actionPlan,
    discoveredReferrals,
    discoveredSimilarSites,
    summary: {
      totalCompetitors: competitorsOnly.length,
      leaderVisitsDomain: leader?.domain ?? null,
      leaderVisitsMonthly: leader?.visitsMonthly ?? 0,
      totalTrackedKeywords: clusterGaps.length,
      paidKeywordsCount: clusterGaps.filter((c) => c.competitorChannel === "paid")
        .length,
      organicKeywordsCount: clusterGaps.filter(
        (c) => c.competitorChannel === "organic",
      ).length,
      risingKeywordsCount: clusterGaps.filter(
        (c) => c.changePct !== null && c.changePct > 0,
      ).length,
      exclusiveKeywordsCount: clusterGaps.filter(
        (c) => c.isExclusiveToCompetitors,
      ).length,
      gapNoRankCount: clusterGaps.filter((c) => c.verdict === "gap_no_rank")
        .length,
      pushTop3Count: clusterGaps.filter((c) => c.verdict === "push_top3").length,
      needLinksCount: clusterGaps.filter((c) => c.verdict === "need_links")
        .length,
      leaderCount: clusterGaps.filter((c) => c.verdict === "leader").length,
      totalPotentialMonthlyVisits,
    },
  };
}
