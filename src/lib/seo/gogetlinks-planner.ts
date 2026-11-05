import { SEO_LANDINGS } from "@/content/seo-landings";
import { ACTIVE_JOURNAL_TEMPLATES } from "@/lib/journal-catalog";

export type GglAnchorKind = "exact" | "diluted" | "url_brand";
export type GglSchedulableFormat = "article" | "note";

export interface CompetitorClusterInput {
  snapshotId?: string | null;
  domain: string;
  phrase: string;
  trafficSharePct: number;
  channel: "organic" | "paid";
  mappedTargetUrl: string;
  notes?: string | null;
}

export interface TopvisorPositionInput {
  phrase: string;
  yandexPos?: string | number | null;
  googlePos?: string | number | null;
  relevantUrl?: string | null;
}

export interface ExistingBacklinkInput {
  targetUrl: string;
  anchor?: string | null;
  anchorKind?: GglAnchorKind | string | null;
  status?: string | null;
}

export interface CandidateSitePage {
  url: string;
  title: string;
  facts?: readonly string[];
  keywords?: readonly string[];
}

export interface ScoredTargetPage {
  targetUrl: string;
  title: string;
  primaryKeyword: string;
  sourceSnapshotId: string | null;
  competitorDomain: string | null;
  competitorTrafficSharePct: number;
  competitorChannel: "organic" | "paid" | null;
  yandexPos: number | null;
  googlePos: number | null;
  existingLinksCount: number;
  score: number;
  priorityTier: "push_top3" | "zero_links" | "growth" | "baseline";
  selectionReason: string;
}

export interface SelectAnchorInput {
  targetUrl: string;
  keyword: string;
  existingAnchors: ReadonlyArray<{
    anchorKind: GglAnchorKind;
    anchor?: string | null;
  }>;
  minBrandPct: number;
}

export interface SelectedAnchor {
  anchor: string;
  anchorKind: GglAnchorKind;
}

export interface DonorCandidate {
  siteId: number;
  domain: string;
  priceArticleRub: number | null;
  priceNoteRub: number | null;
  tf: number;
  cf: number;
  trust: number;
  dailyTraffic: number;
  indexedYandex: boolean;
  indexedGoogle: boolean;
}

export interface SelectedDonorCandidate extends DonorCandidate {
  selectedFormat: GglSchedulableFormat;
  selectedPriceRub: number;
  valueScore: number;
}

export interface DonorFilter {
  maxPricePerLinkRub: number;
  minTfCf: number;
  minTrust: number;
  minDailyTraffic: number;
  allowedFormats: readonly GglSchedulableFormat[];
  requireBothIndexed?: boolean;
}

export interface SchedulePlanWindow {
  kind: "one_time" | "monthly";
  budgetRub: number;
  maxPricePerLinkRub: number;
  startsAt: Date;
  scheduleDaysOfWeek: readonly number[];
  alreadyCommittedRub?: number;
  /** Optional per-month (`YYYY-MM`) pre-committed spend map for `kind === "monthly"`. */
  committedByMonthRub?: Readonly<Record<string, number>>;
}

export interface ScheduledSlotDate {
  scheduledDate: string;
  maxPriceRub: number;
}

const INACTIVE_ORDER_STATUSES = new Set(["rejected", "failed", "cancelled"]);

