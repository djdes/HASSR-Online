import type { GglAnchorKind, GglSchedulableFormat, ScoredTargetPage } from "@/lib/seo/gogetlinks-planner";

export interface SeoLinksViewerCapabilities {
  userId: string;
  userName: string;
  isSuperadmin: boolean;
  isPlatformAdmin: boolean;
  hasSeoSection: boolean;
  canApproveWithinPlan: boolean;
  canManagePlans: boolean;
}

export interface GglAccountDto {
  id: string;
  email: string;
  status: string;
  balanceRub: number;
  availableRub: number;
  blockedRub: number;
  defaultCampaignId: number | null;
  allowSeoApproveWithinPlan: boolean;
  lastSyncedAt: string | null;
  lastError: string | null;
}

export interface GglCampaignDto {
  id: string;
  gglCampaignId: number;
  name: string;
  domain: string;
  siteUrl: string;
  isWesetup: boolean;
  state: string;
  spentRub: number;
  linksCount: number;
  requestsCount: number;
  qualityControl: boolean;
  statusNote: string | null;
  targetAnchorsJson: unknown;
  syncedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface GglOrderCampaignRef {
  id: string;
  gglCampaignId: number;
  name: string;
  domain: string;
  isWesetup: boolean;
  state: string;
}

export interface GglOrderDto {
  id: string;
  gglReviewId: number | null;
  campaignId: string;
  campaign: GglOrderCampaignRef | null;
  donorSiteId: number | null;
  donorDomain: string;
  donorDailyTraffic: number | null;
  donorTfCf: string | null;
  donorTrust: number | null;
  placementFormat: string;
  priceRub: number;
  targetUrl: string;
  anchor: string;
  publishedUrl: string | null;
  articleId: string | null;
  paidAt: string | null;
  cancelledAt: string | null;
  indexedStatus: string | null;
  status: string;
  origin: string;
  initiatedByUserId: string | null;
  initiatedByName: string | null;
  approvedByUserId: string | null;
  approvedByName: string | null;
  approvedAt: string | null;
  plannedSlotId: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface GglThreadDto {
  id: string;
  gglThreadKey: string;
  orderId: string | null;
  campaignId: string | null;
  campaign: {
    id: string;
    gglCampaignId: number;
    name: string;
    domain: string;
    isWesetup: boolean;
  } | null;
  order: {
    id: string;
    gglReviewId: number | null;
    donorDomain: string;
    targetUrl: string;
    anchor: string;
    priceRub: number;
    status: string;
    publishedUrl: string | null;
  } | null;
  donorDomain: string | null;
  webmasterLogin: string | null;
  subject: string | null;
  unreadCount: number;
  needsReply: boolean;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface GglMessageDto {
  id: string;
  threadId: string;
  gglMessageId: string | null;
  direction: string;
  authorLabel: string;
  sentByUserId: string | null;
  sentByName: string | null;
  body: string;
  deliveryStatus: string;
  idempotencyKey: string | null;
  sentAt: string;
  createdAt: string;
}

export interface GglSchedulePlanDto {
  id: string;
  name: string;
  campaignId: string;
  kind: string;
  budgetRub: number;
  maxPricePerLinkRub: number;
  startsAt: string | null;
  scheduleDaysOfWeek: unknown;
  minTfCf: number;
  minTrust: number;
  minDailyTraffic: number;
  allowedFormats: unknown;
  anchorMixBrandPct: number;
  isActive: boolean;
  createdByUserId: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface SlotAlternativeDonor {
  siteId: number;
  domain: string;
  priceRub: number;
  format: GglSchedulableFormat;
  metrics: {
    tf: number;
    cf: number;
    trust: number;
    dailyTraffic: number;
  };
}

export interface GglPlannedSlotDto {
  id: string;
  planId: string;
  plan: {
    id: string;
    name: string;
    kind: string;
    campaignId: string;
  } | null;
  scheduledDate: string;
  maxPriceRub: number;
  estimatedPriceRub: number | null;
  targetUrl: string | null;
  targetKeyword: string | null;
  sourceSnapshotId: string | null;
  topvisorPosSnapshot: unknown;
  selectionReason: string | null;
  donorSiteId: number | null;
  donorDomain: string | null;
  donorMetricsJson: unknown;
  placementFormat: string | null;
  anchor: string | null;
  anchorKind: GglAnchorKind | string | null;
  articleId: string | null;
  article: {
    id: string;
    gglArticleId: number | null;
    title: string;
    announcement: string;
    bodyHtml: string;
    anchor: string;
    anchorKind: string;
    status: string;
  } | null;
  briefText: string | null;
  alternativeDonorsJson: unknown;
  status: string;
  approvedByUserId: string | null;
  approvedByName: string | null;
  approvedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface GglArticleDto {
  id: string;
  gglArticleId: number | null;
  campaignId: string;
  targetUrl: string;
  targetKeyword: string;
  anchor: string;
  anchorKind: string;
  title: string;
  announcement: string;
  bodyHtml: string;
  metaTitle: string | null;
  metaDescription: string | null;
  metaKeywords: string | null;
  status: string;
  createdByUserId: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface SimilarwebClusterDto {
  phrase: string;
  trafficSharePct: number;
  channel: "organic" | "paid";
  mappedTargetUrl: string;
  notes?: string;
}

export interface SimilarwebSnapshotDto {
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
  createdByUserId: string | null;
  createdAt: string | null;
}

export interface GglOverviewMetrics {
  monthSpentRub: number;
  monthlyPlanBudgetRub: number;
  next7DaysPendingRub: number;
  counts: {
    paidOrders: number;
    inProgressOrders: number;
    onCheckOrders: number;
    needsReplacementOrders: number;
    unreadThreads: number;
    pendingApprovalSlots: number;
    otherProjectsCampaignsCount: number;
  };
}

export interface GglOverviewResponse {
  includeOtherProjects: boolean;
  account: GglAccountDto | null;
  campaigns: GglCampaignDto[];
  orders: GglOrderDto[];
  threads: GglThreadDto[];
  plans: GglSchedulePlanDto[];
  slots: GglPlannedSlotDto[];
  articles: GglArticleDto[];
  similarwebSnapshots: SimilarwebSnapshotDto[];
  metrics: GglOverviewMetrics;
}

export interface SimilarwebMatrixResponse {
  snapshots: SimilarwebSnapshotDto[];
  priorityMatrix: ScoredTargetPage[];
  topvisor: {
    configured: boolean;
    error: string | null;
  };
}

export const SEO_CARD_CLASS =
  "rounded-3xl border border-[#ececf4] bg-white p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] md:p-6";

export const SEO_INPUT_CLASS =
  "h-10 w-full rounded-2xl border border-[#dcdfed] bg-white px-3.5 text-[13.5px] text-[#0b1024] placeholder:text-[#9b9fb3] transition-colors duration-150 focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15 disabled:bg-[#f4f5fb] disabled:text-[#6f7282]";

export const SEO_TEXTAREA_CLASS =
  "w-full rounded-2xl border border-[#dcdfed] bg-white px-3.5 py-2.5 text-[13.5px] text-[#0b1024] placeholder:text-[#9b9fb3] transition-colors duration-150 focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15 disabled:bg-[#f4f5fb] disabled:text-[#6f7282]";

export const SEO_BTN_PRIMARY_CLASS =
  "inline-flex h-10 items-center justify-center gap-2 rounded-2xl bg-[#5566f6] px-4 text-[13.5px] font-medium text-white shadow-[0_10px_24px_-12px_rgba(85,102,246,0.55)] transition-colors duration-150 hover:bg-[#4a5bf0] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 disabled:cursor-not-allowed disabled:opacity-50";

export const SEO_BTN_OUTLINE_CLASS =
  "inline-flex h-10 items-center justify-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[13.5px] font-medium text-[#0b1024] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 disabled:cursor-not-allowed disabled:opacity-50";

export const SEO_BTN_SM_CLASS =
  "inline-flex h-8 items-center justify-center gap-1.5 rounded-xl border border-[#dcdfed] bg-white px-2.5 text-[12.5px] font-medium text-[#0b1024] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] disabled:cursor-not-allowed disabled:opacity-50";

export function parseSlotAlternatives(raw: unknown): SlotAlternativeDonor[] {
  if (!Array.isArray(raw)) return [];
  const out: SlotAlternativeDonor[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const siteId = Number(rec.siteId);
    const domain = typeof rec.domain === "string" ? rec.domain : "";
    const priceRub = Number(rec.priceRub);
    if (!Number.isFinite(siteId) || siteId <= 0 || !domain) continue;
    const metricsRec =
      rec.metrics && typeof rec.metrics === "object"
        ? (rec.metrics as Record<string, unknown>)
        : {};
    out.push({
      siteId,
      domain,
      priceRub: Number.isFinite(priceRub) ? priceRub : 0,
      format: rec.format === "note" ? "note" : "article",
      metrics: {
        tf: Number(metricsRec.tf ?? 0) || 0,
        cf: Number(metricsRec.cf ?? 0) || 0,
        trust: Number(metricsRec.trust ?? 0) || 0,
        dailyTraffic: Number(metricsRec.dailyTraffic ?? 0) || 0,
      },
    });
  }
  return out;
}

export function parseSlotDonorMetrics(raw: unknown): {
  tf: number | null;
  cf: number | null;
  trust: number | null;
  dailyTraffic: number | null;
} {
  if (!raw || typeof raw !== "object") {
    return { tf: null, cf: null, trust: null, dailyTraffic: null };
  }
  const rec = raw as Record<string, unknown>;
  const numOrNull = (val: unknown): number | null => {
    const n = Number(val);
    return val !== null && val !== undefined && Number.isFinite(n) ? n : null;
  };
  return {
    tf: numOrNull(rec.tf),
    cf: numOrNull(rec.cf),
    trust: numOrNull(rec.trust),
    dailyTraffic: numOrNull(rec.dailyTraffic),
  };
}

export function parseTopvisorSnapshot(raw: unknown): {
  yandexPos: number | null;
  googlePos: number | null;
} {
  if (!raw || typeof raw !== "object") {
    return { yandexPos: null, googlePos: null };
  }
  const rec = raw as Record<string, unknown>;
  const parsePos = (val: unknown): number | null => {
    const n = Number(val);
    return val !== null && val !== undefined && Number.isFinite(n) && n > 0 ? n : null;
  };
  return {
    yandexPos: parsePos(rec.yandexPos),
    googlePos: parsePos(rec.googlePos),
  };
}

export function shortWesetupPath(url: string | null | undefined): string {
  if (!url) return "—";
  return url.replace(/^https?:\/\/(?:www\.)?wesetup\.ru/i, "") || "/";
}

export function formatRuDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatRuShortDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    const [y, m, d] = dateStr.split("-");
    return `${d}.${m}.${y}`;
  }
  const parsed = new Date(dateStr);
  if (Number.isNaN(parsed.getTime())) return dateStr;
  return parsed.toLocaleDateString("ru-RU");
}
