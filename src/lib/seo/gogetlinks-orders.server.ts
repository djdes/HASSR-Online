import type { GglPlannedSlot, GglSchedulePlan, Prisma } from "@prisma/client";
import type { Session } from "next-auth";
import { audit } from "@/lib/audit-helper";
import { db } from "@/lib/db";
import { PLATFORM_SECTION_KEYS } from "@/lib/platform-access";
import { platformViewerForSession } from "@/lib/platform-access.server";
import { canApproveGglSpend } from "@/lib/seo/gogetlinks-access";
import {
  type GeneratedGglContent,
  type GenerateGglArticleInput,
  generateGglArticleDraft,
} from "@/lib/seo/gogetlinks-article-ai.server";
import {
  callGglRead,
  callGglWrite,
  GglAuthError,
  GglCallError,
  GglIsolationError,
} from "@/lib/seo/gogetlinks-client.server";
import { parseRubAmount, parseTfCf } from "@/lib/seo/gogetlinks-codec";
import {
  buildDefaultCandidateSitePages,
  type CandidateSitePage,
  type CompetitorClusterInput,
  computeScheduleDates,
  type DonorCandidate,
  type ExistingBacklinkInput,
  type GglAnchorKind,
  type GglSchedulableFormat,
  isPublicSeoTargetAllowed,
  normalizeDomainName,
  normalizeWesetupPath,
  resolvePublicSeoTargetPath,
  scoreTargetPages,
  selectAnchorForTarget,
  selectBestDonorAndAlternatives,
  type TopvisorPositionInput,
  toCanonicalWesetupUrl,
} from "@/lib/seo/gogetlinks-planner";
import { decimalToNumber } from "@/lib/seo/gogetlinks-sync.server";
import { getPositionsHistory, isTopvisorConfigured, type PositionMatrix } from "@/lib/topvisor";

const platformOrgId = (): string => process.env.PLATFORM_ORG_ID?.trim() || "platform";

export class GglOrderError extends Error {
  public readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "GglOrderError";
    this.status = status;
  }
}

export interface PlatformActor {
  id: string;
  name: string;
  isRoot: boolean;
  platformSections: readonly string[];
}

export interface OrderAuditEntry {
  action: string;
  entity: string;
  entityId: string;
  actor: { id: string; name: string };
  details: Record<string, unknown>;
}

export interface AlternativeDonorEntry {
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

export interface UpsertPlanInput {
  id?: string;
  name: string;
  campaignId: string;
  kind: "one_time" | "monthly";
  budgetRub: number;
  maxPricePerLinkRub: number;
  startsAt?: Date | string;
  scheduleDaysOfWeek?: number[];
  minTfCf?: number;
  minTrust?: number;
  minDailyTraffic?: number;
  allowedFormats?: GglSchedulableFormat[];
  anchorMixBrandPct?: number;
  isActive?: boolean;
}

export interface ArticlePatch {
  title?: string;
  announcement?: string;
  bodyHtml?: string;
  metaTitle?: string;
  metaDescription?: string;
  metaKeywords?: string;
  anchor?: string;
  anchorKind?: GglAnchorKind;
  briefText?: string;
}

export interface ManualOrderInput {
  campaignId?: string;
  donorSiteId: number;
  donorDomain: string;
  placementFormat: "article" | "note" | "context";
  maxPriceRub: number;
  targetUrl: string;
  anchor: string;
  anchorKind?: GglAnchorKind;
  articleId?: string | null;
  articleDraft?: {
    title: string;
    announcement?: string;
    bodyHtml: string;
    metaTitle?: string;
    metaDescription?: string;
    metaKeywords?: string;
  } | null;
  briefText?: string | null;
  idempotencyKey: string;
}

export interface ClaimedSlotForSend {
  id: string;
  maxPriceRub: number;
  donorSiteId: number;
  donorDomain: string;
  donorMetrics?: {
    tf?: number;
    cf?: number;
    trust?: number;
    dailyTraffic?: number;
  } | null;
  placementFormat: GglSchedulableFormat;
  targetUrl: string;
  anchor: string;
  briefText: string | null;
  campaign: {
    id: string;
    gglCampaignId: number;
    isWesetup: boolean;
  };
  article: {
    id: string;
    gglArticleId: number | null;
    title: string;
    announcement: string;
    bodyHtml: string;
  } | null;
}

export interface UpsertPlanDeps {
  prismaClient?: Pick<typeof db, "gglAccount" | "gglCampaign" | "gglSchedulePlan">;
  getAccountConfig?: () => Promise<{ allowSeoApproveWithinPlan: boolean; availableRub: number }>;
  writeAudit?: (entry: OrderAuditEntry) => Promise<void>;
}

export interface ActivePlanForMaterialize {
  id: string;
  campaignId: string;
  isWesetup: boolean;
  kind: "one_time" | "monthly";
  budgetRub: number;
  maxPricePerLinkRub: number;
  startsAt: Date;
  scheduleDaysOfWeek: readonly number[];
  existingSlots: ReadonlyArray<{
    scheduledDate: string;
    maxPriceRub: number;
    estimatedPriceRub: number | null;
    status: string;
  }>;
}

export interface MaterializeSlotsDeps {
  prismaClient?: Pick<typeof db, "gglSchedulePlan" | "gglPlannedSlot">;
  loadActivePlans?: () => Promise<ActivePlanForMaterialize[]>;
  createSlot?: (data: {
    planId: string;
    scheduledDate: string;
    maxPriceRub: number;
    status: "planned";
    idempotencyKey: string;
  }) => Promise<boolean>;
}

export interface UpcomingPlannedSlotRecord {
  id: string;
  planId: string;
  scheduledDate: string;
  maxPriceRub: number;
  plan: {
    id: string;
    campaignId: string;
    minTfCf: number;
    minTrust: number;
    minDailyTraffic: number;
    allowedFormats: readonly GglSchedulableFormat[];
    anchorMixBrandPct: number;
    campaign: {
      id: string;
      gglCampaignId: number;
      isWesetup: boolean;
    };
  };
}

export interface SlotScoringContext {
  clusters: CompetitorClusterInput[];
  topvisorRows: TopvisorPositionInput[];
  existingOrders: ExistingBacklinkInput[];
  usedDonorDomains: Set<string>;
  candidatePages: CandidateSitePage[];
}

export interface PreparedSlotPayload {
  status: "pending_approval";
  estimatedPriceRub: number;
  targetUrl: string;
  targetKeyword: string;
  sourceSnapshotId: string | null;
  topvisorPosSnapshot: { yandexPos: number | null; googlePos: number | null };
  selectionReason: string;
  donorSiteId: number;
  donorDomain: string;
  donorMetrics: { tf: number; cf: number; trust: number; dailyTraffic: number };
  placementFormat: GglSchedulableFormat;
  anchor: string;
  anchorKind: GglAnchorKind;
  briefText: string | null;
  alternativeDonors: AlternativeDonorEntry[];
  generatedContent: GeneratedGglContent;
  campaignId: string;
}

export interface PrepareSlotsDeps {
  prismaClient?: Pick<
    typeof db,
    | "gglPlannedSlot"
    | "gglArticle"
    | "gglOrder"
    | "seoCompetitorSnapshot"
  > &
    Partial<Pick<typeof db, "article">>;
  findUpcomingPlannedSlots?: (todayKey: string, horizonEndKey: string) => Promise<UpcomingPlannedSlotRecord[]>;
  claimSlotPreparing?: (slotId: string) => Promise<boolean>;
  loadScoringContext?: () => Promise<SlotScoringContext>;
  searchCatalogDonors?: (gglCampaignId: number, maxPriceRub: number) => Promise<DonorCandidate[]>;
  generateDraft?: (input: GenerateGglArticleInput) => Promise<GeneratedGglContent>;
  savePreparedSlot?: (slotId: string, payload: PreparedSlotPayload) => Promise<void>;
  revertPreparingSlot?: (slotId: string) => Promise<void>;
}

export interface RecycleDeps {
  prismaClient?: Pick<typeof db, "gglPlannedSlot" | "gglOrder">;
  findRejectedLinkedSlots?: () => Promise<
    Array<{
      slotId: string;
      alternativeDonors: AlternativeDonorEntry[];
    }>
  >;
  applyFallbackDonor?: (
    slotId: string,
    nextDonor: AlternativeDonorEntry,
    remainingAlternatives: AlternativeDonorEntry[],
  ) => Promise<void>;
  markExhaustedSlot?: (slotId: string) => Promise<void>;
}

export interface ApproveSlotDeps {
  prismaClient?: Pick<
    typeof db,
    "gglAccount" | "gglPlannedSlot" | "gglArticle" | "gglOrder"
  >;
  getAccountConfig?: () => Promise<{ allowSeoApproveWithinPlan: boolean; availableRub: number }>;
  claimSlotForSend?: (slotId: string, actor: PlatformActor) => Promise<ClaimedSlotForSend | null>;
  fetchLiveDonorPrice?: (slot: ClaimedSlotForSend) => Promise<number | null>;
  ensureTargetAnchorInGgl?: (slot: ClaimedSlotForSend, idempotencyKey: string) => Promise<void>;
  uploadArticleIfNeeded?: (
    slot: ClaimedSlotForSend,
    idempotencyKey: string,
  ) => Promise<number | null>;
  submitRemoteOrder?: (
    slot: ClaimedSlotForSend,
    uploadedGglArticleId: number | null,
    idempotencyKey: string,
  ) => Promise<{
    status: "applied" | "accepted" | "may_have_applied";
    gglReviewId: number | null;
  }>;
  finalizeSlotOrder?: (
    slotId: string,
    nextSlotStatus: "ordered" | "approved_sending",
    orderMeta: {
      slot: ClaimedSlotForSend;
      livePriceRub: number;
      gglReviewId: number | null;
      orderStatus: "pending_webmaster" | "sending";
      idempotencyKey: string;
      actor: PlatformActor;
    },
  ) => Promise<string>;
  revertSlotToPending?: (slotId: string, reason: string) => Promise<void>;
  writeAudit?: (entry: OrderAuditEntry) => Promise<void>;
}

export interface ManualOrderDeps {
  prismaClient?: Pick<
    typeof db,
    "gglAccount" | "gglCampaign" | "gglArticle" | "gglOrder"
  >;
  getAccountConfig?: () => Promise<{
    allowSeoApproveWithinPlan: boolean;
    availableRub: number;
    defaultCampaignId?: number | null;
  }>;
  fetchLiveDonorPrice?: (args: {
    gglCampaignId: number;
    donorSiteId: number;
    donorDomain: string;
    placementFormat: "article" | "note" | "context";
    maxPriceRub: number;
  }) => Promise<number | null>;
  ensureTargetAnchorInGgl?: (args: {
    campaignId: string;
    gglCampaignId: number;
    targetUrl: string;
    anchor: string;
    idempotencyKey: string;
  }) => Promise<void>;
  uploadArticleIfNeeded?: (args: {
    campaignId: string;
    gglCampaignId: number;
    article: { id: string; gglArticleId: number | null; title: string; bodyHtml: string } | null;
    idempotencyKey: string;
  }) => Promise<number | null>;
  submitRemoteOrder?: (args: {
    campaignId: string;
    gglCampaignId: number;
    donorSiteId: number;
    targetUrl: string;
    anchor: string;
    uploadedGglArticleId: number | null;
    idempotencyKey: string;
  }) => Promise<{
    status: "applied" | "accepted" | "may_have_applied";
    gglReviewId: number | null;
  }>;
  writeAudit?: (entry: OrderAuditEntry) => Promise<void>;
}

export interface MutateSlotDeps {
  prismaClient?: Pick<typeof db, "gglPlannedSlot" | "gglArticle">;
  writeAudit?: (entry: OrderAuditEntry) => Promise<void>;
}

function toIso(date: Date | string | null | undefined): string | null {
  if (!date) return null;
  return new Date(date).toISOString();
}

function isPrismaUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  return (err as { code?: unknown }).code === "P2002";
}