export function normalizeDomainName(raw: string): string {
  const trimmed = String(raw ?? "").trim().toLowerCase();
  if (!trimmed) return "";
  const withoutProto = trimmed.replace(/^[a-z]+:\/\//i, "");
  const host = withoutProto.split(/[/?#]/)[0] ?? "";
  return host.replace(/^www\./, "").replace(/\.+$/, "");
}

/**
 * Normalizes a Wesetup URL or path into a canonical internal path (e.g. `/zhurnal-haccp`).
 * Returns `null` if the URL points to an external domain or is empty.
 */
export function normalizeWesetupPath(rawUrl: string | null | undefined): string | null {
  if (typeof rawUrl !== "string") return null;
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;

  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const parsed = new URL(trimmed);
      const host = normalizeDomainName(parsed.hostname);
      if (host !== "wesetup.ru") return null;
      const pathname = parsed.pathname.replace(/\/+$/, "") || "/";
      return pathname.startsWith("/") ? pathname : `/${pathname}`;
    } catch {
      return null;
    }
  }

  const clean = trimmed.split(/[?#]/)[0]?.trim() ?? "";
  if (!clean) return null;
  const withSlash = clean.startsWith("/") ? clean : `/${clean}`;
  const withoutTrailing = withSlash.replace(/\/+$/, "");
  return withoutTrailing || "/";
}

export function toCanonicalWesetupUrl(rawUrl: string): string {
  const normalizedPath = normalizeWesetupPath(rawUrl) ?? "/";
  return normalizedPath === "/"
    ? "https://wesetup.ru/"
    : `https://wesetup.ru${normalizedPath}`;
}

/**
 * Safely parses a Topvisor position value (`"11"`, `"--"`, `null`, `number`)
 * without ever returning `NaN`, `0`, or negative numbers.
 */
export function parseSafePosition(raw: string | number | null | undefined): number | null {
  if (typeof raw === "number") {
    return Number.isFinite(raw) && raw > 0 ? Math.trunc(raw) : null;
  }
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed || trimmed === "--") return null;
    const numeric = Number(trimmed);
    return Number.isFinite(numeric) && numeric > 0 ? Math.trunc(numeric) : null;
  }
  return null;
}

function formatSharePct(pct: number): string {
  if (!Number.isFinite(pct) || pct <= 0) return "0%";
  return `${Number(pct.toFixed(2))}%`;
}

function normalizePhrase(raw: string | null | undefined): string {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ");
}

/**
 * Builds the default catalog of published Wesetup commercial pages and journal
 * landing hubs, enriched with real facts from `SEO_LANDINGS` so article prompts
 * and scoring always rely on verified product capabilities.
 */
export function buildDefaultCandidateSitePages(
  extraPages: readonly CandidateSitePage[] = [],
): CandidateSitePage[] {
  const byPath = new Map<string, CandidateSitePage>();

  const register = (page: CandidateSitePage) => {
    const norm = normalizeWesetupPath(page.url);
    if (!norm || byPath.has(norm)) return;
    byPath.set(norm, {
      url: norm,
      title: page.title.trim() || norm,
      facts: page.facts,
      keywords: page.keywords,
    });
  };

  for (const landing of Object.values(SEO_LANDINGS)) {
    register({
      url: `/${landing.slug}`,
      title: landing.hero || landing.navLabel,
      facts: [
        landing.intro,
        landing.weSetupBenefit,
        ...landing.fields.slice(0, 5).map((field) => `Поле журнала: ${field}`),
      ],
      keywords: landing.keywords ?? [landing.navLabel.toLowerCase()],
    });
  }

  register({
    url: "/journals-info",
    title: "Каталог электронных журналов ХАССП и СанПиН для общепита",
    facts: [
      "Полный каталог электронных журналов ХАССП и СанПиН 2.3/2.4.4282-26 в WeSetup с печатью PDF для Роспотребнадзора.",
      "Поддержка заполнения со смартфона, по QR-коду оборудования и в Telegram.",
    ],
    keywords: ["хассп журналы и их заполнение", "электронные журналы хассп"],
  });

  register({
    url: "/sanpin-2-3-2-4-4282-26",
    title: "СанПиН 2.3/2.4.4282-26 для общепита: изменения и журналы контроля",
    facts: [
      "Разбор актуальных санитарных правил для предприятий общественного питания и перечень обязательных журналов.",
      "Разрешено ведение журналов в электронном виде при идентификации ответственного сотрудника.",
    ],
    keywords: ["санпин", "санпин 2.3/2.4.4282-26"],
  });

  register({
    url: "/calc/journals",
    title: "Подбор комплекта журналов ХАССП и СанПиН под предприятие",
    facts: [
      "Онлайн-калькулятор обязательного перечня журналов для кафе, ресторана, пекарни, столовой и пищевого цеха.",
    ],
    keywords: ["журналы по хассп для пищевого производства", "какие журналы нужны для кафе"],
  });

  for (const journal of ACTIVE_JOURNAL_TEMPLATES) {
    register({
      url: `/journals-info/${journal.code}`,
      title: journal.name,
      facts: [
        `Электронный «${journal.name}» в сервисе WeSetup с контролем отклонений и выгрузкой в PDF.`,
      ],
      keywords: [journal.name.toLowerCase()],
    });
  }

  for (const extra of extraPages) {
    register(extra);
  }

  return [...byPath.values()];
}

export function scoreTargetPages(input: {
  clusters: CompetitorClusterInput[];
  topvisorRows: TopvisorPositionInput[];
  existingOrders: ExistingBacklinkInput[];
  candidatePages: CandidateSitePage[];
}): ScoredTargetPage[] {
  const pagesToScore: CandidateSitePage[] = [];
  const seenUrls = new Set<string>();

  if (input.candidatePages.length > 0) {
    for (const page of input.candidatePages) {
      const norm = normalizeWesetupPath(page.url);
      if (!norm || seenUrls.has(norm)) continue;
      seenUrls.add(norm);
      pagesToScore.push({ ...page, url: norm });
    }
  } else {
    for (const cluster of input.clusters) {
      const norm = normalizeWesetupPath(cluster.mappedTargetUrl);
      if (!norm || seenUrls.has(norm)) continue;
      seenUrls.add(norm);
      pagesToScore.push({ url: norm, title: cluster.phrase || norm });
    }
  }

  // Group active existing orders by normalized target path
  const linksCountByUrl = new Map<string, number>();
  for (const order of input.existingOrders) {
    if (order.status && INACTIVE_ORDER_STATUSES.has(order.status)) continue;
    const norm = normalizeWesetupPath(order.targetUrl);
    if (!norm) continue;
    linksCountByUrl.set(norm, (linksCountByUrl.get(norm) ?? 0) + 1);
  }

  // Group Similarweb clusters by normalized mappedTargetUrl
  const clustersByUrl = new Map<string, CompetitorClusterInput[]>();
  for (const cluster of input.clusters) {
    const norm = normalizeWesetupPath(cluster.mappedTargetUrl);
    if (!norm) continue;
    const bucket = clustersByUrl.get(norm) ?? [];
    bucket.push(cluster);
    clustersByUrl.set(norm, bucket);
  }

  const scored: ScoredTargetPage[] = pagesToScore.map((page) => {
    const matchedClusters = [...(clustersByUrl.get(page.url) ?? [])].sort((a, b) => {
      const aCompetitorBonus = normalizeDomainName(a.domain) === "wesetup.ru" ? 0.6 : 1;
      const bCompetitorBonus = normalizeDomainName(b.domain) === "wesetup.ru" ? 0.6 : 1;
      const aWeight =
        (Number.isFinite(a.trafficSharePct) ? Math.max(0, a.trafficSharePct) : 0) *
        (a.channel === "paid" ? 1.35 : 1.1) *
        aCompetitorBonus;
      const bWeight =
        (Number.isFinite(b.trafficSharePct) ? Math.max(0, b.trafficSharePct) : 0) *
        (b.channel === "paid" ? 1.35 : 1.1) *
        bCompetitorBonus;
      return bWeight - aWeight;
    });

    const bestCluster = matchedClusters[0] ?? null;
    const phraseSet = new Set<string>();
    for (const c of matchedClusters) {
      const p = normalizePhrase(c.phrase);
      if (p) phraseSet.add(p);
    }
    for (const kw of page.keywords ?? []) {
      const p = normalizePhrase(kw);
      if (p) phraseSet.add(p);
    }

    let bestYandexPos: number | null = null;
    let bestGooglePos: number | null = null;
    let matchedTopvisorPhrase: string | null = null;

    for (const row of input.topvisorRows) {
      const rowPath = normalizeWesetupPath(row.relevantUrl);
      const rowPhrase = normalizePhrase(row.phrase);
      const urlMatches = rowPath === page.url;
      const phraseMatches = Boolean(rowPhrase && phraseSet.has(rowPhrase));
      if (!urlMatches && !phraseMatches) continue;

      if (!matchedTopvisorPhrase && row.phrase?.trim()) {
        matchedTopvisorPhrase = row.phrase.trim();
      }

      const yPos = parseSafePosition(row.yandexPos);
      const gPos = parseSafePosition(row.googlePos);

      if (yPos !== null && (bestYandexPos === null || yPos < bestYandexPos)) {
        bestYandexPos = yPos;
        if (row.phrase?.trim()) matchedTopvisorPhrase = row.phrase.trim();
      }
      if (gPos !== null && (bestGooglePos === null || gPos < bestGooglePos)) {
        bestGooglePos = gPos;
      }
    }

    const existingLinksCount = linksCountByUrl.get(page.url) ?? 0;

    // 1. Competitor Similarweb demand score
    const primaryShare = bestCluster && Number.isFinite(bestCluster.trafficSharePct)
      ? Math.min(100, Math.max(0, bestCluster.trafficSharePct))
      : 0;
    const channelMultiplier = bestCluster?.channel === "paid" ? 1.35 : 1.1;
    const domainMultiplier =
      bestCluster && normalizeDomainName(bestCluster.domain) === "wesetup.ru" ? 0.65 : 1.0;
    const extraClustersBonus = Math.min(20, Math.max(0, matchedClusters.length - 1) * 6);
    const demandScore = primaryShare * channelMultiplier * domainMultiplier + extraClustersBonus;

    // 2. Topvisor position bonus (positions 4..30 = prime push-to-TOP-3 zone)
    const effectivePos = bestYandexPos ?? bestGooglePos;
    let positionScore = 0;
    let inPushZone = false;
    if (effectivePos !== null) {
      if (effectivePos >= 4 && effectivePos <= 10) {
        positionScore = 65;
        inPushZone = true;
      } else if (effectivePos >= 11 && effectivePos <= 30) {
        positionScore = 50;
        inPushZone = true;
      } else if (effectivePos >= 31 && effectivePos <= 50) {
        positionScore = 20;
      } else if (effectivePos >= 1 && effectivePos <= 3) {
        positionScore = 8;
      } else {
        positionScore = 10;
      }
    } else if (primaryShare > 0) {
      positionScore = 12;
    }

    // 3. Backlink deficit bonus (0 links gets strongest boost)
    let backlinkBonus = 0;
    if (existingLinksCount === 0) {
      backlinkBonus = 35;
    } else if (existingLinksCount === 1) {
      backlinkBonus = 15;
    } else if (existingLinksCount === 2) {
      backlinkBonus = 5;
    } else {
      backlinkBonus = -Math.min(25, (existingLinksCount - 2) * 8);
    }

    const rawScore = Math.max(0, demandScore + positionScore + backlinkBonus);
    const score = Number.isFinite(rawScore) ? Math.round(rawScore * 100) / 100 : 0;

    const priorityTier: ScoredTargetPage["priorityTier"] = inPushZone
      ? "push_top3"
      : existingLinksCount === 0 && primaryShare > 0
        ? "zero_links"
        : primaryShare > 0 || effectivePos !== null
          ? "growth"
          : "baseline";

    const primaryKeyword =
      bestCluster?.phrase?.trim() ||
      matchedTopvisorPhrase ||
      page.keywords?.[0]?.trim() ||
      page.title;

    // Human-readable Russian explanation
    const posSummary =
      bestYandexPos !== null
        ? `позиция в Яндексе: ${bestYandexPos}${inPushZone ? " (зона дожима в ТОП-3)" : ""}`
        : bestGooglePos !== null
          ? `позиция в Google: ${bestGooglePos}${inPushZone ? " (зона дожима в ТОП-3)" : ""}`
          : "позиция в Topvisor: вне ТОП-50";

    let selectionReason: string;
    if (bestCluster && primaryShare > 0) {
      const channelLabel = bestCluster.channel === "paid" ? "платного" : "органического";
      selectionReason = `Кластер «${bestCluster.phrase}» даёт ${formatSharePct(primaryShare)} ${channelLabel} трафика ${bestCluster.domain}; ${posSummary}, купленных ссылок: ${existingLinksCount}`;
    } else if (effectivePos !== null) {
      selectionReason = `Запрос «${primaryKeyword}» — ${posSummary}, купленных ссылок: ${existingLinksCount}`;
    } else {
      selectionReason = `Посадочная «${page.title}» (${page.url}), купленных ссылок: ${existingLinksCount}`;
    }

    return {
      targetUrl: page.url,
      title: page.title,
      primaryKeyword,
      sourceSnapshotId: bestCluster?.snapshotId ?? null,
      competitorDomain: bestCluster ? normalizeDomainName(bestCluster.domain) : null,
      competitorTrafficSharePct: primaryShare,
      competitorChannel: bestCluster?.channel ?? null,
      yandexPos: bestYandexPos,
      googlePos: bestGooglePos,
      existingLinksCount,
      score,
      priorityTier,
      selectionReason,
    };
  });

  return scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.existingLinksCount !== b.existingLinksCount) {
      return a.existingLinksCount - b.existingLinksCount;
    }
    return a.targetUrl.localeCompare(b.targetUrl);
  });
}

