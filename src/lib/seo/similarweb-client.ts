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
import type { ParsedSimilarwebSnapshot } from "@/lib/seo/gogetlinks-article-ai.server";
import {
  buildDefaultCandidateSitePages,
  type CandidateSitePage,
  normalizeDomainName,
  resolvePublicSeoTargetPath,
} from "@/lib/seo/gogetlinks-planner";

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
  visitsRatioVsWesetup: number;
  organicSharePct: number | null;
  paidSharePct: number | null;
  bouncePct: number | null;
  pagesPerVisit: number | null;
  clustersCount: number;
  gapClustersCount: number;
  sourceKind: string;
}

export interface CompetitorBenchmarkReport {
  ownDomain: string;
  ownVisitsMonthly: number;
  domains: CompetitorDomainSummaryRow[];
  clusterGaps: CompetitorClusterGapRow[];
  summary: {
    totalCompetitors: number;
    leaderVisitsDomain: string | null;
    leaderVisitsMonthly: number;
    gapNoRankCount: number;
    pushTop3Count: number;
    needLinksCount: number;
    leaderCount: number;
  };
}

export interface ParsedSimilarwebKeywordRow {
  phrase: string;
  trafficSharePct: number;
  channel: "organic" | "paid";
  notes?: string;
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
  ],
  "haccp-online.ru": [
    "хассп журналы и их заполнение",
    "бракеражный журнал готовой продукции",
    "журнал проведения генеральных уборок",
    "санпин",
    "журналы по хассп для пищевого производства",
  ],
  "checkoffice.ru": [
    "чек-лист приемки сырья в ресторане",
    "условия хранения продукции",
    "электронные чек-листы для общепита",
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
    // Heuristic monthly organic visits estimate based on HACCP/SanPiN niche search volume
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

    const clusters = topRows.slice(0, 15).map((r) => {
      const weight = CTR_WEIGHT_BY_POS(r.position);
      const sharePct =
        totalWeight > 0
          ? Math.max(0.5, Math.round((weight / totalWeight) * 1000) / 10)
          : Math.round((100 / Math.min(15, topRows.length)) * 10) / 10;
      return {
        phrase: r.phrase.trim().slice(0, 200),
        trafficSharePct: sharePct,
        channel: "organic" as const,
        mappedTargetUrl: mapSimilarwebPhraseToWesetupUrl(
          r.phrase,
          candidatePages,
        ),
        notes: `Автосверка SERP Topvisor: #${r.position}${
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
  const uniquePhrases = [...new Set(rawPhrases)].slice(0, 12);
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
    pattern: /генеральн\S*\s+убор|график\s+убор|журнал\s+убор/i,
    targetUrl: "/journals-info/general_cleaning",
  },
  {
    pattern: /гнойничков|журнал\s+здоров|осмотр\S*\s+рук|гигиеническ\S*\s+журнал/i,
    targetUrl: "/journals-info/health_check",
  },
  {
    pattern: /медицинск\S*\s+книж|медкниж|медосмотр/i,
    targetUrl: "/journals-info/med_books",
  },
  {
    pattern: /температур[^/]*влажност|микроклимат|психрометр|гигрометр/i,
    targetUrl: "/journals-info/climate_control",
  },
  {
    pattern: /температур[^/]*холодильн|холодильн[^/]*температур/i,
    targetUrl: "/journals-info/cold_equipment_control",
  },
  {
    pattern: /фритюр\S*\s+жир|масл\S*\s+во\s+фритюр/i,
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
    pattern: /списани\S*\s+продукт|утилизац\S*\s+пищев|забраковк/i,
    targetUrl: "/journals-info/product_writeoff",
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
    pattern: /разработк\S*\s+(?:хассп|haccp|ппк)|программ\S*\s+производственн\S*\s+контрол|внедрен\S*\s+хассп/i,
    targetUrl: "/uslugi",
  },
  {
    pattern: /комплект\s+журнал|какие\s+журналы\s+нужны|подбор\s+журнал|журналы\s+по\s+хассп\s+для\s+пищевого/i,
    targetUrl: "/calc/journals",
  },
  {
    pattern: /санпин|санитарн\S*\s+правил/i,
    targetUrl: "/sanpin-2-3-2-4-4282-26",
  },
  {
    pattern: /хассп\s+журнал|журнал\S*\s+(?:по\s+)?хассп|электронн\S*\s+журнал/i,
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
 * - `Data` / `Records` array in `getProSearchKeywords` (`{ SearchTerm, TotalShare, Organic, Paid }`)
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
      if (!phrase) continue;

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

      let channel: "organic" | "paid" = "organic";
      if (rec.channel === "paid" || rec.Channel === "paid" || rec.IsPaid === true) {
        channel = "paid";
      } else {
        const paidPart = parseSimilarwebNumber(rec.Paid ?? rec.paidShare);
        const orgPart = parseSimilarwebNumber(rec.Organic ?? rec.organicShare);
        const cpcVal = parseSimilarwebNumber(rec.Cpc ?? rec.cpc);
        if (paidPart !== null && orgPart !== null && paidPart > orgPart) {
          channel = "paid";
        } else if (paidPart !== null && orgPart === null && paidPart > 0.5) {
          channel = "paid";
        } else if (cpcVal !== null && cpcVal > 0 && rec.IsPaid !== false && paidPart !== 0) {
          channel = "paid";
        }
      }

      rows.push({
        phrase: phrase.slice(0, 200),
        trafficSharePct: sharePct,
        channel,
        notes:
          typeof rec.notes === "string" && rec.notes.trim()
            ? rec.notes.trim()
            : "Импорт Similarweb (api-anything)",
      });
    }
  }

  return rows.slice(0, 30);
}

/**
 * Normalizes raw data returned by `api-anything` Similarweb operations (`getDomainOverview`,
 * `getWebsiteAnalysis`, and optional `getProSearchKeywords`) into a `ParsedSimilarwebSnapshot`.
 */
export function parseSimilarwebApiPayload(
  domainInput: string,
  overviewPayload: unknown,
  keywordsPayload?: unknown,
  opts?: {
    candidatePages?: readonly CandidateSitePage[];
    fallbackDate?: Date;
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

  // Support nested preloaded states from getWebsiteAnalysis if needed
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

  // If keyword shares came from raw Volume without TotalShare, normalize relative to total
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

  const clusters = combinedRows.map((row) => ({
    phrase: row.phrase,
    trafficSharePct: row.trafficSharePct,
    channel: row.channel,
    mappedTargetUrl: mapSimilarwebPhraseToWesetupUrl(row.phrase, candidatePages),
    ...(row.notes ? { notes: row.notes } : {}),
  }));

  return {
    domain: cleanDomain,
    periodLabel,
    visitsMonthly,
    organicSharePct,
    paidSharePct,
    bouncePct,
    pagesPerVisit,
    clusters,
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
 * against competitor snapshots (`haccp-online.ru`, `checkoffice.ru`, etc.), Topvisor positions,
 * and purchased GoGetLinks backlinks.
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
  // Keep freshest snapshot per normalized domain
  const freshestByDomain = new Map<string, SimilarwebSnapshotLike>();
  for (const snap of input.snapshots) {
    const d = normalizeDomainName(snap.domain);
    if (!d || freshestByDomain.has(d)) continue;
    freshestByDomain.set(d, { ...snap, domain: d });
  }

  const ownSnap = freshestByDomain.get("wesetup.ru") ?? null;
  const ownVisits = Math.max(0, ownSnap?.visitsMonthly ?? 0);

  // Build own cluster lookup by phrase and by canonical target URL
  const ownShareByPhrase = new Map<string, number>();
  const ownShareByTarget = new Map<string, number>();
  if (ownSnap && Array.isArray(ownSnap.clusters)) {
    for (const raw of ownSnap.clusters) {
      if (!raw || typeof raw !== "object") continue;
      const rec = raw as Record<string, unknown>;
      const phrase = typeof rec.phrase === "string" ? normalizeText(rec.phrase) : "";
      const share = Number(rec.trafficSharePct ?? 0) || 0;
      const target = toCanonicalPublicWesetupPath(
        typeof rec.mappedTargetUrl === "string"
          ? rec.mappedTargetUrl
          : mapSimilarwebPhraseToWesetupUrl(phrase),
      );
      if (phrase) ownShareByPhrase.set(phrase, Math.max(ownShareByPhrase.get(phrase) ?? 0, share));
      if (target) ownShareByTarget.set(target, Math.max(ownShareByTarget.get(target) ?? 0, share));
    }
  }

  // Count active purchased backlinks per canonical target URL
  const linksByTarget = new Map<string, number>();
  for (const ord of input.existingOrders ?? []) {
    if (ord.status === "rejected" || ord.status === "failed" || ord.status === "cancelled") {
      continue;
    }
    const target = toCanonicalPublicWesetupPath(ord.targetUrl);
    linksByTarget.set(target, (linksByTarget.get(target) ?? 0) + 1);
  }

  // Index Topvisor positions by phrase and target URL
  const parsePos = (val: string | number | null | undefined): number | null => {
    if (typeof val === "number") return Number.isFinite(val) && val > 0 ? Math.trunc(val) : null;
    if (typeof val === "string") {
      const t = val.trim();
      if (!t || t === "--") return null;
      const n = Number(t);
      return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
    }
    return null;
  };

  const tvRows = input.topvisorRows ?? [];

  const clusterGaps: CompetitorClusterGapRow[] = [];
  const gapCountByDomain = new Map<string, number>();

  for (const [domain, snap] of freshestByDomain.entries()) {
    if (domain === "wesetup.ru") continue;
    const rawClusters = Array.isArray(snap.clusters) ? snap.clusters : [];
    for (const item of rawClusters) {
      if (!item || typeof item !== "object") continue;
      const rec = item as Record<string, unknown>;
      const phrase = typeof rec.phrase === "string" ? rec.phrase.trim() : "";
      if (!phrase) continue;
      const normP = normalizeText(phrase);
      const sharePct = Math.max(0, Math.round((Number(rec.trafficSharePct ?? 0) || 0) * 100) / 100);
      const channel: "organic" | "paid" = rec.channel === "paid" ? "paid" : "organic";
      const mappedTargetUrl = toCanonicalPublicWesetupPath(
        typeof rec.mappedTargetUrl === "string" && rec.mappedTargetUrl.trim()
          ? rec.mappedTargetUrl
          : mapSimilarwebPhraseToWesetupUrl(phrase),
      );

      let bestYandex: number | null = null;
      let bestGoogle: number | null = null;
      for (const row of tvRows) {
        const rowPhrase = normalizeText(row.phrase);
        const rowTarget = row.relevantUrl ? toCanonicalPublicWesetupPath(row.relevantUrl) : null;
        if (rowPhrase !== normP && rowTarget !== mappedTargetUrl) continue;
        const y = parsePos(row.yandexPos);
        const g = parsePos(row.googlePos);
        if (y !== null && (bestYandex === null || y < bestYandex)) bestYandex = y;
        if (g !== null && (bestGoogle === null || g < bestGoogle)) bestGoogle = g;
      }

      const wesetupSharePct =
        ownShareByPhrase.get(normP) ?? ownShareByTarget.get(mappedTargetUrl) ?? null;
      const purchasedLinksCount = linksByTarget.get(mappedTargetUrl) ?? 0;
      const estimatedMonthlyTraffic = Math.round((snap.visitsMonthly * sharePct) / 100);
      const bestPos = bestYandex ?? bestGoogle;

      let verdict: CompetitorBenchmarkVerdict;
      let verdictLabel: string;
      let recommendation: string;

      if (bestPos !== null && bestPos <= 3) {
        verdict = "leader";
        verdictLabel = `В ТОП-3 (#${bestPos})`;
        recommendation = `Удерживаем позицию #${bestPos} на ${mappedTargetUrl} (ссылок: ${purchasedLinksCount})`;
      } else if (bestPos !== null && bestPos >= 4 && bestPos <= 30) {
        verdict = "push_top3";
        verdictLabel = `Дожим в ТОП-3 (#${bestPos})`;
        recommendation =
          purchasedLinksCount === 0
            ? `Страница на #${bestPos} без ссылок — купить 1–2 ссылки на ${mappedTargetUrl} с разбавленным/брендовым анкором`
            : `Страница на #${bestPos} (ссылок: ${purchasedLinksCount}) — усилить анкор-лист и ПФ для выхода в ТОП-3`;
        gapCountByDomain.set(domain, (gapCountByDomain.get(domain) ?? 0) + 1);
      } else if (bestPos === null || bestPos > 30) {
        if (purchasedLinksCount === 0) {
          verdict = "gap_no_rank";
          verdictLabel = "Упущенный кластер";
          recommendation = `Конкурент ${domain} получает ~${estimatedMonthlyTraffic.toLocaleString("ru-RU")} виз./мес (${sharePct}%). Усилить контент ${mappedTargetUrl} и поставить стартовую ссылку`;
        } else {
          verdict = "need_links";
          verdictLabel = "Нужен дожим контента/ссылок";
          recommendation = `Позиция ${bestPos ? `#${bestPos}` : "вне ТОП-50"} при ${purchasedLinksCount} ссылках — проверить интент страницы ${mappedTargetUrl}`;
        }
        gapCountByDomain.set(domain, (gapCountByDomain.get(domain) ?? 0) + 1);
      } else {
        verdict = "parity";
        verdictLabel = "В работе";
        recommendation = `Контроль позиций по ${mappedTargetUrl}`;
      }

      clusterGaps.push({
        phrase,
        mappedTargetUrl,
        competitorDomain: domain,
        competitorVisitsMonthly: snap.visitsMonthly,
        competitorTrafficSharePct: sharePct,
        estimatedMonthlyTraffic,
        competitorChannel: channel,
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

  const domains: CompetitorDomainSummaryRow[] = [...freshestByDomain.values()]
    .map((snap) => {
      const isWesetup = snap.domain === "wesetup.ru";
      const clustersArr = Array.isArray(snap.clusters) ? snap.clusters : [];
      const ratio =
        ownVisits > 0
          ? Math.round((snap.visitsMonthly / ownVisits) * 10) / 10
          : isWesetup
            ? 1
            : 0;
      return {
        domain: snap.domain,
        isWesetup,
        periodLabel: snap.periodLabel,
        visitsMonthly: snap.visitsMonthly,
        visitsRatioVsWesetup: ratio,
        organicSharePct: snap.organicSharePct,
        paidSharePct: snap.paidSharePct,
        bouncePct: snap.bouncePct,
        pagesPerVisit: snap.pagesPerVisit,
        clustersCount: clustersArr.length,
        gapClustersCount: isWesetup ? 0 : (gapCountByDomain.get(snap.domain) ?? 0),
        sourceKind: snap.sourceKind,
      };
    })
    .sort((a, b) => {
      if (a.isWesetup !== b.isWesetup) return a.isWesetup ? -1 : 1;
      return b.visitsMonthly - a.visitsMonthly;
    });

  const competitorsOnly = domains.filter((d) => !d.isWesetup);
  const leader = competitorsOnly[0] ?? null;

  return {
    ownDomain: "wesetup.ru",
    ownVisitsMonthly: ownVisits,
    domains,
    clusterGaps,
    summary: {
      totalCompetitors: competitorsOnly.length,
      leaderVisitsDomain: leader?.domain ?? null,
      leaderVisitsMonthly: leader?.visitsMonthly ?? 0,
      gapNoRankCount: clusterGaps.filter((c) => c.verdict === "gap_no_rank").length,
      pushTop3Count: clusterGaps.filter((c) => c.verdict === "push_top3").length,
      needLinksCount: clusterGaps.filter((c) => c.verdict === "need_links").length,
      leaderCount: clusterGaps.filter((c) => c.verdict === "leader").length,
    },
  };
}