function isExplicitlyNotAppliedError(err: unknown): boolean {
  if (err instanceof GglAuthError || err instanceof GglIsolationError) return true;
  if (err instanceof GglCallError) {
    const cls = (err.gglClass ?? "").toLowerCase();
    if (
      cls === "not_sent" ||
      cls === "not_applied" ||
      cls === "input" ||
      cls === "refused" ||
      cls === "auth"
    ) {
      return true;
    }
    if (/\b(not_sent|not_applied|did not run)\b/i.test(err.message)) {
      return true;
    }
  }
  return false;
}

function assertSafeArticleHtml(html: string): void {
  if (
    /<\s*(?:script|iframe|object|embed|style)\b/i.test(html) ||
    /\bon\w+\s*=/i.test(html) ||
    /javascript\s*:/i.test(html)
  ) {
    throw new GglOrderError(422, "Текст статьи содержит недопустимую HTML-разметку");
  }
}

async function defaultWriteAudit(entry: OrderAuditEntry): Promise<void> {
  await audit({
    orgId: platformOrgId(),
    action: entry.action,
    entity: entry.entity,
    entityId: entry.entityId,
    actor: entry.actor,
    details: entry.details,
  });
}

export async function resolveGglActorFromSession(
  session: Session,
  loadViewer: typeof platformViewerForSession = platformViewerForSession,
): Promise<PlatformActor> {
  const viewer = await loadViewer(session);
  const superadmin = viewer.superadmin || session.user.isRoot === true;
  return {
    id: session.user.id,
    name: session.user.name?.trim() || session.user.email?.trim() || "root",
    isRoot: superadmin,
    platformSections: superadmin ? [...PLATFORM_SECTION_KEYS] : [...viewer.sections],
  };
}

export function serializeSchedulePlan(plan: {
  id: string;
  name: string;
  campaignId: string;
  kind: string;
  budgetRub: number;
  maxPricePerLinkRub: number;
  startsAt: Date | string;
  scheduleDaysOfWeek: unknown;
  minTfCf: number;
  minTrust: number;
  minDailyTraffic: number;
  allowedFormats: unknown;
  anchorMixBrandPct: number;
  isActive: boolean;
  createdByUserId: string | null;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
}) {
  return {
    id: plan.id,
    name: plan.name,
    campaignId: plan.campaignId,
    kind: plan.kind,
    budgetRub: plan.budgetRub,
    maxPricePerLinkRub: plan.maxPricePerLinkRub,
    startsAt: toIso(plan.startsAt),
    scheduleDaysOfWeek: plan.scheduleDaysOfWeek,
    minTfCf: plan.minTfCf,
    minTrust: plan.minTrust,
    minDailyTraffic: plan.minDailyTraffic,
    allowedFormats: plan.allowedFormats,
    anchorMixBrandPct: plan.anchorMixBrandPct,
    isActive: plan.isActive,
    createdByUserId: plan.createdByUserId,
    createdAt: toIso(plan.createdAt),
    updatedAt: toIso(plan.updatedAt),
  };
}

export function serializePlannedSlot(slot: {
  id: string;
  planId: string;
  plan?: { id: string; name: string; kind: string; campaignId: string } | null;
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
  anchorKind: string | null;
  articleId: string | null;
  article?: {
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
  approvedAt: Date | string | null;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
}) {
  return {
    id: slot.id,
    planId: slot.planId,
    plan: slot.plan ?? null,
    scheduledDate: slot.scheduledDate,
    maxPriceRub: slot.maxPriceRub,
    estimatedPriceRub: slot.estimatedPriceRub,
    targetUrl: slot.targetUrl,
    targetKeyword: slot.targetKeyword,
    sourceSnapshotId: slot.sourceSnapshotId,
    topvisorPosSnapshot: slot.topvisorPosSnapshot,
    selectionReason: slot.selectionReason,
    donorSiteId: slot.donorSiteId,
    donorDomain: slot.donorDomain,
    donorMetricsJson: slot.donorMetricsJson,
    placementFormat: slot.placementFormat,
    anchor: slot.anchor,
    anchorKind: slot.anchorKind,
    articleId: slot.articleId,
    article: slot.article ?? null,
    briefText: slot.briefText,
    alternativeDonorsJson: slot.alternativeDonorsJson,
    status: slot.status,
    approvedByUserId: slot.approvedByUserId,
    approvedByName: slot.approvedByName,
    approvedAt: toIso(slot.approvedAt),
    createdAt: toIso(slot.createdAt),
    updatedAt: toIso(slot.updatedAt),
  };
}

export function normalizeDonorCatalogRow(raw: Record<string, unknown>): DonorCandidate | null {
  if (!raw || typeof raw !== "object") return null;

  if (
    typeof raw.siteId === "number" &&
    typeof raw.domain === "string" &&
    ("priceArticleRub" in raw || "priceNoteRub" in raw)
  ) {
    const cleanDomain = normalizeDomainName(raw.domain);
    if (!cleanDomain) return null;
    return {
      siteId: Math.trunc(raw.siteId),
      domain: cleanDomain,
      priceArticleRub:
        typeof raw.priceArticleRub === "number" && Number.isFinite(raw.priceArticleRub)
          ? raw.priceArticleRub
          : null,
      priceNoteRub:
        typeof raw.priceNoteRub === "number" && Number.isFinite(raw.priceNoteRub)
          ? raw.priceNoteRub
          : null,
      tf: typeof raw.tf === "number" && Number.isFinite(raw.tf) ? raw.tf : 0,
      cf: typeof raw.cf === "number" && Number.isFinite(raw.cf) ? raw.cf : 0,
      trust: typeof raw.trust === "number" && Number.isFinite(raw.trust) ? raw.trust : 0,
      dailyTraffic:
        typeof raw.dailyTraffic === "number" && Number.isFinite(raw.dailyTraffic)
          ? raw.dailyTraffic
          : 0,
      indexedYandex: raw.indexedYandex !== undefined ? Boolean(raw.indexedYandex) : true,
      indexedGoogle: raw.indexedGoogle !== undefined ? Boolean(raw.indexedGoogle) : true,
    };
  }

  const rawSiteId = String(raw.siteId ?? raw.id ?? "").trim();
  const siteIdMatch = rawSiteId.match(/(\d+)/);
  if (!siteIdMatch) return null;
  const siteId = Number.parseInt(siteIdMatch[1], 10);
  if (!Number.isFinite(siteId) || siteId <= 0) return null;

  const domain = normalizeDomainName(String(raw.domain ?? ""));
  if (!domain) return null;

  const parsedTfCf = parseTfCf(typeof raw.tfCf === "string" ? raw.tfCf : null);
  const tf =
    typeof raw.tf === "number" && Number.isFinite(raw.tf) ? raw.tf : (parsedTfCf?.tf ?? 0);
  const cf =
    typeof raw.cf === "number" && Number.isFinite(raw.cf) ? raw.cf : (parsedTfCf?.cf ?? 0);
  const trust =
    typeof raw.trust === "number" && Number.isFinite(raw.trust)
      ? raw.trust
      : Number.parseInt(String(raw.trust ?? "0").replace(/\D/g, ""), 10) || 0;
  const dailyTraffic =
    typeof raw.dailyTraffic === "number" && Number.isFinite(raw.dailyTraffic)
      ? raw.dailyTraffic
      : Number.parseInt(String(raw.traffic ?? raw.dailyTraffic ?? "0").replace(/\D/g, ""), 10) || 0;

  const genericPrice = parseRubAmount(typeof raw.price === "string" ? raw.price : String(raw.price ?? ""));
  const explicitArticlePrice =
    raw.priceArticle !== undefined ? parseRubAmount(String(raw.priceArticle)) : 0;
  const explicitNotePrice =
    raw.priceNote !== undefined ? parseRubAmount(String(raw.priceNote)) : 0;

  const priceArticleRub =
    explicitArticlePrice > 0 ? explicitArticlePrice : genericPrice > 0 ? genericPrice : null;
  const priceNoteRub =
    explicitNotePrice > 0 ? explicitNotePrice : genericPrice > 0 ? genericPrice : null;

  const indexStr = String(raw.indexation ?? "").toLowerCase();
  const indexedYandex =
    raw.indexedYandex !== undefined
      ? Boolean(raw.indexedYandex)
      : !indexStr.includes("нет яндекс");
  const indexedGoogle =
    raw.indexedGoogle !== undefined
      ? Boolean(raw.indexedGoogle)
      : !indexStr.includes("нет google");

  return {
    siteId,
    domain,
    priceArticleRub,
    priceNoteRub,
    tf,
    cf,
    trust,
    dailyTraffic,
    indexedYandex,
    indexedGoogle,
  };
}

function parseAlternativeDonors(raw: unknown): AlternativeDonorEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: AlternativeDonorEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const siteId = Number(rec.siteId);
    const domain = normalizeDomainName(String(rec.domain ?? ""));
    const priceRub = Number(rec.priceRub);
    const format: GglSchedulableFormat = rec.format === "note" ? "note" : "article";
    const metricsRaw =
      rec.metrics && typeof rec.metrics === "object"
        ? (rec.metrics as Record<string, unknown>)
        : {};
    if (!Number.isFinite(siteId) || siteId <= 0 || !domain || !Number.isFinite(priceRub) || priceRub <= 0) {
      continue;
    }
    out.push({
      siteId: Math.trunc(siteId),
      domain,
      priceRub,
      format,
      metrics: {
        tf: Number(metricsRaw.tf ?? 0) || 0,
        cf: Number(metricsRaw.cf ?? 0) || 0,
        trust: Number(metricsRaw.trust ?? 0) || 0,
        dailyTraffic: Number(metricsRaw.dailyTraffic ?? 0) || 0,
      },
    });
  }
  return out;
}

function parseScheduleDays(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [2, 5];
  const valid = raw
    .map((v) => Number(v))
    .filter((n) => Number.isInteger(n) && n >= 0 && n <= 7)
    .map((n) => (n === 0 ? 7 : n));
  return valid.length > 0 ? [...new Set(valid)] : [2, 5];
}

function parseAllowedFormats(raw: unknown): GglSchedulableFormat[] {
  if (!Array.isArray(raw)) return ["article", "note"];
  const valid = raw.filter(
    (v): v is GglSchedulableFormat => v === "article" || v === "note",
  );
  return valid.length > 0 ? [...new Set(valid)] : ["article", "note"];
}

function extractGglNumericId(data: unknown, keys: readonly string[]): number | null {
  if (!data || typeof data !== "object") return null;
  const rec = Array.isArray(data)
    ? (data[0] as Record<string, unknown> | undefined)
    : (data as Record<string, unknown>);
  if (!rec || typeof rec !== "object") return null;
  for (const key of keys) {
    const val = rec[key];
    if (val !== undefined && val !== null) {
      const num = Number.parseInt(String(val).trim(), 10);
      if (Number.isFinite(num) && num > 0) return num;
    }
  }
  if (rec.data && typeof rec.data === "object") {
    return extractGglNumericId(rec.data, keys);
  }
  return null;
}