export function selectAnchorForTarget(input: SelectAnchorInput): SelectedAnchor {
  const canonicalUrl = toCanonicalWesetupUrl(input.targetUrl);
  const cleanKeyword = String(input.keyword ?? "").trim().replace(/\s+/g, " ");
  const minBrandPct = Number.isFinite(input.minBrandPct)
    ? Math.min(100, Math.max(0, input.minBrandPct))
    : 50;

  const totalExisting = input.existingAnchors.length;
  const brandCount = input.existingAnchors.filter((a) => a.anchorKind === "url_brand").length;
  const exactCount = input.existingAnchors.filter((a) => a.anchorKind === "exact").length;
  const dilutedCount = input.existingAnchors.filter((a) => a.anchorKind === "diluted").length;

  const brandVariants = [
    "wesetup.ru",
    canonicalUrl,
    "WeSetup",
    "на сайте wesetup.ru",
  ];

  const pickBrand = (): SelectedAnchor => ({
    anchor: brandVariants[brandCount % brandVariants.length]!,
    anchorKind: "url_brand",
  });

  if (!cleanKeyword || minBrandPct >= 100) {
    return pickBrand();
  }

  // If this is the very first link and minBrandPct > 50, start with brand/URL so brand share stays high.
  if (totalExisting === 0 && minBrandPct > 50) {
    return pickBrand();
  }

  // For totalExisting >= 1: check what brand share would be if we add a non-brand anchor next.
  if (totalExisting >= 1) {
    const brandPctIfNonBrand = (brandCount / (totalExisting + 1)) * 100;
    if (brandPctIfNonBrand < minBrandPct) {
      return pickBrand();
    }
  }

  // Anti-over-optimization: at most 1 exact anchor per targetUrl; subsequent commercial anchors are diluted.
  if (exactCount === 0) {
    return {
      anchor: cleanKeyword,
      anchorKind: "exact",
    };
  }

  const dilutedVariants = [
    `${cleanKeyword} в WeSetup`,
    `образец: ${cleanKeyword}`,
    `${cleanKeyword} онлайн`,
  ];
  return {
    anchor: dilutedVariants[dilutedCount % dilutedVariants.length]!,
    anchorKind: "diluted",
  };
}

