import crypto from "node:crypto";
import type { GglCampaign } from "@prisma/client";
import { db } from "@/lib/db";
import { decryptSecret, encryptSecret } from "@/lib/integration-crypto";
import { maskEmail } from "@/lib/platform-admin";
import {
  callGglRead,
  callGglWrite,
  GglAuthError,
  GglCallError,
  type GglWalletBalance,
  verifyAndLoginGgl,
} from "@/lib/seo/gogetlinks-client.server";
import {
  isWesetupDomain,
  type NormalizedGglCampaign,
  type NormalizedGglReview,
  normalizeCampaignRow,
  normalizeReviewRow,
  parseRubAmount,
} from "@/lib/seo/gogetlinks-codec";

const THIRTY_MINUTES_MS = 30 * 60 * 1000;

export class GglSyncError extends Error {
  public readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "GglSyncError";
    this.status = status;
  }
}

export interface GglAccountView {
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

export interface ExistingOrderSnapshot {
  id: string;
  gglReviewId: number | null;
  origin: string;
  status: string;
  donorDomain: string;
  targetUrl: string;
  anchor?: string | null;
  placementFormat?: string | null;
  publishedUrl?: string | null;
  paidAt?: Date | null;
  cancelledAt?: Date | null;
  initiatedByUserId: string | null;
  initiatedByName: string | null;
  approvedByUserId: string | null;
  approvedByName: string | null;
  approvedAt?: Date | null;
  plannedSlotId?: string | null;
  idempotencyKey?: string;
}

export interface OrderUpsertPlan {
  existingId: string | null;
  gglReviewId: number;
  donorDomain: string;
  donorDailyTraffic: number | null;
  donorTfCf: string | null;
  placementFormat: string;
  priceRub: number;
  targetUrl: string;
  anchor: string;
  publishedUrl: string | null;
  paidAt: Date | null;
  cancelledAt: Date | null;
  status: string;
  origin: string;
  initiatedByUserId: string | null;
  initiatedByName: string | null;
  approvedByUserId: string | null;
  approvedByName: string | null;
  idempotencyKey: string;
  becameOnCheck: boolean;
  becameNeedsReplacement: boolean;
}

export interface GglSyncSummary {
  syncedAt: string;
  balanceRub: number;
  availableRub: number;
  blockedRub: number;
  campaignsCount: number;
  ordersCount: number;
  newUnreadThreadIds: string[];
  newOnCheckOrderIds: string[];
  newReplacementOrderIds: string[];
}

type ReadGglFn = <T = unknown>(opName: string, args?: Record<string, unknown>) => Promise<T>;
type WriteGglFn = <T = unknown>(input: {
  opName: string;
  args: Record<string, unknown>;
  idempotencyKey: string;
  campaignIdForGuard?: string;
  prismaClient?: unknown;
}) => Promise<{ status: "applied" | "accepted" | "may_have_applied"; data: T }>;

export function decimalToNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (value === null || value === undefined) return 0;
  if (typeof value === "object" && "toNumber" in value && typeof (value as { toNumber: unknown }).toNumber === "function") {
    const num = (value as { toNumber: () => number }).toNumber();
    return Number.isFinite(num) ? num : 0;
  }
  const parsed = Number(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function serializeGglAccount(row: {
  id: string;
  email: string;
  status: string;
  balanceRub: unknown;
  availableRub: unknown;
  blockedRub: unknown;
  defaultCampaignId: number | null;
  allowSeoApproveWithinPlan: boolean;
  lastSyncedAt: Date | string | null;
  lastError: string | null;
}): GglAccountView {
  return {
    id: row.id,
    email: maskEmail(row.email),
    status: row.status,
    balanceRub: decimalToNumber(row.balanceRub),
    availableRub: decimalToNumber(row.availableRub),
    blockedRub: decimalToNumber(row.blockedRub),
    defaultCampaignId: row.defaultCampaignId ?? null,
    allowSeoApproveWithinPlan: Boolean(row.allowSeoApproveWithinPlan),
    lastSyncedAt: row.lastSyncedAt ? new Date(row.lastSyncedAt).toISOString() : null,
    lastError: row.lastError ?? null,
  };
}

export type GglAccountPrismaClient = Pick<typeof db, "gglAccount">;
export type GglAccountSavePrismaClient = Pick<typeof db, "gglAccount" | "gglCampaign">;
export type GglSyncPrismaClient = Pick<
  typeof db,
  "gglAccount" | "gglCampaign" | "gglOrder" | "gglThread" | "gglMessage"
> &
  Partial<Pick<typeof db, "gglPlannedSlot">>;

export async function getGglAccountView(
  prismaClient: GglAccountPrismaClient = db,
): Promise<GglAccountView | null> {
  const row = await prismaClient.gglAccount.findFirst({
    orderBy: { createdAt: "asc" },
  });
  return row ? serializeGglAccount(row) : null;
}

export async function saveGglAccount(
  input: {
    email?: string;
    password?: string;
    defaultCampaignId?: number | null;
    allowSeoApproveWithinPlan?: boolean;
  },
  userId: string | null,
  deps?: {
    prismaClient?: GglAccountSavePrismaClient;
    verifyLogin?: typeof verifyAndLoginGgl;
  },
): Promise<{ account: GglAccountView; accountId: string }> {
  const client = deps?.prismaClient ?? db;
  const verifyFn = deps?.verifyLogin ?? verifyAndLoginGgl;

  const existing = await client.gglAccount.findFirst({
    orderBy: { createdAt: "asc" },
  });

  if (input.defaultCampaignId !== undefined && input.defaultCampaignId !== null) {
    const targetCamp = await client.gglCampaign.findFirst({
      where: { gglCampaignId: input.defaultCampaignId },
    });
    if (targetCamp && !targetCamp.isWesetup) {
      throw new GglSyncError(422, "Основной кампанией можно назначить только кампанию домена wesetup.ru");
    }
  }

  const hasCredentialInput = Boolean(input.email !== undefined || input.password !== undefined);
  if (!existing && (!input.email || !input.password)) {
    throw new GglSyncError(400, "Укажите email и пароль аккаунта GoGetLinks для первичного подключения");
  }

  let nextEmail = existing?.email ?? "";
  let nextPasswordEnc = existing?.passwordEnc ?? "";
  let nextSessionEnc = existing?.sessionEnc ?? null;
  let nextBalance = existing
    ? {
        balanceRub: decimalToNumber(existing.balanceRub),
        availableRub: decimalToNumber(existing.availableRub),
        blockedRub: decimalToNumber(existing.blockedRub),
      }
    : { balanceRub: 0, availableRub: 0, blockedRub: 0 };
  let nextStatus = existing?.status ?? "unchecked";
  let nextLastError: string | null = existing?.lastError ?? null;
  let nextLastSyncedAt: Date | null = existing?.lastSyncedAt ?? null;

  if (hasCredentialInput) {
    nextEmail = (input.email ?? existing?.email ?? "").trim().toLowerCase();
    if (!nextEmail) {
      throw new GglSyncError(400, "Укажите email аккаунта GoGetLinks");
    }

    let plainPassword = input.password;
    if (!plainPassword) {
      if (!existing?.passwordEnc) {
        throw new GglSyncError(400, "Укажите пароль от аккаунта GoGetLinks");
      }
      plainPassword = decryptSecret(existing.passwordEnc);
    }

    try {
      const loginResult = await verifyFn(nextEmail, plainPassword, {
        prismaClient: client,
        persistToDb: false,
      });
      nextPasswordEnc = encryptSecret(plainPassword);
      nextSessionEnc = encryptSecret(
        JSON.stringify({
          cookies: loginResult.cookies,
          values: {},
          updatedAt: new Date().toISOString(),
        }),
      );
      nextBalance = loginResult.balance;
      nextStatus = "ok";
      nextLastError = null;
      nextLastSyncedAt = new Date();
    } catch (err) {
      if (err instanceof GglAuthError) {
        throw new GglSyncError(422, err.message);
      }
      throw err;
    }
  }

  const dataPayload = {
    email: nextEmail,
    passwordEnc: nextPasswordEnc,
    sessionEnc: nextSessionEnc,
    balanceRub: nextBalance.balanceRub,
    availableRub: nextBalance.availableRub,
    blockedRub: nextBalance.blockedRub,
    ...(input.defaultCampaignId !== undefined ? { defaultCampaignId: input.defaultCampaignId } : {}),
    ...(input.allowSeoApproveWithinPlan !== undefined
      ? { allowSeoApproveWithinPlan: input.allowSeoApproveWithinPlan }
      : {}),
    status: nextStatus,
    lastSyncedAt: nextLastSyncedAt,
    lastError: nextLastError,
    updatedByUserId: userId,
  };

  const saved = existing
    ? await client.gglAccount.update({
        where: { id: existing.id },
        data: dataPayload,
      })
    : await client.gglAccount.create({
        data: dataPayload,
      });

  return {
    account: serializeGglAccount(saved),
    accountId: saved.id,
  };
}

export function parseGglDate(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;

  // DD.MM.YYYY or DD.MM.YYYY HH:MM
  const ruMatch = trimmed.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:\s+(\d{1,2}):(\d{2}))?$/);
  if (ruMatch) {
    const day = Number.parseInt(ruMatch[1], 10);
    const month = Number.parseInt(ruMatch[2], 10);
    const year = Number.parseInt(ruMatch[3], 10);
    const hour = ruMatch[4] !== undefined ? Number.parseInt(ruMatch[4], 10) : 0;
    const minute = ruMatch[5] !== undefined ? Number.parseInt(ruMatch[5], 10) : 0;
    const dt = new Date(Date.UTC(year, month - 1, day, hour, minute));
    return Number.isNaN(dt.getTime()) ? null : dt;
  }

  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Reconciles an incoming GoGetLinks review row with an optional existing `GglOrder` snapshot,
 * preserving Wesetup human attribution (`origin`, `initiatedBy*`, `approvedBy*`) while marking
 * brand-new externally placed links as `external_ggl`.
 */
export function reconcileSyncedOrder(
  existing: ExistingOrderSnapshot | null,
  incoming: NormalizedGglReview,
): OrderUpsertPlan {
  const parsedPaidAt = parseGglDate(incoming.paidDate) ?? existing?.paidAt ?? null;
  const cancelledAt =
    incoming.status === "rejected" ? (existing?.cancelledAt ?? new Date()) : (existing?.cancelledAt ?? null);

  const origin = existing?.origin || "external_ggl";
  const initiatedByUserId = existing ? (existing.initiatedByUserId ?? null) : null;
  const initiatedByName = existing ? (existing.initiatedByName ?? null) : null;
  const approvedByUserId = existing ? (existing.approvedByUserId ?? null) : null;
  const approvedByName = existing ? (existing.approvedByName ?? null) : null;
  const idempotencyKey = existing?.idempotencyKey || `ggl-review-${incoming.gglReviewId}`;

  return {
    existingId: existing?.id ?? null,
    gglReviewId: incoming.gglReviewId,
    donorDomain: incoming.donorDomain || existing?.donorDomain || "",
    donorDailyTraffic:
      incoming.dailyTraffic !== undefined && incoming.dailyTraffic > 0 ? incoming.dailyTraffic : null,
    donorTfCf: incoming.tfCf?.label ?? null,
    placementFormat: incoming.placementFormat || existing?.placementFormat || "note",
    priceRub: incoming.priceRub,
    targetUrl: incoming.targetUrl || existing?.targetUrl || "",
    anchor: incoming.anchor || existing?.anchor || "",
    publishedUrl: incoming.publishedUrl ?? existing?.publishedUrl ?? null,
    paidAt: incoming.status === "paid" ? parsedPaidAt : (existing?.paidAt ?? null),
    cancelledAt,
    status: incoming.status,
    origin,
    initiatedByUserId,
    initiatedByName,
    approvedByUserId,
    approvedByName,
    idempotencyKey,
    becameOnCheck: incoming.status === "on_check" && existing?.status !== "on_check",
    becameNeedsReplacement:
      incoming.status === "needs_replacement" && existing?.status !== "needs_replacement",
  };
}

function asRecordArray(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object");
}

function normalizeHost(raw: string | null | undefined): string {
  if (!raw) return "";
  let s = String(raw).trim().toLowerCase();
  s = s.replace(/^[a-z]+:\/\//, "");
  s = s.split(/[/?#:]/)[0] || "";
  return s.replace(/^www\./, "");
}

function normalizeTargetForMatch(rawUrl: string | null | undefined): string {
  if (!rawUrl) return "";
  const trimmed = String(rawUrl).trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("/")) {
    return `wesetup.ru${trimmed.replace(/\/+$/, "") || "/"}`.toLowerCase();
  }
  try {
    const parsed = new URL(trimmed);
    const host = parsed.hostname.replace(/^www\./i, "").toLowerCase();
    const path = parsed.pathname.replace(/\/+$/, "") || "/";
    return `${host}${path}${parsed.search}`.toLowerCase();
  } catch {
    return trimmed.replace(/^https?:\/\/(?:www\.)?/i, "").replace(/\/+$/, "").toLowerCase();
  }
}

export function normalizeMessageBody(body: string | null | undefined): string {
  if (!body) return "";
  return String(body).replace(/\r\n/g, "\n").replace(/\s+/g, " ").trim();
}

function parseWalletBalance(raw: unknown): GglWalletBalance {
  if (raw && typeof raw === "object" && !Array.isArray(raw) && "balanceRub" in raw) {
    const b = raw as Partial<GglWalletBalance>;
    return {
      balanceRub: Number(b.balanceRub ?? 0) || 0,
      availableRub: Number(b.availableRub ?? 0) || 0,
      blockedRub: Number(b.blockedRub ?? 0) || 0,
    };
  }
  const row = Array.isArray(raw) ? raw[0] : (raw as Record<string, unknown> | null) || {};
  return {
    balanceRub: parseRubAmount(row?.balance as string),
    availableRub: parseRubAmount(row?.available as string),
    blockedRub: parseRubAmount(row?.blocked as string),
  };
}

interface SyncedCampaignRecord {
  id: string;
  gglCampaignId: number;
  name: string;
  domain: string;
  siteUrl: string;
  isWesetup: boolean;
  state: string;
}

async function syncCampaignsFromGgl(
  client: Pick<typeof db, "gglCampaign">,
  readGgl: ReadGglFn,
  syncedAt: Date,
): Promise<SyncedCampaignRecord[]> {
  const [activeRaw, closedRaw] = await Promise.all([
    readGgl("listActiveCampaigns"),
    readGgl("listClosedCampaigns"),
  ]);

  // Normalize closed campaigns first: if GET /campaigns redirected to view_closed (when 0 active
  // campaigns exist), closedCampaigns is authoritative so closed rows are NEVER marked "active".
  const closedNormalized: NormalizedGglCampaign[] = [];
  const closedIds = new Set<number>();
  for (const raw of asRecordArray(closedRaw)) {
    const norm = normalizeCampaignRow(raw, {
      requestedState: "closed",
      finalUrl: "https://gogetlinks.net/campaigns/index/action/view_closed",
    });
    if (norm) {
      norm.state = "closed";
      closedNormalized.push(norm);
      closedIds.add(norm.gglCampaignId);
    }
  }

  const mergedByGglId = new Map<number, NormalizedGglCampaign>();
  for (const raw of asRecordArray(activeRaw)) {
    const norm = normalizeCampaignRow(raw, { requestedState: "active" });
    if (!norm) continue;
    if (closedIds.has(norm.gglCampaignId)) {
      norm.state = "closed";
    }
    mergedByGglId.set(norm.gglCampaignId, norm);
  }
  for (const closed of closedNormalized) {
    mergedByGglId.set(closed.gglCampaignId, { ...closed, state: "closed" });
  }

  const persisted: SyncedCampaignRecord[] = [];
  for (const camp of mergedByGglId.values()) {
    const saved = await client.gglCampaign.upsert({
      where: { gglCampaignId: camp.gglCampaignId },
      create: {
        gglCampaignId: camp.gglCampaignId,
        name: camp.name,
        domain: camp.domain,
        siteUrl: camp.siteUrl,
        isWesetup: camp.isWesetup,
        state: camp.state,
        spentRub: camp.spentRub,
        linksCount: camp.linksCount,
        requestsCount: camp.requestsCount,
        qualityControl: camp.qualityControl,
        statusNote: camp.statusNote,
        syncedAt,
      },
      update: {
        name: camp.name,
        domain: camp.domain,
        siteUrl: camp.siteUrl,
        isWesetup: camp.isWesetup,
        state: camp.state,
        spentRub: camp.spentRub,
        linksCount: camp.linksCount,
        requestsCount: camp.requestsCount,
        qualityControl: camp.qualityControl,
        statusNote: camp.statusNote,
        syncedAt,
      },
    });
    persisted.push({
      id: saved.id,
      gglCampaignId: camp.gglCampaignId,
      name: camp.name,
      domain: camp.domain,
      siteUrl: camp.siteUrl,
      isWesetup: camp.isWesetup,
      state: camp.state,
    });
  }

  return persisted;
}

function resolveCampaignForTabReview(
  raw: Record<string, unknown>,
  review: NormalizedGglReview,
  campaigns: SyncedCampaignRecord[],
  existingByReviewId: Map<number, ExistingOrderSnapshot & { campaignId: string }>,
  sendingOrders: Array<ExistingOrderSnapshot & { campaignId: string }>,
): SyncedCampaignRecord | null {
  const byId = new Map(campaigns.map((c) => [c.id, c]));
  const byGglId = new Map(campaigns.map((c) => [c.gglCampaignId, c]));

  // 1. Explicit campaign ID on raw row
  const explicitId = raw.gglCampaignId ?? raw.campaignId ?? raw.comp_id;
  if (explicitId !== undefined && explicitId !== null && String(explicitId).trim() !== "") {
    const num = Number.parseInt(String(explicitId).trim(), 10);
    if (Number.isFinite(num) && byGglId.has(num)) return byGglId.get(num)!;
    const byStr = byId.get(String(explicitId).trim());
    if (byStr) return byStr;
  }

  // 2. Existing synced order in DB with same gglReviewId
  const existingRev = existingByReviewId.get(review.gglReviewId);
  if (existingRev && byId.has(existingRev.campaignId)) {
    return byId.get(existingRev.campaignId)!;
  }

  // 3. Target URL host match
  if (review.targetUrl) {
    if (review.targetUrl.startsWith("/") || isWesetupDomain(review.targetUrl)) {
      const ws =
        campaigns.find((c) => c.isWesetup && c.state === "active") ??
        campaigns.find((c) => c.isWesetup);
      if (ws) return ws;
    } else {
      const targetHost = normalizeHost(review.targetUrl);
      if (targetHost) {
        const matchedByDomain = campaigns.find(
          (c) => normalizeHost(c.domain || c.siteUrl) === targetHost,
        );
        if (matchedByDomain) return matchedByDomain;
      }
    }
  }

  // 4. Campaign name embedded in siteCell ("domain.ru Кампания: Name")
  const siteCell = typeof raw.siteCell === "string" ? raw.siteCell : "";
  const campMatch = siteCell.match(/Кампания:\s*([^\n\r]+)/i);
  const campLabel = (
    (typeof raw.campaignName === "string" ? raw.campaignName : "") ||
    (campMatch ? campMatch[1] : "")
  )
    .trim()
    .toLowerCase();

  if (campLabel) {
    const matchedByName = campaigns.find(
      (c) =>
        c.name.trim().toLowerCase() === campLabel ||
        normalizeHost(c.domain) === campLabel.replace(/^www\./, ""),
    );
    if (matchedByName) return matchedByName;
  }

  // 5. In-flight sending order match by (donorDomain, targetUrl)
  const normDonor = normalizeHost(review.donorDomain);
  const normTarget = normalizeTargetForMatch(review.targetUrl);
  const matchedSending = sendingOrders.find(
    (ord) =>
      normalizeHost(ord.donorDomain) === normDonor &&
      normalizeTargetForMatch(ord.targetUrl) === normTarget,
  );
  if (matchedSending && byId.has(matchedSending.campaignId)) {
    return byId.get(matchedSending.campaignId)!;
  }

  return null;
}

function parseUnreadCount(rawUnread: unknown): number {
  if (typeof rawUnread === "number") return Math.max(0, Math.trunc(rawUnread));
  if (typeof rawUnread === "boolean") return rawUnread ? 1 : 0;
  if (rawUnread === null || rawUnread === undefined) return 0;
  const str = String(rawUnread).trim();
  if (!str || str === "0" || /^нет|false|прочитано$/i.test(str)) return 0;
  const digits = str.match(/\d+/);
  if (digits) return Number.parseInt(digits[0], 10);
  return 1;
}

/**
 * Synchronizes the GoGetLinks cabinet (wallet balance, active & closed campaigns,
 * paid/active/problem reviews, and webmaster message threads) into PostgreSQL.
 *
 * Emits delta IDs strictly for `wesetup.ru` campaigns (`isWesetup === true`).
 */
export async function syncGglCabinet(opts?: {
  includeThreads?: boolean;
  prismaClient?: GglSyncPrismaClient;
  readGgl?: ReadGglFn;
  now?: Date;
}): Promise<GglSyncSummary> {
  const client = opts?.prismaClient ?? db;
  const syncNow = opts?.now ?? new Date();
  const includeThreads = opts?.includeThreads !== false;
  const readGgl: ReadGglFn =
    opts?.readGgl ??
    (<T = unknown>(opName: string, args?: Record<string, unknown>) =>
      callGglRead<T>(opName, args, { prismaClient: client }));

  const account = await client.gglAccount.findFirst({
    orderBy: { createdAt: "asc" },
  });
  if (!account) {
    throw new GglSyncError(409, "Кабинет GoGetLinks ещё не подключён");
  }

  try {
    // 1. Wallet balance + campaigns
    const rawBalance = await readGgl("getAccountBalance");
    const balance = parseWalletBalance(rawBalance);
    const campaigns = await syncCampaignsFromGgl(client, readGgl, syncNow);
    const campaignById = new Map(campaigns.map((c) => [c.id, c]));

    const activeWesetup = campaigns.find((c) => c.isWesetup && c.state === "active");
    const nextDefaultCampaignId =
      account.defaultCampaignId ?? (activeWesetup ? activeWesetup.gglCampaignId : null);

    // 2. Load pre-sync orders to preserve human attribution & compute deltas accurately
    const existingOrdersRaw: Array<ExistingOrderSnapshot & { campaignId: string }> =
      await client.gglOrder.findMany();
    const existingByReviewId = new Map<number, ExistingOrderSnapshot & { campaignId: string }>();
    const sendingPool: Array<ExistingOrderSnapshot & { campaignId: string }> = [];

    for (const ord of existingOrdersRaw) {
      if (ord.gglReviewId !== null && ord.gglReviewId !== undefined) {
        existingByReviewId.set(ord.gglReviewId, ord);
      } else if (ord.status === "sending") {
        sendingPool.push(ord);
      }
    }

    // Collect incoming reviews per gglReviewId (tab status overrides generic paid list if present in both)
    const incomingByReviewId = new Map<
      number,
      { review: NormalizedGglReview; campaign: SyncedCampaignRecord }
    >();

    for (const camp of campaigns) {
      const paidRows = await readGgl("listCampaignPaidLinks", {
        campaignId: String(camp.gglCampaignId),
      });
      for (const rawRow of asRecordArray(paidRows)) {
        const norm = normalizeReviewRow(rawRow, "paid");
        if (norm) {
          incomingByReviewId.set(norm.gglReviewId, { review: norm, campaign: camp });
        }
      }
    }

    const tabMappings: ReadonlyArray<{ tab: string; status: string }> = [
      { tab: "in_progress", status: "in_progress" },
      { tab: "on_check", status: "on_check" },
      { tab: "needs_replacement", status: "needs_replacement" },
      { tab: "rejected", status: "rejected" },
    ];

    for (const { tab, status } of tabMappings) {
      let tabRows: unknown = [];
      try {
        tabRows = await readGgl("listReviewsByTab", { tab });
      } catch (err) {
        if (err instanceof GglAuthError || (err instanceof GglCallError && err.gglClass === "auth")) {
          throw err;
        }
        continue;
      }

      for (const rawRow of asRecordArray(tabRows)) {
        const norm = normalizeReviewRow(rawRow, status);
        if (!norm) continue;
        const priorPaid = incomingByReviewId.get(norm.gglReviewId);
        const resolvedCampaign =
          resolveCampaignForTabReview(rawRow, norm, campaigns, existingByReviewId, sendingPool) ??
          priorPaid?.campaign ??
          null;
        if (!resolvedCampaign) continue;
        incomingByReviewId.set(norm.gglReviewId, {
          review: norm,
          campaign: resolvedCampaign,
        });
      }
    }

    const newOnCheckOrderIds: string[] = [];
    const newReplacementOrderIds: string[] = [];
    const syncedOrdersByReviewId = new Map<
      number,
      { id: string; gglReviewId: number; campaignId: string; donorDomain: string }
    >();
    const syncedOrdersByDonor = new Map<
      string,
      Array<{ id: string; gglReviewId: number; campaignId: string; donorDomain: string }>
    >();

    let syncedOrdersCount = 0;
    const consumedSendingIds = new Set<string>();

    for (const { review, campaign } of incomingByReviewId.values()) {
      let existingMatch: (ExistingOrderSnapshot & { campaignId: string }) | null =
        existingByReviewId.get(review.gglReviewId) ?? null;

      if (!existingMatch) {
        const normDonor = normalizeHost(review.donorDomain);
        const normTarget = normalizeTargetForMatch(review.targetUrl);
        existingMatch =
          sendingPool.find(
            (s) =>
              !consumedSendingIds.has(s.id) &&
              s.campaignId === campaign.id &&
              normalizeHost(s.donorDomain) === normDonor &&
              normalizeTargetForMatch(s.targetUrl) === normTarget,
          ) ?? null;
        if (existingMatch) {
          consumedSendingIds.add(existingMatch.id);
        }
      }

      const plan = reconcileSyncedOrder(existingMatch, review);
      let savedOrder: { id: string };

      if (plan.existingId) {
        savedOrder = await client.gglOrder.update({
          where: { id: plan.existingId },
          data: {
            gglReviewId: plan.gglReviewId,
            campaignId: campaign.id,
            donorDomain: plan.donorDomain,
            ...(plan.donorDailyTraffic !== null ? { donorDailyTraffic: plan.donorDailyTraffic } : {}),
            ...(plan.donorTfCf !== null ? { donorTfCf: plan.donorTfCf } : {}),
            placementFormat: plan.placementFormat,
            priceRub: plan.priceRub,
            targetUrl: plan.targetUrl,
            anchor: plan.anchor,
            publishedUrl: plan.publishedUrl,
            paidAt: plan.paidAt,
            cancelledAt: plan.cancelledAt,
            status: plan.status,
            origin: plan.origin,
            initiatedByUserId: plan.initiatedByUserId,
            initiatedByName: plan.initiatedByName,
            approvedByUserId: plan.approvedByUserId,
            approvedByName: plan.approvedByName,
          },
        });

        // Reconcile uncertain slot approval ("approved_sending" -> "ordered") once GoGetLinks confirms the order
        if (
          existingMatch?.plannedSlotId &&
          existingMatch.status === "sending" &&
          plan.status !== "sending" &&
          client.gglPlannedSlot?.updateMany
        ) {
          await client.gglPlannedSlot.updateMany({
            where: { id: existingMatch.plannedSlotId, status: "approved_sending" },
            data: { status: "ordered" },
          });
        }
      } else {
        savedOrder = await client.gglOrder.create({
          data: {
            gglReviewId: plan.gglReviewId,
            campaignId: campaign.id,
            donorDomain: plan.donorDomain,
            donorDailyTraffic: plan.donorDailyTraffic,
            donorTfCf: plan.donorTfCf,
            placementFormat: plan.placementFormat,
            priceRub: plan.priceRub,
            targetUrl: plan.targetUrl,
            anchor: plan.anchor,
            publishedUrl: plan.publishedUrl,
            paidAt: plan.paidAt,
            cancelledAt: plan.cancelledAt,
            status: plan.status,
            origin: plan.origin,
            initiatedByUserId: plan.initiatedByUserId,
            initiatedByName: plan.initiatedByName,
            approvedByUserId: plan.approvedByUserId,
            approvedByName: plan.approvedByName,
            idempotencyKey: plan.idempotencyKey,
          },
        });
      }

      syncedOrdersCount += 1;
      const summaryEntry = {
        id: savedOrder.id,
        gglReviewId: plan.gglReviewId,
        campaignId: campaign.id,
        donorDomain: plan.donorDomain,
      };
      syncedOrdersByReviewId.set(plan.gglReviewId, summaryEntry);
      const donorKey = normalizeHost(plan.donorDomain);
      if (donorKey) {
        const list = syncedOrdersByDonor.get(donorKey) ?? [];
        list.push(summaryEntry);
        syncedOrdersByDonor.set(donorKey, list);
      }

      if (campaign.isWesetup === true) {
        if (plan.becameOnCheck) {
          newOnCheckOrderIds.push(savedOrder.id);
        }
        if (plan.becameNeedsReplacement) {
          newReplacementOrderIds.push(savedOrder.id);
        }
      }
    }

    // 3. Sync webmaster message threads & messages
    const newUnreadThreadIds: string[] = [];
    if (includeThreads) {
      const existingThreadsRaw: Array<{
        id: string;
        gglThreadKey: string;
        orderId: string | null;
        campaignId: string | null;
        donorDomain: string | null;
        unreadCount: number;
        lastMessageAt: Date | null;
      }> = await client.gglThread.findMany();
      const existingThreadByKey = new Map(existingThreadsRaw.map((t) => [t.gglThreadKey, t]));

      const rawThreads = await readGgl("listMessageThreads");
      const accountEmailLower = String(account.email || "").trim().toLowerCase();
      const accountLocalPart = accountEmailLower.split("@")[0] || "";

      for (const rawThread of asRecordArray(rawThreads)) {
        const gglThreadKey = String(
          rawThread.threadKey ?? rawThread.gglThreadKey ?? rawThread.id ?? "",
        ).trim();
        if (!gglThreadKey) continue;

        const existingThread = existingThreadByKey.get(gglThreadKey) ?? null;
        const subject = rawThread.subject ? String(rawThread.subject).trim() : null;
        const webmasterLogin = rawThread.author
          ? String(rawThread.author).trim()
          : rawThread.webmasterLogin
            ? String(rawThread.webmasterLogin).trim()
            : null;
        const unreadCount = parseUnreadCount(rawThread.unread ?? rawThread.unreadCount);
        const parsedThreadDate = parseGglDate(
          (rawThread.date ?? rawThread.lastMessageAt) as string | undefined,
        );

        // Link thread -> order -> campaign
        let linkedOrderId = existingThread?.orderId ?? null;
        let linkedCampaignId = existingThread?.campaignId ?? null;
        let donorDomain =
          (typeof rawThread.donorDomain === "string" && rawThread.donorDomain.trim()) ||
          existingThread?.donorDomain ||
          null;

        const keyNumMatch = gglThreadKey.match(/^(?:rev_)?(\d+)$/i);
        const subjectRevMatch = subject?.match(/#(\d+)/);
        const candidateReviewId = keyNumMatch
          ? Number.parseInt(keyNumMatch[1], 10)
          : subjectRevMatch
            ? Number.parseInt(subjectRevMatch[1], 10)
            : null;

        if (candidateReviewId && syncedOrdersByReviewId.has(candidateReviewId)) {
          const matchedOrd = syncedOrdersByReviewId.get(candidateReviewId)!;
          linkedOrderId = matchedOrd.id;
          linkedCampaignId = matchedOrd.campaignId;
          donorDomain = donorDomain || matchedOrd.donorDomain;
        }

        if (!linkedCampaignId && subject) {
          for (const [dKey, donorOrders] of syncedOrdersByDonor.entries()) {
            if (dKey && subject.toLowerCase().includes(dKey)) {
              const preferred =
                donorOrders.find((o) => campaignById.get(o.campaignId)?.isWesetup) ?? donorOrders[0];
              linkedOrderId = linkedOrderId || preferred.id;
              linkedCampaignId = preferred.campaignId;
              donorDomain = donorDomain || preferred.donorDomain;
              break;
            }
          }
        }

        if (!linkedCampaignId && rawThread.campaignId) {
          const cid = String(rawThread.campaignId).trim();
          const cMatch =
            campaignById.get(cid) ??
            campaigns.find((c) => String(c.gglCampaignId) === cid) ??
            null;
          if (cMatch) linkedCampaignId = cMatch.id;
        }

        const savedThread = await client.gglThread.upsert({
          where: { gglThreadKey },
          create: {
            gglThreadKey,
            orderId: linkedOrderId,
            campaignId: linkedCampaignId,
            donorDomain,
            webmasterLogin,
            subject,
            unreadCount,
            needsReply: unreadCount > 0,
            lastMessageAt: parsedThreadDate,
            lastMessagePreview: subject,
          },
          update: {
            orderId: linkedOrderId,
            campaignId: linkedCampaignId,
            donorDomain,
            webmasterLogin,
            subject,
            unreadCount,
            ...(parsedThreadDate ? { lastMessageAt: parsedThreadDate } : {}),
          },
        });

        const existingThreadMsgs: Array<{
          id: string;
          gglMessageId: string | null;
          direction: string;
          body: string;
          deliveryStatus: string;
          sentByUserId: string | null;
          sentByName: string | null;
          sentAt: Date;
        }> = await client.gglMessage.findMany({
          where: { threadId: savedThread.id },
        });

        const hasPendingOutbound = existingThreadMsgs.some((m) => m.deliveryStatus === "sending");
        const dateChanged =
          parsedThreadDate !== null &&
          (!existingThread?.lastMessageAt ||
            existingThread.lastMessageAt.getTime() !== parsedThreadDate.getTime());
        const shouldFetchMessages =
          !existingThread ||
          unreadCount > 0 ||
          unreadCount !== existingThread.unreadCount ||
          dateChanged ||
          hasPendingOutbound;

        if (shouldFetchMessages) {
          const rawMessages = asRecordArray(
            await readGgl("getMessageThread", { threadKey: gglThreadKey }),
          );

          const existingByGglMsgId = new Map<string, (typeof existingThreadMsgs)[number]>();
          for (const m of existingThreadMsgs) {
            if (m.gglMessageId) existingByGglMsgId.set(m.gglMessageId, m);
          }
          const matchedPendingIds = new Set<string>();

          let latestSentAt: Date | null = parsedThreadDate ?? existingThread?.lastMessageAt ?? null;
          let latestPreview: string | null = subject;
          let lastDirection: string | null = null;

          for (let idx = 0; idx < rawMessages.length; idx += 1) {
            const rawMsg = rawMessages[idx];
            const rawBody = String(rawMsg.text ?? rawMsg.body ?? "").trim();
            if (!rawBody) continue;

            const authorLabel =
              String(rawMsg.sender ?? rawMsg.author ?? rawMsg.authorLabel ?? "Собеседник").trim() ||
              "Собеседник";
            const rawDateStr = String(rawMsg.date ?? rawMsg.sentAt ?? "").trim();
            const parsedMsgDate = parseGglDate(rawDateStr) ?? syncNow;
            const normBody = normalizeMessageBody(rawBody);

            const explicitMsgId = String(
              rawMsg.gglMessageId ?? rawMsg.messageId ?? rawMsg.id ?? "",
            ).trim();
            const gglMessageId =
              explicitMsgId ||
              `gglmsg_${crypto
                .createHash("sha256")
                .update(`${gglThreadKey}|${idx}|${authorLabel}|${rawDateStr}|${normBody}`)
                .digest("hex")
                .slice(0, 24)}`;

            // Match pending outbound ("sending") message within 30 minutes by normalized body
            const matchedPending = existingThreadMsgs.find((m) => {
              if (matchedPendingIds.has(m.id)) return false;
              if (m.deliveryStatus !== "sending" || m.direction !== "outbound") return false;
              const ageMs = Math.abs(syncNow.getTime() - new Date(m.sentAt).getTime());
              if (ageMs > THIRTY_MINUTES_MS) return false;
              return normalizeMessageBody(m.body) === normBody;
            });

            const authorLower = authorLabel.toLowerCase();
            let direction: "inbound" | "outbound" = "inbound";
            if (rawMsg.direction === "outbound" || rawMsg.direction === "inbound") {
              direction = rawMsg.direction;
            } else if (
              matchedPending ||
              (accountEmailLower && authorLower === accountEmailLower) ||
              (accountLocalPart && authorLower === accountLocalPart) ||
              /^(вы|я|оптимизатор|optimizer|me|you)$/i.test(authorLower)
            ) {
              direction = "outbound";
            }

            if (matchedPending) {
              matchedPendingIds.add(matchedPending.id);
              await client.gglMessage.update({
                where: { id: matchedPending.id },
                data: {
                  gglMessageId,
                  direction: "outbound",
                  deliveryStatus: "synced",
                  sentByUserId: matchedPending.sentByUserId,
                  sentByName: matchedPending.sentByName,
                },
              });
            } else {
              const alreadySynced = existingByGglMsgId.get(gglMessageId);
              if (alreadySynced) {
                await client.gglMessage.update({
                  where: { id: alreadySynced.id },
                  data: {
                    body: rawBody,
                    deliveryStatus: "synced",
                    sentByUserId: alreadySynced.sentByUserId,
                    sentByName: alreadySynced.sentByName,
                  },
                });
              } else {
                await client.gglMessage.create({
                  data: {
                    threadId: savedThread.id,
                    gglMessageId,
                    direction,
                    authorLabel,
                    body: rawBody,
                    deliveryStatus: "synced",
                    sentAt: parsedMsgDate,
                  },
                });
              }
            }

            latestSentAt = parsedMsgDate;
            latestPreview = rawBody.slice(0, 200);
            lastDirection = direction;
          }

          await client.gglThread.update({
            where: { id: savedThread.id },
            data: {
              needsReply: unreadCount > 0 || lastDirection === "inbound",
              ...(latestSentAt ? { lastMessageAt: latestSentAt } : {}),
              ...(latestPreview ? { lastMessagePreview: latestPreview } : {}),
            },
          });
        }

        const threadCampaign = linkedCampaignId ? campaignById.get(linkedCampaignId) : null;
        const becameUnread = unreadCount > 0 && (!existingThread || unreadCount > existingThread.unreadCount);
        if (threadCampaign?.isWesetup === true && becameUnread) {
          newUnreadThreadIds.push(savedThread.id);
        }
      }
    }

    // 4. Persist synced account metrics & status
    await client.gglAccount.update({
      where: { id: account.id },
      data: {
        balanceRub: balance.balanceRub,
        availableRub: balance.availableRub,
        blockedRub: balance.blockedRub,
        defaultCampaignId: nextDefaultCampaignId,
        status: "ok",
        lastSyncedAt: syncNow,
        lastError: null,
      },
    });

    return {
      syncedAt: syncNow.toISOString(),
      balanceRub: balance.balanceRub,
      availableRub: balance.availableRub,
      blockedRub: balance.blockedRub,
      campaignsCount: campaigns.length,
      ordersCount: syncedOrdersCount,
      newUnreadThreadIds,
      newOnCheckOrderIds,
      newReplacementOrderIds,
    };
  } catch (err) {
    const isAuth =
      err instanceof GglAuthError || (err instanceof GglCallError && err.gglClass === "auth");
    const errMsg = err instanceof Error ? err.message : String(err);
    await client.gglAccount
      .update({
        where: { id: account.id },
        data: {
          status: isAuth ? "auth_error" : "error",
          lastError: errMsg.slice(0, 500),
        },
      })
      .catch(() => {});
    throw err;
  }
}

/**
 * Ensures an active `wesetup.ru` campaign exists in GoGetLinks:
 * creates it via `createOrUpdateCampaign` if missing, refreshes campaigns,
 * and binds `GglAccount.defaultCampaignId`.
 */
export async function ensureWesetupCampaign(
  input: {
    name?: string;
    maxPriceContextRub?: number;
    maxPriceNoteRub?: number;
    maxPriceArticleRub?: number;
    idempotencyKey: string;
  },
  deps?: {
    prismaClient?: GglAccountSavePrismaClient;
    readGgl?: ReadGglFn;
    writeGgl?: WriteGglFn;
  },
): Promise<GglCampaign> {
  const client = deps?.prismaClient ?? db;
  const readGgl: ReadGglFn =
    deps?.readGgl ??
    (<T = unknown>(opName: string, args?: Record<string, unknown>) =>
      callGglRead<T>(opName, args, { prismaClient: client }));
  const writeGgl: WriteGglFn = deps?.writeGgl ?? callGglWrite;

  const account = await client.gglAccount.findFirst({
    orderBy: { createdAt: "asc" },
  });
  if (!account) {
    throw new GglSyncError(409, "Сначала подключите аккаунт GoGetLinks");
  }

  // First sync current campaigns to see if wesetup.ru already exists
  await syncCampaignsFromGgl(client, readGgl, new Date());

  let existingActive: GglCampaign | null = await client.gglCampaign.findFirst({
    where: { isWesetup: true, state: "active" },
    orderBy: { gglCampaignId: "desc" },
  });

  if (!existingActive) {
    const campaignName = input.name?.trim() || "WeSetup — ХАССП и СанПиН";
    await writeGgl({
      opName: "createOrUpdateCampaign",
      args: {
        name: campaignName,
        siteUrl: "https://wesetup.ru",
        ...(input.maxPriceContextRub !== undefined
          ? { maxPriceContextRub: input.maxPriceContextRub }
          : {}),
        ...(input.maxPriceNoteRub !== undefined ? { maxPriceNoteRub: input.maxPriceNoteRub } : {}),
        ...(input.maxPriceArticleRub !== undefined
          ? { maxPriceArticleRub: input.maxPriceArticleRub }
          : {}),
      },
      idempotencyKey: input.idempotencyKey,
      prismaClient: client,
    });

    await syncCampaignsFromGgl(client, readGgl, new Date());
    existingActive = await client.gglCampaign.findFirst({
      where: { isWesetup: true },
      orderBy: [{ state: "asc" }, { gglCampaignId: "desc" }],
    });
  }

  if (!existingActive) {
    throw new GglSyncError(
      502,
      "Запрос на создание кампании wesetup.ru отправлен в GoGetLinks, но кампания ещё не отобразилась в списке. Запустите синхронизацию повторно.",
    );
  }

  await client.gglAccount.update({
    where: { id: account.id },
    data: { defaultCampaignId: existingActive.gglCampaignId },
  });

  return existingActive;
}