function toUtcMidnightMs(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function formatUtcDateKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Creates or updates a GoGetLinks purchase schedule plan (`one_time` or `monthly`).
 *
 * Enforces `canApproveGglSpend(..., { withinApprovedPlan: false })` — strictly restricted
 * to `isRoot` and full platform administrators (`isPlatformAdministrator`).
 */
export async function upsertSchedulePlan(
  input: UpsertPlanInput,
  actor: PlatformActor,
  deps?: UpsertPlanDeps,
): Promise<GglSchedulePlan> {
  const client = deps?.prismaClient ?? db;
  const writeAudit = deps?.writeAudit ?? defaultWriteAudit;

  const getAccountConfig =
    deps?.getAccountConfig ??
    (async () => {
      const account = await client.gglAccount.findFirst({
        orderBy: { createdAt: "asc" },
      });
      return {
        allowSeoApproveWithinPlan: Boolean(account?.allowSeoApproveWithinPlan),
        availableRub: decimalToNumber(account?.availableRub ?? 0),
      };
    });

  const accountCfg = await getAccountConfig();
  if (
    !canApproveGglSpend(actor, {
      allowSeoApproveWithinPlan: accountCfg.allowSeoApproveWithinPlan,
      withinApprovedPlan: false,
    })
  ) {
    throw new GglOrderError(
      403,
      "Изменение плана и бюджета доступно только владельцу или администратору платформы",
    );
  }

  const cleanName = input.name.trim();
  if (!cleanName) {
    throw new GglOrderError(400, "Укажите название плана закупок");
  }
  if (input.kind !== "one_time" && input.kind !== "monthly") {
    throw new GglOrderError(400, "Тип плана должен быть one_time или monthly");
  }

  const budgetRub = Math.trunc(input.budgetRub);
  const maxPricePerLinkRub = Math.trunc(input.maxPricePerLinkRub);
  if (!Number.isFinite(budgetRub) || budgetRub <= 0) {
    throw new GglOrderError(400, "Бюджет плана должен быть больше 0 ₽");
  }
  if (!Number.isFinite(maxPricePerLinkRub) || maxPricePerLinkRub <= 0) {
    throw new GglOrderError(400, "Потолок цены за ссылку должен быть больше 0 ₽");
  }
  if (maxPricePerLinkRub > budgetRub) {
    throw new GglOrderError(
      422,
      "Максимальная цена одной ссылки не может превышать общий бюджет плана",
    );
  }

  const campaignRef = input.campaignId.trim();
  const numericGglId = Number(campaignRef);
  const campaign = await client.gglCampaign.findFirst({
    where: {
      OR: [
        { id: campaignRef },
        ...(Number.isFinite(numericGglId) && numericGglId > 0
          ? [{ gglCampaignId: numericGglId }]
          : []),
      ],
    },
  });
  if (!campaign) {
    throw new GglOrderError(404, "Кампания GoGetLinks не найдена");
  }
  if (!campaign.isWesetup) {
    throw new GglIsolationError(
      `Планировщик закупок разрешён только для кампаний wesetup.ru (кампания "${campaign.domain}" отклонена)`,
    );
  }

  const startsAt = input.startsAt ? new Date(input.startsAt) : new Date();
  if (Number.isNaN(startsAt.getTime())) {
    throw new GglOrderError(400, "Некорректная дата старта плана");
  }

  const scheduleDaysOfWeek = parseScheduleDays(input.scheduleDaysOfWeek);
  const allowedFormats = parseAllowedFormats(input.allowedFormats);
  const minTfCf = Math.max(0, Math.trunc(input.minTfCf ?? 10));
  const minTrust = Math.max(0, Math.trunc(input.minTrust ?? 4));
  const minDailyTraffic = Math.max(0, Math.trunc(input.minDailyTraffic ?? 100));
  const anchorMixBrandPct = Math.min(
    100,
    Math.max(0, Math.trunc(input.anchorMixBrandPct ?? 50)),
  );
  const isActive = input.isActive ?? true;

  let saved: GglSchedulePlan;
  if (input.id?.trim()) {
    const existing = await client.gglSchedulePlan.findUnique({
      where: { id: input.id.trim() },
      include: { campaign: { select: { isWesetup: true } } },
    });
    if (!existing) {
      throw new GglOrderError(404, "План закупок не найден");
    }
    if (!existing.campaign.isWesetup) {
      throw new GglIsolationError("Редактирование планов сторонних проектов запрещено");
    }
    saved = await client.gglSchedulePlan.update({
      where: { id: existing.id },
      data: {
        name: cleanName,
        campaignId: campaign.id,
        kind: input.kind,
        budgetRub,
        maxPricePerLinkRub,
        startsAt,
        scheduleDaysOfWeek: scheduleDaysOfWeek as unknown as Prisma.InputJsonValue,
        minTfCf,
        minTrust,
        minDailyTraffic,
        allowedFormats: allowedFormats as unknown as Prisma.InputJsonValue,
        anchorMixBrandPct,
        isActive,
      },
    });
  } else {
    saved = await client.gglSchedulePlan.create({
      data: {
        name: cleanName,
        campaignId: campaign.id,
        kind: input.kind,
        budgetRub,
        maxPricePerLinkRub,
        startsAt,
        scheduleDaysOfWeek: scheduleDaysOfWeek as unknown as Prisma.InputJsonValue,
        minTfCf,
        minTrust,
        minDailyTraffic,
        allowedFormats: allowedFormats as unknown as Prisma.InputJsonValue,
        anchorMixBrandPct,
        isActive,
        createdByUserId: actor.id,
      },
    });
  }

  await writeAudit({
    action: "ggl.plan.update",
    entity: "GglSchedulePlan",
    entityId: saved.id,
    actor: { id: actor.id, name: actor.name },
    details: {
      name: saved.name,
      kind: saved.kind,
      budgetRub: saved.budgetRub,
      maxPricePerLinkRub: saved.maxPricePerLinkRub,
      isActive: saved.isActive,
      campaignId: saved.campaignId,
    },
  });

  return saved;
}

/**
 * Materializes future `"planned"` calendar slots up to 30 days ahead for all active
 * `wesetup.ru` schedule plans. Never submits orders or spends money.
 */
export async function materializePlanSlots(
  now: Date = new Date(),
  deps?: MaterializeSlotsDeps,
): Promise<{ created: number }> {
  const client = deps?.prismaClient ?? db;

  const loadActivePlans =
    deps?.loadActivePlans ??
    (async (): Promise<ActivePlanForMaterialize[]> => {
      const rows = await client.gglSchedulePlan.findMany({
        where: {
          isActive: true,
          campaign: { isWesetup: true },
        },
        include: {
          campaign: { select: { isWesetup: true } },
          slots: {
            select: {
              scheduledDate: true,
              maxPriceRub: true,
              estimatedPriceRub: true,
              status: true,
            },
          },
        },
      });
      return rows.map((row) => ({
        id: row.id,
        campaignId: row.campaignId,
        isWesetup: row.campaign.isWesetup,
        kind: row.kind === "one_time" ? "one_time" : "monthly",
        budgetRub: row.budgetRub,
        maxPricePerLinkRub: row.maxPricePerLinkRub,
        startsAt: row.startsAt,
        scheduleDaysOfWeek: parseScheduleDays(row.scheduleDaysOfWeek),
        existingSlots: row.slots,
      }));
    });

  const createSlot =
    deps?.createSlot ??
    (async (data) => {
      try {
        await client.gglPlannedSlot.create({
          data: {
            planId: data.planId,
            scheduledDate: data.scheduledDate,
            maxPriceRub: data.maxPriceRub,
            status: data.status,
            idempotencyKey: data.idempotencyKey,
          },
        });
        return true;
      } catch (err) {
        if (isPrismaUniqueViolation(err)) return false;
        throw err;
      }
    });

  const activePlans = await loadActivePlans();
  let created = 0;

  for (const plan of activePlans) {
    if (!plan.isWesetup) continue;

    const existingDates = new Set<string>();
    let alreadyCommittedRub = 0;
    const committedByMonthRub: Record<string, number> = {};

    for (const slot of plan.existingSlots) {
      existingDates.add(slot.scheduledDate);
      if (slot.status === "skipped" || slot.status === "failed") continue;
      const slotAmount = slot.estimatedPriceRub ?? slot.maxPriceRub;
      alreadyCommittedRub += slotAmount;
      const monthKey = slot.scheduledDate.slice(0, 7);
      committedByMonthRub[monthKey] = (committedByMonthRub[monthKey] ?? 0) + slotAmount;
    }

    const upcoming = computeScheduleDates(
      {
        kind: plan.kind,
        budgetRub: plan.budgetRub,
        maxPricePerLinkRub: plan.maxPricePerLinkRub,
        startsAt: plan.startsAt,
        scheduleDaysOfWeek: plan.scheduleDaysOfWeek,
        alreadyCommittedRub,
        committedByMonthRub,
      },
      existingDates,
      now,
      30,
    );

    for (const item of upcoming) {
      const inserted = await createSlot({
        planId: plan.id,
        scheduledDate: item.scheduledDate,
        maxPriceRub: item.maxPriceRub,
        status: "planned",
        idempotencyKey: `ggl-slot-${plan.id}-${item.scheduledDate}`,
      });
      if (inserted) created += 1;
    }
  }

  return { created };
}

async function fetchReadOnlyTopvisorPositions(): Promise<TopvisorPositionInput[]> {
  if (!isTopvisorConfigured()) return [];
  const now = new Date();
  const from = new Date(now.getTime() - 30 * 86_400_000);
  const dateFrom = from.toISOString().slice(0, 10);
  const dateTo = now.toISOString().slice(0, 10);

  const [yandexRes, googleRes] = await Promise.allSettled([
    getPositionsHistory({ regionIndex: 1, dateFrom, dateTo }),
    getPositionsHistory({ regionIndex: 2, dateFrom, dateTo }),
  ]);

  const yandexMatrix: PositionMatrix | null =
    yandexRes.status === "fulfilled" ? yandexRes.value : null;
  const googleMatrix: PositionMatrix | null =
    googleRes.status === "fulfilled" ? googleRes.value : null;

  const merged = new Map<string, TopvisorPositionInput>();
  for (const row of yandexMatrix?.rows ?? []) {
    const key = row.phrase.trim().toLowerCase();
    if (!key) continue;
    merged.set(key, {
      phrase: row.phrase,
      yandexPos: row.latest,
      googlePos: null,
      relevantUrl: row.latestUrl,
    });
  }
  for (const row of googleMatrix?.rows ?? []) {
    const key = row.phrase.trim().toLowerCase();
    if (!key) continue;
    const prev = merged.get(key);
    if (prev) {
      prev.googlePos = row.latest;
      if (!prev.relevantUrl && row.latestUrl) prev.relevantUrl = row.latestUrl;
    } else {
      merged.set(key, {
        phrase: row.phrase,
        yandexPos: null,
        googlePos: row.latest,
        relevantUrl: row.latestUrl,
      });
    }
  }
  return [...merged.values()];
}

function parseSnapshotClusters(
  snapshotId: string,
  domain: string,
  rawClusters: unknown,
): CompetitorClusterInput[] {
  if (!Array.isArray(rawClusters)) return [];
  const out: CompetitorClusterInput[] = [];
  for (const item of rawClusters) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const phrase = typeof rec.phrase === "string" ? rec.phrase.trim() : "";
    const mappedTargetUrl =
      typeof rec.mappedTargetUrl === "string" ? rec.mappedTargetUrl.trim() : "";
    if (!phrase || !mappedTargetUrl) continue;
    const rawShare = Number(rec.trafficSharePct ?? 0);
    out.push({
      snapshotId,
      domain,
      phrase,
      trafficSharePct: Number.isFinite(rawShare) ? Math.max(0, rawShare) : 0,
      channel: rec.channel === "paid" ? "paid" : "organic",
      mappedTargetUrl,
      notes: typeof rec.notes === "string" ? rec.notes : null,
    });
  }
  return out;
}