export function selectBestDonorAndAlternatives(
  candidates: DonorCandidate[],
  usedDonorDomains: ReadonlySet<string>,
  filter: DonorFilter,
): { primary: SelectedDonorCandidate | null; alternatives: SelectedDonorCandidate[] } {
  const normalizedUsed = new Set<string>();
  for (const domain of usedDonorDomains) {
    const norm = normalizeDomainName(domain);
    if (norm) normalizedUsed.add(norm);
  }

  const allowedFormats: readonly GglSchedulableFormat[] =
    filter.allowedFormats.length > 0 ? filter.allowedFormats : ["article", "note"];
  const allowArticle = allowedFormats.includes("article");
  const allowNote = allowedFormats.includes("note");
  const requireBothIndexed = filter.requireBothIndexed ?? true;

  const qualified: SelectedDonorCandidate[] = [];
  const seenCandidateDomains = new Set<string>();

  for (const candidate of candidates) {
    const normDomain = normalizeDomainName(candidate.domain);
    if (!normDomain || normDomain === "wesetup.ru") continue;
    if (normalizedUsed.has(normDomain) || seenCandidateDomains.has(normDomain)) continue;

    if (requireBothIndexed && (!candidate.indexedYandex || !candidate.indexedGoogle)) {
      continue;
    }

    const tf = Number.isFinite(candidate.tf) ? candidate.tf : 0;
    const cf = Number.isFinite(candidate.cf) ? candidate.cf : 0;
    const trust = Number.isFinite(candidate.trust) ? candidate.trust : 0;
    const dailyTraffic = Number.isFinite(candidate.dailyTraffic) ? candidate.dailyTraffic : 0;

    if (tf < filter.minTfCf && cf < filter.minTfCf) continue;
    if (trust < filter.minTrust) continue;
    if (dailyTraffic < filter.minDailyTraffic) continue;

    const articleFits =
      allowArticle &&
      candidate.priceArticleRub !== null &&
      Number.isFinite(candidate.priceArticleRub) &&
      candidate.priceArticleRub > 0 &&
      candidate.priceArticleRub <= filter.maxPricePerLinkRub;

    const noteFits =
      allowNote &&
      candidate.priceNoteRub !== null &&
      Number.isFinite(candidate.priceNoteRub) &&
      candidate.priceNoteRub > 0 &&
      candidate.priceNoteRub <= filter.maxPricePerLinkRub;

    if (!articleFits && !noteFits) continue;

    // Prefer "article" over "note" when both fit within maxPricePerLinkRub
    const selectedFormat: GglSchedulableFormat = articleFits ? "article" : "note";
    const selectedPriceRub = articleFits
      ? (candidate.priceArticleRub as number)
      : (candidate.priceNoteRub as number);

    const valueScore =
      Math.round(
        (((dailyTraffic / 100 + tf + cf + trust * 3) / selectedPriceRub) * 10_000),
      ) / 10_000;

    seenCandidateDomains.add(normDomain);
    qualified.push({
      ...candidate,
      selectedFormat,
      selectedPriceRub,
      valueScore,
    });
  }

  qualified.sort((a, b) => {
    if (b.valueScore !== a.valueScore) return b.valueScore - a.valueScore;
    if (a.selectedFormat !== b.selectedFormat) {
      return a.selectedFormat === "article" ? -1 : 1;
    }
    return a.selectedPriceRub - b.selectedPriceRub;
  });

  return {
    primary: qualified[0] ?? null,
    alternatives: qualified.slice(1, 4),
  };
}