function inferAnchorKind(anchor: string | null | undefined, targetUrl: string): GglAnchorKind {
  const clean = String(anchor ?? "").trim().toLowerCase();
  if (!clean) return "url_brand";
  if (
    clean === "wesetup.ru" ||
    clean === "wesetup" ||
    clean.startsWith("http://") ||
    clean.startsWith("https://") ||
    clean.includes("wesetup.ru")
  ) {
    return "url_brand";
  }
  const canonical = toCanonicalWesetupUrl(targetUrl).toLowerCase();
  if (clean === canonical) return "url_brand";
  if (/в wesetup|онлайн|образец/i.test(clean)) return "diluted";
  return "exact";
}

/**
 * Prepares `"planned"` slots scheduled within `horizonDays` (default 7 days):
 * scores target pages (Similarweb + Topvisor), picks best unused donor + alternatives,
 * generates an article/brief draft via `wesetup_ggl_article`, and transitions the slot
 * strictly to `"pending_approval"`.
 *
 * SAFETY INVARIANT: Never calls `submitLinkOrder` or spends money.
 */
export async function prepareUpcomingPlannedSlots(
  now: Date = new Date(),
  horizonDays = 7,
  deps?: PrepareSlotsDeps,
): Promise<{ prepared: number; skipped: number }> {
  const client = deps?.prismaClient ?? db;
  const todayMs = toUtcMidnightMs(now);
  const todayKey = formatUtcDateKey(todayMs);
  const horizonEndKey = formatUtcDateKey(
    todayMs + Math.max(1, Math.trunc(horizonDays)) * 86_400_000,
  );

  const findUpcomingPlannedSlots =
    deps?.findUpcomingPlannedSlots ??
    (async (startKey: string, endKey: string): Promise<UpcomingPlannedSlotRecord[]> => {
      const rows = await client.gglPlannedSlot.findMany({
        where: {
          status: "planned",
          scheduledDate: { gte: startKey, lte: endKey },
          plan: {
            isActive: true,
            campaign: { isWesetup: true },
          },
        },
        include: {
          plan: {
            include: {
              campaign: {
                select: { id: true, gglCampaignId: true, isWesetup: true },
              },
            },
          },
        },
        orderBy: [{ scheduledDate: "asc" }, { createdAt: "asc" }],
      });
      return rows.map((row) => ({
        id: row.id,
        planId: row.planId,
        scheduledDate: row.scheduledDate,
        maxPriceRub: row.maxPriceRub,
        plan: {
          id: row.plan.id,
          campaignId: row.plan.campaignId,
          minTfCf: row.plan.minTfCf,
          minTrust: row.plan.minTrust,
          minDailyTraffic: row.plan.minDailyTraffic,
          allowedFormats: parseAllowedFormats(row.plan.allowedFormats),
          anchorMixBrandPct: row.plan.anchorMixBrandPct,
          campaign: row.plan.campaign,
        },
      }));
    });

  const upcomingSlots = await findUpcomingPlannedSlots(todayKey, horizonEndKey);
  if (upcomingSlots.length === 0) {
    return { prepared: 0, skipped: 0 };
  }

  const claimSlotPreparing =
    deps?.claimSlotPreparing ??
    (async (slotId: string): Promise<boolean> => {
      const res = await client.gglPlannedSlot.updateMany({
        where: { id: slotId, status: "planned" },
        data: { status: "preparing" },
      });
      return res.count > 0;
    });

  const revertPreparingSlot =
    deps?.revertPreparingSlot ??
    (async (slotId: string): Promise<void> => {
      await client.gglPlannedSlot.updateMany({
        where: { id: slotId, status: "preparing" },
        data: { status: "planned" },
      });
    });

  const loadScoringContext =
    deps?.loadScoringContext ??
    (async (): Promise<SlotScoringContext> => {
      const [snapshotsRaw, ordersRaw, activeSlotsRaw, blogArticles, topvisorRows] =
        await Promise.all([
          client.seoCompetitorSnapshot.findMany({
            orderBy: [{ createdAt: "desc" }, { domain: "asc" }],
          }),
          client.gglOrder.findMany({
            where: { campaign: { isWesetup: true } },
            select: {
              donorDomain: true,
              targetUrl: true,
              anchor: true,
              status: true,
            },
          }),
          client.gglPlannedSlot.findMany({
            where: {
              status: { in: ["preparing", "pending_approval", "approved_sending", "ordered"] },
              plan: { campaign: { isWesetup: true } },
            },
            select: {
              donorDomain: true,
              targetUrl: true,
              anchor: true,
              anchorKind: true,
              status: true,
            },
          }),
          client.article
            ? client.article
                .findMany({
                  where: { publishedAt: { not: null } },
                  select: { slug: true, title: true, excerpt: true, tags: true },
                })
                .catch(() => [])
            : Promise.resolve([]),
          fetchReadOnlyTopvisorPositions().catch(() => []),
        ]);

      const seenDomains = new Set<string>();
      const clusters: CompetitorClusterInput[] = [];
      for (const snap of snapshotsRaw) {
        const normDomain = normalizeDomainName(snap.domain);
        if (!normDomain || seenDomains.has(normDomain)) continue;
        seenDomains.add(normDomain);
        clusters.push(...parseSnapshotClusters(snap.id, normDomain, snap.clusters));
      }

      const usedDonorDomains = new Set<string>();
      const existingOrders: ExistingBacklinkInput[] = [];
      for (const ord of ordersRaw) {
        if (ord.status !== "failed") {
          const d = normalizeDomainName(ord.donorDomain);
          if (d) usedDonorDomains.add(d);
        }
        existingOrders.push({
          targetUrl: ord.targetUrl,
          anchor: ord.anchor,
          anchorKind: inferAnchorKind(ord.anchor, ord.targetUrl),
          status: ord.status,
        });
      }
      for (const sl of activeSlotsRaw) {
        if (sl.donorDomain) {
          const d = normalizeDomainName(sl.donorDomain);
          if (d) usedDonorDomains.add(d);
        }
        if (sl.targetUrl) {
          existingOrders.push({
            targetUrl: sl.targetUrl,
            anchor: sl.anchor,
            anchorKind:
              sl.anchorKind === "exact" || sl.anchorKind === "diluted" || sl.anchorKind === "url_brand"
                ? sl.anchorKind
                : inferAnchorKind(sl.anchor, sl.targetUrl),
            status: "pending_webmaster",
          });
        }
      }

      const extraPages: CandidateSitePage[] = blogArticles.map((art) => ({
        url: `/blog/${art.slug}`,
        title: art.title,
        facts: art.excerpt ? [art.excerpt] : [],
        keywords: art.tags ?? [],
      }));

      return {
        clusters,
        topvisorRows,
        existingOrders,
        usedDonorDomains,
        candidatePages: buildDefaultCandidateSitePages(extraPages),
      };
    });

  const searchCatalogDonors =
    deps?.searchCatalogDonors ??
    (async (gglCampaignId: number, maxPriceRub: number): Promise<DonorCandidate[]> => {
      const bySiteId = new Map<number, DonorCandidate>();

      // 1. Read incoming webmaster applications from cached GglApplicationsSnapshot (1,500+ real offers)
      try {
        const snapRows = await db.platformSetting.findMany({
          where: { key: { endsWith: `:${gglCampaignId}:list` } },
          select: { value: true },
        });
        for (const row of snapRows) {
          const parsedSnap = JSON.parse(row.value) as {
            applications?: Array<{
              siteId: number;
              domain: string;
              placementType?: string;
              priceRub: number | null;
              dailyTraffic: number | null;
              tf: number | null;
              cf: number | null;
              trust: number | null;
            }>;
          };
          for (const app of parsedSnap.applications ?? []) {
            const cleanDomain = normalizeDomainName(app.domain);
            const price = app.priceRub ?? null;
            if (!cleanDomain || !app.siteId || price === null || price <= 0 || price > maxPriceRub) {
              continue;
            }
            const lowerType = String(app.placementType ?? "").toLowerCase();
            const isNote = lowerType.includes("замет") || lowerType.includes("контекст");
            const prev = bySiteId.get(app.siteId);
            bySiteId.set(app.siteId, {
              siteId: app.siteId,
              domain: cleanDomain,
              priceArticleRub: isNote ? (prev?.priceArticleRub ?? null) : price,
              priceNoteRub: isNote ? price : (prev?.priceNoteRub ?? null),
              tf: app.tf ?? prev?.tf ?? 0,
              cf: app.cf ?? prev?.cf ?? 0,
              trust: app.trust ?? prev?.trust ?? 0,
              dailyTraffic: app.dailyTraffic ?? prev?.dailyTraffic ?? 0,
              indexedYandex: true,
              indexedGoogle: true,
            });
          }
        }
      } catch {
        // Fallback to catalog search if snapshot cache is unavailable
      }

      // 2. Also query GoGetLinks catalog search
      try {
        const raw = await callGglRead("searchDonorSites", {
          campaignId: String(gglCampaignId),
          maxPrice: maxPriceRub,
          page: 1,
        });
        if (Array.isArray(raw)) {
          for (const item of raw) {
            if (!item || typeof item !== "object") continue;
            const cand = normalizeDonorCatalogRow(item as Record<string, unknown>);
            if (cand && !bySiteId.has(cand.siteId)) {
              bySiteId.set(cand.siteId, cand);
            }
          }
        }
      } catch {
        // If catalog call fails, rely on incoming webmaster applications
      }

      return [...bySiteId.values()];
    });

  const generateDraft = deps?.generateDraft ?? ((inp) => generateGglArticleDraft(inp));

  const savePreparedSlot =
    deps?.savePreparedSlot ??
    (async (slotId: string, payload: PreparedSlotPayload): Promise<void> => {
      const createdArticle = await client.gglArticle.create({
        data: {
          campaignId: payload.campaignId,
          targetUrl: toCanonicalWesetupUrl(payload.targetUrl),
          targetKeyword: payload.targetKeyword,
          anchor: payload.anchor,
          anchorKind: payload.anchorKind,
          title: payload.generatedContent.title,
          announcement: payload.generatedContent.announcement,
          bodyHtml: payload.generatedContent.bodyHtml,
          metaTitle: payload.generatedContent.metaTitle || null,
          metaDescription: payload.generatedContent.metaDescription || null,
          metaKeywords: payload.generatedContent.metaKeywords || null,
          status: "draft",
        },
      });

      await client.gglPlannedSlot.update({
        where: { id: slotId },
        data: {
          status: "pending_approval",
          estimatedPriceRub: payload.estimatedPriceRub,
          targetUrl: payload.targetUrl,
          targetKeyword: payload.targetKeyword,
          sourceSnapshotId: payload.sourceSnapshotId,
          topvisorPosSnapshot: payload.topvisorPosSnapshot as unknown as Prisma.InputJsonValue,
          selectionReason: payload.selectionReason,
          donorSiteId: payload.donorSiteId,
          donorDomain: payload.donorDomain,
          donorMetricsJson: payload.donorMetrics as unknown as Prisma.InputJsonValue,
          placementFormat: payload.placementFormat,
          anchor: payload.anchor,
          anchorKind: payload.anchorKind,
          articleId: createdArticle.id,
          briefText: payload.briefText,
          alternativeDonorsJson: payload.alternativeDonors as unknown as Prisma.InputJsonValue,
        },
      });
    });

  const scoringContext = await loadScoringContext();
  let prepared = 0;
  let skipped = 0;

  for (const slot of upcomingSlots) {
    if (!slot.plan.campaign.isWesetup) {
      skipped += 1;
      continue;
    }

    const claimed = await claimSlotPreparing(slot.id);
    if (!claimed) {
      skipped += 1;
      continue;
    }

    try {
      const scoredTargets = scoreTargetPages({
        clusters: scoringContext.clusters,
        topvisorRows: scoringContext.topvisorRows,
        existingOrders: scoringContext.existingOrders,
        candidatePages: scoringContext.candidatePages,
      });

      const chosenTarget = scoredTargets[0];
      if (!chosenTarget) {
        await revertPreparingSlot(slot.id);
        skipped += 1;
        continue;
      }

      const catalogDonors = await searchCatalogDonors(
        slot.plan.campaign.gglCampaignId,
        slot.maxPriceRub,
      );
      const { primary, alternatives } = selectBestDonorAndAlternatives(
        catalogDonors,
        scoringContext.usedDonorDomains,
        {
          maxPricePerLinkRub: slot.maxPriceRub,
          minTfCf: slot.plan.minTfCf,
          minTrust: slot.plan.minTrust,
          minDailyTraffic: slot.plan.minDailyTraffic,
          allowedFormats: slot.plan.allowedFormats,
        },
      );

      if (!primary) {
        await revertPreparingSlot(slot.id);
        skipped += 1;
        continue;
      }

      const targetPath = normalizeWesetupPath(chosenTarget.targetUrl) ?? "/journals-info";
      const existingAnchorsForTarget = scoringContext.existingOrders
        .filter((ord) => {
          if (ord.status === "rejected" || ord.status === "failed") return false;
          return normalizeWesetupPath(ord.targetUrl) === targetPath;
        })
        .map((ord) => ({
          anchorKind:
            ord.anchorKind === "exact" || ord.anchorKind === "diluted" || ord.anchorKind === "url_brand"
              ? ord.anchorKind
              : inferAnchorKind(ord.anchor, targetPath),
          anchor: ord.anchor ?? null,
        }));

      const selectedAnchor = selectAnchorForTarget({
        targetUrl: targetPath,
        keyword: chosenTarget.primaryKeyword,
        existingAnchors: existingAnchorsForTarget,
        minBrandPct: slot.plan.anchorMixBrandPct,
      });

      const pageMeta = scoringContext.candidatePages.find((p) => p.url === targetPath);
      const generatedContent = await generateDraft({
        donorDomain: primary.domain,
        targetUrl: targetPath,
        targetPageTitle: chosenTarget.title,
        targetPageFacts: pageMeta?.facts ? [...pageMeta.facts] : [],
        targetKeyword: chosenTarget.primaryKeyword,
        anchor: selectedAnchor.anchor,
        placementFormat: primary.selectedFormat,
      });

      const alternativeEntries: AlternativeDonorEntry[] = alternatives.map((alt) => ({
        siteId: alt.siteId,
        domain: alt.domain,
        priceRub: alt.selectedPriceRub,
        format: alt.selectedFormat,
        metrics: {
          tf: alt.tf,
          cf: alt.cf,
          trust: alt.trust,
          dailyTraffic: alt.dailyTraffic,
        },
      }));

      await savePreparedSlot(slot.id, {
        status: "pending_approval",
        estimatedPriceRub: Math.round(primary.selectedPriceRub),
        targetUrl: targetPath,
        targetKeyword: chosenTarget.primaryKeyword,
        sourceSnapshotId: chosenTarget.sourceSnapshotId,
        topvisorPosSnapshot: {
          yandexPos: chosenTarget.yandexPos,
          googlePos: chosenTarget.googlePos,
        },
        selectionReason: chosenTarget.selectionReason,
        donorSiteId: primary.siteId,
        donorDomain: primary.domain,
        donorMetrics: {
          tf: primary.tf,
          cf: primary.cf,
          trust: primary.trust,
          dailyTraffic: primary.dailyTraffic,
        },
        placementFormat: primary.selectedFormat,
        anchor: selectedAnchor.anchor,
        anchorKind: selectedAnchor.anchorKind,
        briefText: generatedContent.briefText || null,
        alternativeDonors: alternativeEntries,
        generatedContent,
        campaignId: slot.plan.campaignId,
      });

      scoringContext.usedDonorDomains.add(normalizeDomainName(primary.domain));
      scoringContext.existingOrders.push({
        targetUrl: targetPath,
        anchor: selectedAnchor.anchor,
        anchorKind: selectedAnchor.anchorKind,
        status: "pending_webmaster",
      });

      prepared += 1;
    } catch (err) {
      console.warn(`[ggl-planner] failed preparing slot="${slot.id}":`, err);
      await revertPreparingSlot(slot.id).catch(() => {});
      skipped += 1;
    }
  }

  return { prepared, skipped };
}

/**
 * Recycles slots whose linked `GglOrder` was rejected by the webmaster (`status === "rejected"`):
 * - When `alternativeDonorsJson` has a next candidate: detaches the rejected order's unique
 *   `plannedSlotId` link, promotes the fallback donor, and returns the slot to `"pending_approval"`.
 * - When `alternativeDonorsJson` is exhausted: detaches the rejected order's `plannedSlotId` link
 *   and transitions the slot out of `"ordered"` to `"failed"`, freeing committed budget so
 *   `materializePlanSlots` can schedule a fresh replacement slot and unblocking `mutatePlannedSlot`.
 */
export async function recycleRejectedSlotOrders(
  deps?: RecycleDeps,
): Promise<{ recycledSlotIds: string[]; exhaustedSlotIds: string[] }> {
  const client = deps?.prismaClient ?? db;

  const findRejectedLinkedSlots =
    deps?.findRejectedLinkedSlots ??
    (async () => {
      const rows = await client.gglPlannedSlot.findMany({
        where: {
          status: "ordered",
          order: { status: "rejected" },
          plan: { campaign: { isWesetup: true } },
        },
        select: {
          id: true,
          alternativeDonorsJson: true,
        },
      });
      return rows.map((row) => ({
        slotId: row.id,
        alternativeDonors: parseAlternativeDonors(row.alternativeDonorsJson),
      }));
    });

  const applyFallbackDonor =
    deps?.applyFallbackDonor ??
    (async (
      slotId: string,
      nextDonor: AlternativeDonorEntry,
      remainingAlternatives: AlternativeDonorEntry[],
    ) => {
      await client.gglOrder.updateMany({
        where: { plannedSlotId: slotId, status: "rejected" },
        data: { plannedSlotId: null },
      });
      await client.gglPlannedSlot.update({
        where: { id: slotId },
        data: {
          donorSiteId: nextDonor.siteId,
          donorDomain: nextDonor.domain,
          estimatedPriceRub: Math.round(nextDonor.priceRub),
          placementFormat: nextDonor.format,
          donorMetricsJson: nextDonor.metrics as unknown as Prisma.InputJsonValue,
          alternativeDonorsJson: remainingAlternatives as unknown as Prisma.InputJsonValue,
          status: "pending_approval",
          approvedByUserId: null,
          approvedByName: null,
          approvedAt: null,
        },
      });
    });

  const markExhaustedSlot =
    deps?.markExhaustedSlot ??
    (deps?.findRejectedLinkedSlots && !deps?.prismaClient
      ? async () => {}
      : async (slotId: string) => {
          await client.gglOrder.updateMany({
            where: { plannedSlotId: slotId, status: "rejected" },
            data: { plannedSlotId: null },
          });
          await client.gglPlannedSlot.update({
            where: { id: slotId },
            data: {
              status: "failed",
              selectionReason:
                "Заявка отклонена вебмастером; резервные доноры слота исчерпаны (бюджет освобождён для нового слота)",
              approvedByUserId: null,
              approvedByName: null,
              approvedAt: null,
            },
          });
        });

  const candidates = await findRejectedLinkedSlots();
  const recycledSlotIds: string[] = [];
  const exhaustedSlotIds: string[] = [];

  for (const item of candidates) {
    const nextDonor = item.alternativeDonors[0];
    if (!nextDonor) {
      await markExhaustedSlot(item.slotId);
      exhaustedSlotIds.push(item.slotId);
      continue;
    }
    const remaining = item.alternativeDonors.slice(1);
    await applyFallbackDonor(item.slotId, nextDonor, remaining);
    recycledSlotIds.push(item.slotId);
  }

  return { recycledSlotIds, exhaustedSlotIds };
}

async function defaultLookupLiveDonorPrice(args: {
  gglCampaignId: number;
  donorSiteId: number;
  donorDomain: string;
  placementFormat: "article" | "note" | "context";
  maxPriceRub: number;
}): Promise<number | null> {
  const targetDomain = normalizeDomainName(args.donorDomain);

  // 1. Check incoming webmaster applications snapshot first
  try {
    const snapRows = await db.platformSetting.findMany({
      where: { key: { endsWith: `:${args.gglCampaignId}:list` } },
      select: { value: true },
    });
    for (const row of snapRows) {
      const parsedSnap = JSON.parse(row.value) as {
        applications?: Array<{
          siteId: number;
          domain: string;
          priceRub: number | null;
        }>;
      };
      for (const app of parsedSnap.applications ?? []) {
        if (
          app.siteId === args.donorSiteId ||
          (targetDomain && normalizeDomainName(app.domain) === targetDomain)
        ) {
          if (app.priceRub && app.priceRub > 0) return app.priceRub;
        }
      }
    }
  } catch {
    // Ignore snapshot read error and continue to catalog search
  }

  // 2. Fallback to GoGetLinks catalog search
  const raw = await callGglRead("searchDonorSites", {
    campaignId: String(args.gglCampaignId),
    maxPrice: Math.max(args.maxPriceRub * 3, 5000),
    page: 1,
  });
  if (!Array.isArray(raw)) return null;

  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const cand = normalizeDonorCatalogRow(item as Record<string, unknown>);
    if (!cand) continue;
    if (cand.siteId === args.donorSiteId || (targetDomain && cand.domain === targetDomain)) {
      if (args.placementFormat === "article") {
        return cand.priceArticleRub ?? cand.priceNoteRub;
      }
      return cand.priceNoteRub ?? cand.priceArticleRub;
    }
  }
  return null;
}

/**
 * Approves a `"pending_approval"` slot after explicit human confirmation:
 * 1. Enforces `canApproveGglSpend(actor, { allowSeoApproveWithinPlan, withinApprovedPlan: true })`.
 * 2. Atomically claims slot (`status: "pending_approval"` -> `"approved_sending"`), throwing `409` on race.
 * 3. Runs pre-send live guards (`campaign.isWesetup === true`, live donor price `<= maxPriceRub`,
 *    `availableRub >= livePrice`); if any guard fails before dispatch, reverts slot to `"pending_approval"` with 0 spend.
 * 4. Uploads article / registers `{ targetUrl, anchor }`, calls `submitLinkOrder`, creates `GglOrder`,
 *    and transitions slot to `"ordered"` (or keeps `"approved_sending"` + `GglOrder.status = "sending"` on ambiguous timeout).
 */