function toUtcMidnightMs(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function formatUtcDateKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function computeScheduleDates(
  plan: SchedulePlanWindow,
  existingDates: ReadonlySet<string>,
  now: Date,
  horizonDays = 30,
): ScheduledSlotDate[] {
  if (
    !Number.isFinite(plan.budgetRub) ||
    plan.budgetRub <= 0 ||
    !Number.isFinite(plan.maxPricePerLinkRub) ||
    plan.maxPricePerLinkRub <= 0 ||
    !Number.isFinite(horizonDays) ||
    horizonDays <= 0
  ) {
    return [];
  }

  const maxPriceRub = Math.trunc(plan.maxPricePerLinkRub);
  const budgetRub = Math.trunc(plan.budgetRub);
  if (maxPriceRub <= 0 || budgetRub < maxPriceRub) return [];

  const todayMs = toUtcMidnightMs(now);
  const startsAtMs = toUtcMidnightMs(plan.startsAt);
  const endExclusiveMs = todayMs + Math.trunc(horizonDays) * 86_400_000;

  const rawDays = plan.scheduleDaysOfWeek.filter(
    (d) => Number.isInteger(d) && d >= 0 && d <= 7,
  );
  // Default to Tuesday (2) & Friday (5) when scheduleDaysOfWeek is empty
  const allowedIsoWeekdays = new Set<number>(
    (rawDays.length > 0 ? rawDays : [2, 5]).map((d) => (d === 0 ? 7 : d)),
  );

  const initialCommitted = Math.max(0, Math.trunc(plan.alreadyCommittedRub ?? 0));
  let remainingOneTimeRub = Math.max(0, budgetRub - initialCommitted);

  // For monthly plans, track remaining budget per YYYY-MM calendar month
  const baseActiveMonthKey = formatUtcDateKey(Math.max(todayMs, startsAtMs)).slice(0, 7);
  const committedPerMonth = new Map<string, number>();
  if (plan.committedByMonthRub) {
    for (const [monthKey, amount] of Object.entries(plan.committedByMonthRub)) {
      if (Number.isFinite(amount) && amount > 0) {
        committedPerMonth.set(monthKey, Math.trunc(amount));
      }
    }
  }
  if (!committedPerMonth.has(baseActiveMonthKey) && initialCommitted > 0) {
    committedPerMonth.set(baseActiveMonthKey, initialCommitted);
  }

  const scheduled: ScheduledSlotDate[] = [];

  for (
    let cursorMs = Math.max(todayMs, startsAtMs);
    cursorMs < endExclusiveMs;
    cursorMs += 86_400_000
  ) {
    const utcDay = new Date(cursorMs).getUTCDay();
    const isoDay = utcDay === 0 ? 7 : utcDay;
    if (!allowedIsoWeekdays.has(isoDay)) continue;

    const dateKey = formatUtcDateKey(cursorMs);
    if (existingDates.has(dateKey)) continue;

    if (plan.kind === "one_time") {
      if (remainingOneTimeRub < maxPriceRub) break;
      scheduled.push({ scheduledDate: dateKey, maxPriceRub });
      remainingOneTimeRub -= maxPriceRub;
    } else {
      const monthKey = dateKey.slice(0, 7);
      const monthCommitted = committedPerMonth.get(monthKey) ?? 0;
      if (budgetRub - monthCommitted < maxPriceRub) {
        continue;
      }
      scheduled.push({ scheduledDate: dateKey, maxPriceRub });
      committedPerMonth.set(monthKey, monthCommitted + maxPriceRub);
    }
  }

  return scheduled;
}