export async function approvePlannedSlot(
  input: { slotId: string; idempotencyKey: string; actor: PlatformActor },
  deps?: ApproveSlotDeps,
): Promise<{ slotStatus: string; orderId?: string }> {
  const cleanSlotId = input.slotId.trim();
  const cleanKey = input.idempotencyKey.trim();
  if (!cleanSlotId) {
    throw new GglOrderError(400, "Не указан идентификатор слота");
  }
  if (!cleanKey) {
    throw new GglOrderError(400, "Укажите ключ идемпотентности (idempotencyKey)");
  }

  const client = deps?.prismaClient ?? db;
  const writeAudit = deps?.writeAudit ?? defaultWriteAudit;

  const getAccountConfig =
    deps?.getAccountConfig ??
    (async () => {
      const account = await client.gglAccount.findFirst({
        orderBy: { createdAt: "asc" },
      });
      if (!account) {
        throw new GglOrderError(409, "Кабинет GoGetLinks ещё не подключён");
      }
      return {
        allowSeoApproveWithinPlan: Boolean(account.allowSeoApproveWithinPlan),
        availableRub: decimalToNumber(account.availableRub),
      };
    });

  const accountCfg = await getAccountConfig();
  if (
    !canApproveGglSpend(input.actor, {
      allowSeoApproveWithinPlan: accountCfg.allowSeoApproveWithinPlan,
      withinApprovedPlan: true,
    })
  ) {
    throw new GglOrderError(
      403,
      "Недостаточно прав для подтверждения закупки по плану",
    );
  }

  const revertSlotToPending =
    deps?.revertSlotToPending ??
    (async (slotId: string) => {
      await client.gglPlannedSlot.updateMany({
        where: { id: slotId, status: "approved_sending" },
        data: {
          status: "pending_approval",
          approvedByUserId: null,
          approvedByName: null,
          approvedAt: null,
        },
      });
    });

  const claimSlotForSend =
    deps?.claimSlotForSend ??
    (async (slotId: string, actor: PlatformActor): Promise<ClaimedSlotForSend | null> => {
      const claimed = await client.gglPlannedSlot.updateMany({
        where: { id: slotId, status: "pending_approval" },
        data: {
          status: "approved_sending",
          approvedByUserId: actor.id,
          approvedByName: actor.name,
          approvedAt: new Date(),
        },
      });
      if (claimed.count === 0) return null;

      const row = await client.gglPlannedSlot.findUnique({
        where: { id: slotId },
        include: {
          plan: {
            include: {
              campaign: {
                select: { id: true, gglCampaignId: true, isWesetup: true },
              },
            },
          },
          article: {
            select: {
              id: true,
              gglArticleId: true,
              title: true,
              announcement: true,
              bodyHtml: true,
            },
          },
        },
      });

      if (
        !row ||
        !row.donorSiteId ||
        !row.donorDomain ||
        !row.targetUrl ||
        !row.anchor
      ) {
        await revertSlotToPending(slotId, "Слот не содержит полного набора данных донора и анкора");
        throw new GglOrderError(422, "Слот ещё не подготовлен к отправке (нет донора или целевого URL)");
      }

      const metricsRaw =
        row.donorMetricsJson && typeof row.donorMetricsJson === "object"
          ? (row.donorMetricsJson as Record<string, unknown>)
          : null;

      return {
        id: row.id,
        maxPriceRub: row.maxPriceRub,
        donorSiteId: row.donorSiteId,
        donorDomain: row.donorDomain,
        donorMetrics: metricsRaw
          ? {
              tf: Number(metricsRaw.tf ?? 0) || 0,
              cf: Number(metricsRaw.cf ?? 0) || 0,
              trust: Number(metricsRaw.trust ?? 0) || 0,
              dailyTraffic: Number(metricsRaw.dailyTraffic ?? 0) || 0,
            }
          : null,
        placementFormat: row.placementFormat === "article" ? "article" : "note",
        targetUrl: row.targetUrl,
        anchor: row.anchor,
        briefText: row.briefText,
        campaign: row.plan.campaign,
        article: row.article,
      };
    });

  const claimedSlot = await claimSlotForSend(cleanSlotId, input.actor);
  if (!claimedSlot) {
    throw new GglOrderError(409, "409: Слот уже отправляется или обработан");
  }

  // Pre-send Guard 1: Campaign isolation (wesetup.ru strictly)
  if (!claimedSlot.campaign.isWesetup) {
    await revertSlotToPending(
      claimedSlot.id,
      "Отправка отклонена: кампания не принадлежит wesetup.ru",
    );
    throw new GglIsolationError(
      `Подтверждение слота отклонено: кампания "${claimedSlot.campaign.id}" не принадлежит wesetup.ru`,
    );
  }

  // Pre-send Guard 1b: Forbid post-registration (dashboard) or robots.txt-disallowed URLs
  const resolvedSlotPath = resolvePublicSeoTargetPath(claimedSlot.targetUrl);
  if (!resolvedSlotPath || !isPublicSeoTargetAllowed(claimedSlot.targetUrl)) {
    const msg = `Запрещено закупать ссылки на страницу «${claimedSlot.targetUrl}»: она находится за регистрацией (в личном кабинете) или закрыта в robots.txt`;
    await revertSlotToPending(claimedSlot.id, msg);
    throw new GglOrderError(422, msg);
  }

  // Pre-send Guard 2: Live donor price <= slot.maxPriceRub
  const fetchLiveDonorPrice =
    deps?.fetchLiveDonorPrice ??
    ((slot: ClaimedSlotForSend) =>
      defaultLookupLiveDonorPrice({
        gglCampaignId: slot.campaign.gglCampaignId,
        donorSiteId: slot.donorSiteId,
        donorDomain: slot.donorDomain,
        placementFormat: slot.placementFormat,
        maxPriceRub: slot.maxPriceRub,
      }));

  let livePrice: number | null;
  try {
    livePrice = await fetchLiveDonorPrice(claimedSlot);
  } catch (err) {
    await revertSlotToPending(
      claimedSlot.id,
      err instanceof Error ? err.message : "Не удалось проверить актуальную цену донора",
    );
    throw err;
  }

  if (livePrice === null || !Number.isFinite(livePrice) || livePrice <= 0) {
    const msg = `Площадка-донор ${claimedSlot.donorDomain} недоступна в каталоге GoGetLinks`;
    await revertSlotToPending(claimedSlot.id, msg);
    throw new GglOrderError(422, msg);
  }

  if (livePrice > claimedSlot.maxPriceRub) {
    const msg = `Цена донора выросла (${livePrice} ₽ > лимит слота ${claimedSlot.maxPriceRub} ₽)`;
    await revertSlotToPending(claimedSlot.id, msg);
    throw new GglOrderError(422, msg);
  }

  // Pre-send Guard 3: Wallet available balance >= livePrice
  if (accountCfg.availableRub < livePrice) {
    const msg = `Недостаточно доступных средств на балансе GoGetLinks: доступно ${accountCfg.availableRub} ₽, требуется ${livePrice} ₽`;
    await revertSlotToPending(claimedSlot.id, msg);
    throw new GglOrderError(422, msg);
  }

  const ensureTargetAnchorInGgl =
    deps?.ensureTargetAnchorInGgl ??
    (async (slot: ClaimedSlotForSend, key: string) => {
      const canonicalTarget = toCanonicalWesetupUrl(slot.targetUrl);
      await callGglWrite({
        opName: "upsertCampaignAnchors",
        args: {
          campaignId: String(slot.campaign.gglCampaignId),
          anchors: `${canonicalTarget}|${slot.anchor}`,
        },
        idempotencyKey: `${key}:anchor`,
        campaignIdForGuard: slot.campaign.id,
        prismaClient: client,
      });
    });

  const uploadArticleIfNeeded =
    deps?.uploadArticleIfNeeded ??
    (async (slot: ClaimedSlotForSend, key: string): Promise<number | null> => {
      if (slot.placementFormat !== "article" || !slot.article) {
        return null;
      }
      if (slot.article.gglArticleId) {
        return slot.article.gglArticleId;
      }
      const res = await callGglWrite({
        opName: "uploadArticle",
        args: {
          title: slot.article.title,
          bodyHtml: slot.article.bodyHtml,
          campaignId: String(slot.campaign.gglCampaignId),
        },
        idempotencyKey: `${key}:article`,
        campaignIdForGuard: slot.campaign.id,
        prismaClient: client,
      });
      const uploadedId = extractGglNumericId(res.data, ["articleId", "gglArticleId", "id"]);
      await client.gglArticle.update({
        where: { id: slot.article.id },
        data: {
          ...(uploadedId ? { gglArticleId: uploadedId } : {}),
          status: "uploaded",
        },
      });
      return uploadedId;
    });

  const submitRemoteOrder =
    deps?.submitRemoteOrder ??
    (async (
      slot: ClaimedSlotForSend,
      uploadedGglArticleId: number | null,
      key: string,
    ) => {
      const canonicalTarget = toCanonicalWesetupUrl(slot.targetUrl);
      const res = await callGglWrite({
        opName: "submitLinkOrder",
        args: {
          campaignId: String(slot.campaign.gglCampaignId),
          donorSiteId: String(slot.donorSiteId),
          targetUrl: canonicalTarget,
          anchor: slot.anchor,
          ...(uploadedGglArticleId ? { articleId: String(uploadedGglArticleId) } : {}),
        },
        idempotencyKey: key,
        campaignIdForGuard: slot.campaign.id,
        prismaClient: client,
      });
      const reviewId = extractGglNumericId(res.data, ["reviewId", "gglReviewId", "id"]);
      return {
        status: res.status,
        gglReviewId: reviewId,
      };
    });

  const finalizeSlotOrder =
    deps?.finalizeSlotOrder ??
    (async (slotId, nextSlotStatus, meta): Promise<string> => {
      const canonicalTarget = toCanonicalWesetupUrl(meta.slot.targetUrl);
      const donorTfCf =
        meta.slot.donorMetrics?.tf !== undefined
          ? `${meta.slot.donorMetrics.tf} / ${meta.slot.donorMetrics.cf ?? 0}`
          : null;

      const existingByKey = await client.gglOrder.findUnique({
        where: { idempotencyKey: meta.idempotencyKey },
      });

      const order = existingByKey
        ? await client.gglOrder.update({
            where: { id: existingByKey.id },
            data: {
              ...(meta.gglReviewId ? { gglReviewId: meta.gglReviewId } : {}),
              status: meta.orderStatus,
              priceRub: meta.livePriceRub,
              plannedSlotId: slotId,
            },
          })
        : await client.gglOrder.create({
            data: {
              gglReviewId: meta.gglReviewId,
              campaignId: meta.slot.campaign.id,
              donorSiteId: meta.slot.donorSiteId,
              donorDomain: meta.slot.donorDomain,
              donorDailyTraffic: meta.slot.donorMetrics?.dailyTraffic ?? null,
              donorTfCf,
              donorTrust: meta.slot.donorMetrics?.trust ?? null,
              placementFormat: meta.slot.placementFormat,
              priceRub: meta.livePriceRub,
              targetUrl: canonicalTarget,
              anchor: meta.slot.anchor,
              articleId: meta.slot.article?.id ?? null,
              status: meta.orderStatus,
              origin: "scheduled_wesetup",
              initiatedByUserId: meta.actor.id,
              initiatedByName: meta.actor.name,
              approvedByUserId: meta.actor.id,
              approvedByName: meta.actor.name,
              approvedAt: new Date(),
              plannedSlotId: slotId,
              idempotencyKey: meta.idempotencyKey,
            },
          });

      await client.gglPlannedSlot.update({
        where: { id: slotId },
        data: {
          status: nextSlotStatus,
          estimatedPriceRub: Math.round(meta.livePriceRub),
        },
      });

      if (meta.slot.article?.id && nextSlotStatus === "ordered") {
        await client.gglArticle
          .update({
            where: { id: meta.slot.article.id },
            data: { status: "attached" },
          })
          .catch(() => {});
      }

      return order.id;
    });

  // Pre-order preparation writes (free operations: anchor registration + article upload)
  let uploadedGglArticleId: number | null = null;
  try {
    await ensureTargetAnchorInGgl(claimedSlot, cleanKey);
    uploadedGglArticleId = await uploadArticleIfNeeded(claimedSlot, cleanKey);
  } catch (err) {
    await revertSlotToPending(
      claimedSlot.id,
      err instanceof Error ? err.message : "Ошибка подготовки статьи или анкора в GoGetLinks",
    );
    throw err;
  }

  // Paid order submission (`submitLinkOrder`)
  let remoteResult: {
    status: "applied" | "accepted" | "may_have_applied";
    gglReviewId: number | null;
  };
  try {
    remoteResult = await submitRemoteOrder(claimedSlot, uploadedGglArticleId, cleanKey);
  } catch (err) {
    if (isExplicitlyNotAppliedError(err)) {
      await revertSlotToPending(
        claimedSlot.id,
        err instanceof Error ? err.message : "Заявка не была принята GoGetLinks",
      );
      throw err;
    }

    // Ambiguous mid-flight timeout: keep slot `approved_sending` & persist `GglOrder(status="sending")`
    // so `syncGglCabinet` reconciles without risking double spend!
    await finalizeSlotOrder(claimedSlot.id, "approved_sending", {
      slot: claimedSlot,
      livePriceRub: livePrice,
      gglReviewId: null,
      orderStatus: "sending",
      idempotencyKey: cleanKey,
      actor: input.actor,
    });
    throw err;
  }

  const isUncertain = remoteResult.status === "may_have_applied";
  const nextSlotStatus: "ordered" | "approved_sending" = isUncertain
    ? "approved_sending"
    : "ordered";
  const orderStatus: "pending_webmaster" | "sending" = isUncertain
    ? "sending"
    : "pending_webmaster";

  const orderId = await finalizeSlotOrder(claimedSlot.id, nextSlotStatus, {
    slot: claimedSlot,
    livePriceRub: livePrice,
    gglReviewId: remoteResult.gglReviewId,
    orderStatus,
    idempotencyKey: cleanKey,
    actor: input.actor,
  });

  await writeAudit({
    action: "ggl.slot.approve",
    entity: "GglPlannedSlot",
    entityId: claimedSlot.id,
    actor: { id: input.actor.id, name: input.actor.name },
    details: {
      orderId,
      donorSiteId: claimedSlot.donorSiteId,
      donorDomain: claimedSlot.donorDomain,
      priceRub: livePrice,
      targetUrl: claimedSlot.targetUrl,
      anchor: claimedSlot.anchor,
      slotStatus: nextSlotStatus,
      orderStatus,
    },
  });

  return {
    slotStatus: nextSlotStatus,
    orderId,
  };
}

/**
 * Submits a manual ad-hoc GoGetLinks order outside of a schedule slot (`origin: "manual_wesetup"`).
 *
 * Enforces `canApproveGglSpend(actor, { allowSeoApproveWithinPlan, withinApprovedPlan: false })`
 * (strictly `isRoot` or full platform administrator), `wesetup.ru` isolation, live donor price cap,
 * available wallet balance, and `idempotencyKey` deduplication.
 */
export async function createManualGglOrder(
  input: ManualOrderInput,
  actor: PlatformActor,
  deps?: ManualOrderDeps,
): Promise<{ orderId: string; status: string }> {
  const cleanKey = input.idempotencyKey.trim();
  if (!cleanKey) {
    throw new GglOrderError(400, "Укажите ключ идемпотентности (idempotencyKey)");
  }

  const client = deps?.prismaClient ?? db;
  const writeAudit = deps?.writeAudit ?? defaultWriteAudit;

  const getAccountConfig =
    deps?.getAccountConfig ??
    (async () => {
      const account = await client.gglAccount.findFirst({
        orderBy: { createdAt: "asc" },
      });
      if (!account) {
        throw new GglOrderError(409, "Кабинет GoGetLinks ещё не подключён");
      }
      return {
        allowSeoApproveWithinPlan: Boolean(account.allowSeoApproveWithinPlan),
        availableRub: decimalToNumber(account.availableRub),
        defaultCampaignId: account.defaultCampaignId,
      };
    });

  const accountCfg = await getAccountConfig();
  if (
    !canApproveGglSpend(actor, {
      allowSeoApproveWithinPlan: accountCfg.allowSeoApproveWithinPlan,
      withinApprovedPlan: false,
    })
  ) {
    throw new GglOrderError(
      403,
      "Ручная закупка вне плана доступна только владельцу или администратору платформы",
    );
  }

  const targetPath = normalizeWesetupPath(input.targetUrl);
  if (!targetPath) {
    throw new GglIsolationError("Целевой URL закупки должен принадлежать домену wesetup.ru");
  }
  if (!isPublicSeoTargetAllowed(targetPath)) {
    throw new GglOrderError(
      422,
      `Запрещено закупать ссылки на страницу «${targetPath}»: она находится за регистрацией (в личном кабинете) или закрыта в robots.txt`,
    );
  }
  const canonicalTarget = toCanonicalWesetupUrl(targetPath);

  const cleanAnchor = input.anchor.trim();
  if (!cleanAnchor) {
    throw new GglOrderError(400, "Укажите текст анкора для размещения");
  }

  const cleanDonorDomain = normalizeDomainName(input.donorDomain);
  if (!cleanDonorDomain || !Number.isInteger(input.donorSiteId) || input.donorSiteId <= 0) {
    throw new GglOrderError(400, "Укажите корректную площадку-донора (donorSiteId и donorDomain)");
  }

  if (!Number.isFinite(input.maxPriceRub) || input.maxPriceRub <= 0) {
    throw new GglOrderError(400, "Укажите максимальный потолок цены ссылки (maxPriceRub > 0)");
  }

  // Deduplicate idempotencyKey before touching network
  const existingOrder = await client.gglOrder.findUnique({
    where: { idempotencyKey: cleanKey },
  });
  if (existingOrder) {
    return { orderId: existingOrder.id, status: existingOrder.status };
  }

  // Resolve wesetup.ru campaign
  const campaignRef = input.campaignId?.trim();
  const numericRef = campaignRef ? Number(campaignRef) : accountCfg.defaultCampaignId ?? NaN;
  const campaign = campaignRef
    ? await client.gglCampaign.findFirst({
        where: {
          OR: [
            { id: campaignRef },
            ...(Number.isFinite(numericRef) && numericRef > 0
              ? [{ gglCampaignId: numericRef }]
              : []),
          ],
        },
      })
    : await client.gglCampaign.findFirst({
        where: Number.isFinite(numericRef) && numericRef > 0
          ? { gglCampaignId: numericRef }
          : { isWesetup: true, state: "active" },
      });

  if (!campaign) {
    throw new GglOrderError(404, "Активная кампания wesetup.ru в GoGetLinks не найдена");
  }
  if (!campaign.isWesetup) {
    throw new GglIsolationError(
      `Ручная закупка отклонена: кампания "${campaign.domain}" не принадлежит wesetup.ru`,
    );
  }

  const fetchLiveDonorPrice =
    deps?.fetchLiveDonorPrice ?? defaultLookupLiveDonorPrice;
  const livePrice = await fetchLiveDonorPrice({
    gglCampaignId: campaign.gglCampaignId,
    donorSiteId: input.donorSiteId,
    donorDomain: cleanDonorDomain,
    placementFormat: input.placementFormat,
    maxPriceRub: input.maxPriceRub,
  });

  if (livePrice === null || !Number.isFinite(livePrice) || livePrice <= 0) {
    throw new GglOrderError(
      422,
      `Площадка-донор ${cleanDonorDomain} недоступна в каталоге GoGetLinks`,
    );
  }
  if (livePrice > input.maxPriceRub) {
    throw new GglOrderError(
      422,
      `Цена донора выросла (${livePrice} ₽ > лимит ${input.maxPriceRub} ₽)`,
    );
  }
  if (accountCfg.availableRub < livePrice) {
    throw new GglOrderError(
      422,
      `Недостаточно доступных средств на балансе GoGetLinks: доступно ${accountCfg.availableRub} ₽, требуется ${livePrice} ₽`,
    );
  }

  let articleRecord: {
    id: string;
    gglArticleId: number | null;
    title: string;
    bodyHtml: string;
  } | null = null;

  if (input.articleId) {
    const foundArt = await client.gglArticle.findUnique({
      where: { id: input.articleId },
      select: { id: true, gglArticleId: true, title: true, bodyHtml: true },
    });
    if (!foundArt) {
      throw new GglOrderError(404, "Указанная статья для размещения не найдена");
    }
    articleRecord = foundArt;
  } else if (input.articleDraft) {
    assertSafeArticleHtml(input.articleDraft.bodyHtml);
    const createdArt = await client.gglArticle.create({
      data: {
        campaignId: campaign.id,
        targetUrl: canonicalTarget,
        targetKeyword: cleanAnchor,
        anchor: cleanAnchor,
        anchorKind: input.anchorKind ?? inferAnchorKind(cleanAnchor, targetPath),
        title: input.articleDraft.title.trim(),
        announcement: input.articleDraft.announcement?.trim() || input.articleDraft.title.trim(),
        bodyHtml: input.articleDraft.bodyHtml,
        metaTitle: input.articleDraft.metaTitle?.trim() || null,
        metaDescription: input.articleDraft.metaDescription?.trim() || null,
        metaKeywords: input.articleDraft.metaKeywords?.trim() || null,
        status: "draft",
        createdByUserId: actor.id,
      },
      select: { id: true, gglArticleId: true, title: true, bodyHtml: true },
    });
    articleRecord = createdArt;
  }

  // Claim GglOrder row with status = "sending" BEFORE dispatching network write
  let claimedOrder: { id: string; status: string };
  try {
    claimedOrder = await client.gglOrder.create({
      data: {
        campaignId: campaign.id,
        donorSiteId: input.donorSiteId,
        donorDomain: cleanDonorDomain,
        placementFormat: input.placementFormat,
        priceRub: livePrice,
        targetUrl: canonicalTarget,
        anchor: cleanAnchor,
        articleId: articleRecord?.id ?? null,
        status: "sending",
        origin: "manual_wesetup",
        initiatedByUserId: actor.id,
        initiatedByName: actor.name,
        approvedByUserId: actor.id,
        approvedByName: actor.name,
        approvedAt: new Date(),
        idempotencyKey: cleanKey,
      },
      select: { id: true, status: true },
    });
  } catch (err) {
    if (isPrismaUniqueViolation(err)) {
      const raced = await client.gglOrder.findUnique({
        where: { idempotencyKey: cleanKey },
      });
      if (raced) return { orderId: raced.id, status: raced.status };
    }
    throw err;
  }

  const ensureTargetAnchorInGgl =
    deps?.ensureTargetAnchorInGgl ??
    (async (args) => {
      await callGglWrite({
        opName: "upsertCampaignAnchors",
        args: {
          campaignId: String(args.gglCampaignId),
          anchors: `${args.targetUrl}|${args.anchor}`,
        },
        idempotencyKey: `${args.idempotencyKey}:anchor`,
        campaignIdForGuard: args.campaignId,
        prismaClient: client,
      });
    });

  const uploadArticleIfNeeded =
    deps?.uploadArticleIfNeeded ??
    (async (args): Promise<number | null> => {
      if (!args.article) return null;
      if (args.article.gglArticleId) return args.article.gglArticleId;
      const res = await callGglWrite({
        opName: "uploadArticle",
        args: {
          title: args.article.title,
          bodyHtml: args.article.bodyHtml,
          campaignId: String(args.gglCampaignId),
        },
        idempotencyKey: `${args.idempotencyKey}:article`,
        campaignIdForGuard: args.campaignId,
        prismaClient: client,
      });
      const uploadedId = extractGglNumericId(res.data, ["articleId", "gglArticleId", "id"]);
      await client.gglArticle.update({
        where: { id: args.article.id },
        data: {
          ...(uploadedId ? { gglArticleId: uploadedId } : {}),
          status: "uploaded",
        },
      });
      return uploadedId;
    });

  const submitRemoteOrder =
    deps?.submitRemoteOrder ??
    (async (args) => {
      const res = await callGglWrite({
        opName: "submitLinkOrder",
        args: {
          campaignId: String(args.gglCampaignId),
          donorSiteId: String(args.donorSiteId),
          targetUrl: args.targetUrl,
          anchor: args.anchor,
          ...(args.uploadedGglArticleId
            ? { articleId: String(args.uploadedGglArticleId) }
            : {}),
        },
        idempotencyKey: args.idempotencyKey,
        campaignIdForGuard: args.campaignId,
        prismaClient: client,
      });
      const reviewId = extractGglNumericId(res.data, ["reviewId", "gglReviewId", "id"]);
      return { status: res.status, gglReviewId: reviewId };
    });

  let uploadedGglArticleId: number | null = null;
  try {
    await ensureTargetAnchorInGgl({
      campaignId: campaign.id,
      gglCampaignId: campaign.gglCampaignId,
      targetUrl: canonicalTarget,
      anchor: cleanAnchor,
      idempotencyKey: cleanKey,
    });
    if (input.placementFormat === "article" && articleRecord) {
      uploadedGglArticleId = await uploadArticleIfNeeded({
        campaignId: campaign.id,
        gglCampaignId: campaign.gglCampaignId,
        article: articleRecord,
        idempotencyKey: cleanKey,
      });
    }
  } catch (err) {
    await client.gglOrder.update({
      where: { id: claimedOrder.id },
      data: { status: "failed" },
    });
    throw err;
  }

  let remoteRes: {
    status: "applied" | "accepted" | "may_have_applied";
    gglReviewId: number | null;
  };
  try {
    remoteRes = await submitRemoteOrder({
      campaignId: campaign.id,
      gglCampaignId: campaign.gglCampaignId,
      donorSiteId: input.donorSiteId,
      targetUrl: canonicalTarget,
      anchor: cleanAnchor,
      uploadedGglArticleId,
      idempotencyKey: cleanKey,
    });
  } catch (err) {
    if (isExplicitlyNotAppliedError(err)) {
      await client.gglOrder.update({
        where: { id: claimedOrder.id },
        data: { status: "failed" },
      });
    }
    // Ambiguous mid-flight timeout keeps status = "sending" for safe sync reconciliation
    throw err;
  }

  const nextStatus = remoteRes.status === "may_have_applied" ? "sending" : "pending_webmaster";
  await client.gglOrder.update({
    where: { id: claimedOrder.id },
    data: {
      status: nextStatus,
      ...(remoteRes.gglReviewId ? { gglReviewId: remoteRes.gglReviewId } : {}),
    },
  });

  await writeAudit({
    action: "ggl.order.manual_create",
    entity: "GglOrder",
    entityId: claimedOrder.id,
    actor: { id: actor.id, name: actor.name },
    details: {
      donorSiteId: input.donorSiteId,
      donorDomain: cleanDonorDomain,
      placementFormat: input.placementFormat,
      priceRub: livePrice,
      targetUrl: canonicalTarget,
      anchor: cleanAnchor,
      status: nextStatus,
    },
  });

  return { orderId: claimedOrder.id, status: nextStatus };
}

/**
 * Operational slot mutations (`skip`, `swap_donor`, `update_article`) available to
 * `"seo"` specialists and platform administrators prior to order submission.
 */
export async function mutatePlannedSlot(
  input: {
    slotId: string;
    action: "skip" | "swap_donor" | "update_article";
    donorSiteId?: number;
    articlePatch?: ArticlePatch;
    actor: PlatformActor;
  },
  deps?: MutateSlotDeps,
): Promise<GglPlannedSlot> {
  const cleanSlotId = input.slotId.trim();
  if (!cleanSlotId) {
    throw new GglOrderError(400, "Не указан идентификатор слота");
  }

  const client = deps?.prismaClient ?? db;
  const writeAudit = deps?.writeAudit ?? defaultWriteAudit;

  const slot = await client.gglPlannedSlot.findUnique({
    where: { id: cleanSlotId },
    include: {
      plan: {
        include: {
          campaign: { select: { id: true, isWesetup: true } },
        },
      },
      article: true,
    },
  });

  if (!slot) {
    throw new GglOrderError(404, "Слот не найден");
  }
  if (!slot.plan.campaign.isWesetup) {
    throw new GglIsolationError("Изменение слотов сторонних проектов запрещено");
  }
  if (slot.status === "approved_sending" || slot.status === "ordered") {
    throw new GglOrderError(
      409,
      "Нельзя изменить слот, который уже отправляется или заказан в GoGetLinks",
    );
  }

  if (input.action === "skip") {
    const updated = await client.gglPlannedSlot.update({
      where: { id: slot.id },
      data: { status: "skipped" },
    });

    await writeAudit({
      action: "ggl.slot.skip",
      entity: "GglPlannedSlot",
      entityId: slot.id,
      actor: { id: input.actor.id, name: input.actor.name },
      details: {
        scheduledDate: slot.scheduledDate,
        donorDomain: slot.donorDomain,
        targetUrl: slot.targetUrl,
      },
    });
    return updated;
  }

  if (input.action === "swap_donor") {
    const alternatives = parseAlternativeDonors(slot.alternativeDonorsJson);
    if (alternatives.length === 0) {
      throw new GglOrderError(422, "У слота нет резервных доноров для замены");
    }

    const chosenIdx =
      input.donorSiteId !== undefined
        ? alternatives.findIndex((alt) => alt.siteId === input.donorSiteId)
        : 0;

    if (chosenIdx === -1) {
      throw new GglOrderError(
        422,
        "Выбранный донор отсутствует в списке резервных площадок слота",
      );
    }

    const chosen = alternatives[chosenIdx]!;
    if (chosen.priceRub > slot.maxPriceRub) {
      throw new GglOrderError(
        422,
        `Цена выбранного донора (${chosen.priceRub} ₽) превышает потолок слота (${slot.maxPriceRub} ₽)`,
      );
    }

    const rotatedAlternatives = alternatives.filter((_, idx) => idx !== chosenIdx);
    if (slot.donorSiteId && slot.donorDomain) {
      const prevMetrics =
        slot.donorMetricsJson && typeof slot.donorMetricsJson === "object"
          ? (slot.donorMetricsJson as Record<string, unknown>)
          : {};
      rotatedAlternatives.push({
        siteId: slot.donorSiteId,
        domain: slot.donorDomain,
        priceRub: slot.estimatedPriceRub ?? slot.maxPriceRub,
        format: slot.placementFormat === "note" ? "note" : "article",
        metrics: {
          tf: Number(prevMetrics.tf ?? 0) || 0,
          cf: Number(prevMetrics.cf ?? 0) || 0,
          trust: Number(prevMetrics.trust ?? 0) || 0,
          dailyTraffic: Number(prevMetrics.dailyTraffic ?? 0) || 0,
        },
      });
    }

    const updated = await client.gglPlannedSlot.update({
      where: { id: slot.id },
      data: {
        donorSiteId: chosen.siteId,
        donorDomain: chosen.domain,
        estimatedPriceRub: Math.round(chosen.priceRub),
        placementFormat: chosen.format,
        donorMetricsJson: chosen.metrics as unknown as Prisma.InputJsonValue,
        alternativeDonorsJson: rotatedAlternatives as unknown as Prisma.InputJsonValue,
        ...(slot.status === "failed" && slot.targetUrl && slot.anchor
          ? {
              status: "pending_approval",
              approvedByUserId: null,
              approvedByName: null,
              approvedAt: null,
            }
          : {}),
      },
    });

    await writeAudit({
      action: "ggl.slot.swap_donor",
      entity: "GglPlannedSlot",
      entityId: slot.id,
      actor: { id: input.actor.id, name: input.actor.name },
      details: {
        previousDonorDomain: slot.donorDomain,
        nextDonorDomain: chosen.domain,
        nextDonorSiteId: chosen.siteId,
        estimatedPriceRub: Math.round(chosen.priceRub),
      },
    });
    return updated;
  }

  // action === "update_article"
  const patch = input.articlePatch;
  if (!patch || Object.keys(patch).length === 0) {
    throw new GglOrderError(400, "Передайте параметры обновления статьи или ТЗ (articlePatch)");
  }

  if (patch.bodyHtml !== undefined) {
    assertSafeArticleHtml(patch.bodyHtml);
  }

  const nextAnchor = patch.anchor !== undefined ? patch.anchor.trim() : slot.anchor;
  if (patch.anchor !== undefined && !nextAnchor) {
    throw new GglOrderError(400, "Текст анкора не может быть пустым");
  }
  const nextAnchorKind =
    patch.anchorKind ??
    (slot.anchorKind as GglAnchorKind | null) ??
    inferAnchorKind(nextAnchor, slot.targetUrl ?? "/journals-info");

  let nextArticleId = slot.articleId;
  if (slot.articleId && slot.article) {
    await client.gglArticle.update({
      where: { id: slot.articleId },
      data: {
        ...(patch.title !== undefined ? { title: patch.title.trim() } : {}),
        ...(patch.announcement !== undefined ? { announcement: patch.announcement.trim() } : {}),
        ...(patch.bodyHtml !== undefined ? { bodyHtml: patch.bodyHtml } : {}),
        ...(patch.metaTitle !== undefined ? { metaTitle: patch.metaTitle.trim() || null } : {}),
        ...(patch.metaDescription !== undefined
          ? { metaDescription: patch.metaDescription.trim() || null }
          : {}),
        ...(patch.metaKeywords !== undefined
          ? { metaKeywords: patch.metaKeywords.trim() || null }
          : {}),
        ...(nextAnchor ? { anchor: nextAnchor } : {}),
        anchorKind: nextAnchorKind,
        gglArticleId: null,
        status: "draft",
      },
    });
  } else if (patch.title && patch.bodyHtml) {
    const targetPath = normalizeWesetupPath(slot.targetUrl) ?? "/journals-info";
    const createdArt = await client.gglArticle.create({
      data: {
        campaignId: slot.plan.campaignId,
        targetUrl: toCanonicalWesetupUrl(targetPath),
        targetKeyword: slot.targetKeyword ?? nextAnchor ?? "wesetup.ru",
        anchor: nextAnchor ?? "wesetup.ru",
        anchorKind: nextAnchorKind,
        title: patch.title.trim(),
        announcement: patch.announcement?.trim() || patch.title.trim(),
        bodyHtml: patch.bodyHtml,
        metaTitle: patch.metaTitle?.trim() || null,
        metaDescription: patch.metaDescription?.trim() || null,
        metaKeywords: patch.metaKeywords?.trim() || null,
        status: "draft",
        createdByUserId: input.actor.id,
      },
    });
    nextArticleId = createdArt.id;
  }

  const updated = await client.gglPlannedSlot.update({
    where: { id: slot.id },
    data: {
      ...(nextAnchor !== null && nextAnchor !== undefined ? { anchor: nextAnchor } : {}),
      anchorKind: nextAnchorKind,
      ...(patch.briefText !== undefined ? { briefText: patch.briefText.trim() || null } : {}),
      ...(nextArticleId !== slot.articleId ? { articleId: nextArticleId } : {}),
    },
  });

  await writeAudit({
    action: "ggl.slot.update_article",
    entity: "GglPlannedSlot",
    entityId: slot.id,
    actor: { id: input.actor.id, name: input.actor.name },
    details: {
      articleId: nextArticleId,
      anchor: updated.anchor,
      titleUpdated: patch.title !== undefined,
      bodyUpdated: patch.bodyHtml !== undefined,
    },
  });

  return updated;
}
