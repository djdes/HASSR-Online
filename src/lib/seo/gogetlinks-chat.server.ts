import crypto from "node:crypto";
import { audit } from "@/lib/audit-helper";
import { db } from "@/lib/db";
import {
  callGglRead,
  callGglWrite,
  GglAuthError,
  GglCallError,
  GglIsolationError,
} from "@/lib/seo/gogetlinks-client.server";
import {
  decimalToNumber,
  normalizeMessageBody,
  parseGglDate,
} from "@/lib/seo/gogetlinks-sync.server";

const THIRTY_MINUTES_MS = 30 * 60 * 1000;

const platformOrgId = (): string => process.env.PLATFORM_ORG_ID?.trim() || "platform";

export class GglChatError extends Error {
  public readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "GglChatError";
    this.status = status;
  }
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

export interface GglThreadOrderSummaryDto {
  id: string;
  gglReviewId: number | null;
  donorDomain: string;
  targetUrl: string;
  anchor: string;
  priceRub: number;
  status: string;
  publishedUrl: string | null;
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
  order: GglThreadOrderSummaryDto | null;
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

export interface GglOrderDto {
  id: string;
  gglReviewId: number | null;
  campaignId: string;
  campaign: {
    id: string;
    gglCampaignId: number;
    name: string;
    domain: string;
    isWesetup: boolean;
    state: string;
  } | null;
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

export interface ThreadGuardRecord {
  id: string;
  gglThreadKey: string;
  campaignId: string | null;
  campaignIsWesetup: boolean;
}

export interface ClaimedMessageSnapshot {
  id: string;
  threadId?: string;
  gglMessageId?: string | null;
  direction?: string;
  authorLabel?: string;
  sentByUserId?: string | null;
  sentByName: string | null;
  body?: string;
  deliveryStatus: string;
  idempotencyKey?: string | null;
  sentAt?: Date | string;
  createdAt?: Date | string;
}

export interface OrderGuardRecord {
  id: string;
  gglReviewId: number | null;
  status: string;
  campaignId: string;
  campaignIsWesetup: boolean;
  campaign?: {
    id: string;
    gglCampaignId: number;
    name: string;
    domain: string;
    isWesetup: boolean;
    state: string;
  } | null;
  donorSiteId?: number | null;
  donorDomain?: string;
  donorDailyTraffic?: number | null;
  donorTfCf?: string | null;
  donorTrust?: number | null;
  placementFormat?: string;
  priceRub?: unknown;
  targetUrl?: string;
  anchor?: string;
  publishedUrl?: string | null;
  articleId?: string | null;
  paidAt?: Date | string | null;
  cancelledAt?: Date | string | null;
  indexedStatus?: string | null;
  origin?: string;
  initiatedByUserId?: string | null;
  initiatedByName?: string | null;
  approvedByUserId?: string | null;
  approvedByName?: string | null;
  approvedAt?: Date | string | null;
  plannedSlotId?: string | null;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
}

export type RemoteWriteStatus =
  | "applied"
  | "accepted"
  | "may_have_applied"
  | "not_sent"
  | "not_applied";

export interface ChatAuditEntry {
  action: string;
  entity: string;
  entityId: string;
  actor: { id: string; name: string };
  details: Record<string, unknown>;
}

export type ChatPrismaClient = Pick<typeof db, "gglThread" | "gglMessage"> &
  Partial<Pick<typeof db, "gglOrder" | "gglAccount">>;

export interface ChatServiceDeps {
  prismaClient?: ChatPrismaClient;
  findThread?: (threadId: string) => Promise<ThreadGuardRecord | null>;
  claimOutboundMessage?: (
    key: string,
    user: { id: string; name: string },
    meta: { threadId: string; body: string },
  ) => Promise<{ claimed: boolean; message: ClaimedMessageSnapshot }>;
  markMessageStatus?: (
    key: string,
    status: "synced" | "sending" | "failed",
  ) => Promise<void | ClaimedMessageSnapshot>;
  sendRemote?: (args: {
    threadKey: string;
    text: string;
    idempotencyKey: string;
    campaignId: string | null;
  }) => Promise<{ status: RemoteWriteStatus; data: unknown }>;
  findOrder?: (orderId: string) => Promise<OrderGuardRecord | null>;
  reviewRemote?: (args: {
    reviewId: string;
    action: "accept" | "request_revision";
    comment?: string;
    idempotencyKey: string;
    campaignId: string;
  }) => Promise<{ status: RemoteWriteStatus; data: unknown }>;
  updateOrderStatus?: (
    orderId: string,
    status: string,
    meta: { action: "accept" | "request_revision"; user: { id: string; name: string } },
  ) => Promise<void | OrderGuardRecord>;
  writeAudit?: (entry: ChatAuditEntry) => Promise<void>;
}

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return new Date(value).toISOString();
}

function isPrismaUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  return (err as { code?: unknown }).code === "P2002";
}

function isExplicitlyNotAppliedError(err: unknown): boolean {
  if (err instanceof GglAuthError) return true;
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

export function serializeGglMessage(
  row: ClaimedMessageSnapshot,
  fallback?: {
    threadId: string;
    body: string;
    idempotencyKey: string;
    user: { id: string; name: string };
  },
): GglMessageDto {
  const nowIso = new Date().toISOString();
  const sentAtIso = row.sentAt ? new Date(row.sentAt).toISOString() : nowIso;
  const createdAtIso = row.createdAt ? new Date(row.createdAt).toISOString() : sentAtIso;
  return {
    id: row.id,
    threadId: row.threadId ?? fallback?.threadId ?? "",
    gglMessageId: row.gglMessageId ?? null,
    direction: row.direction ?? "outbound",
    authorLabel: row.authorLabel ?? row.sentByName ?? fallback?.user.name ?? "WeSetup",
    sentByUserId: row.sentByUserId ?? fallback?.user.id ?? null,
    sentByName: row.sentByName ?? fallback?.user.name ?? null,
    body: row.body ?? fallback?.body ?? "",
    deliveryStatus: row.deliveryStatus,
    idempotencyKey: row.idempotencyKey ?? fallback?.idempotencyKey ?? null,
    sentAt: sentAtIso,
    createdAt: createdAtIso,
  };
}

export function serializeGglThread(row: {
  id: string;
  gglThreadKey: string;
  orderId: string | null;
  campaignId: string | null;
  campaign?: {
    id: string;
    gglCampaignId: number;
    name: string;
    domain: string;
    isWesetup: boolean;
  } | null;
  order?: {
    id: string;
    gglReviewId: number | null;
    donorDomain: string;
    targetUrl: string;
    anchor: string;
    priceRub: unknown;
    status: string;
    publishedUrl: string | null;
  } | null;
  donorDomain: string | null;
  webmasterLogin: string | null;
  subject: string | null;
  unreadCount: number;
  needsReply: boolean;
  lastMessageAt: Date | string | null;
  lastMessagePreview: string | null;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
}): GglThreadDto {
  return {
    id: row.id,
    gglThreadKey: row.gglThreadKey,
    orderId: row.orderId,
    campaignId: row.campaignId,
    campaign: row.campaign ?? null,
    order: row.order
      ? {
          id: row.order.id,
          gglReviewId: row.order.gglReviewId,
          donorDomain: row.order.donorDomain,
          targetUrl: row.order.targetUrl,
          anchor: row.order.anchor,
          priceRub: decimalToNumber(row.order.priceRub),
          status: row.order.status,
          publishedUrl: row.order.publishedUrl,
        }
      : null,
    donorDomain: row.donorDomain,
    webmasterLogin: row.webmasterLogin,
    subject: row.subject,
    unreadCount: row.unreadCount,
    needsReply: row.needsReply,
    lastMessageAt: toIso(row.lastMessageAt),
    lastMessagePreview: row.lastMessagePreview,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

export function serializeGglOrder(row: OrderGuardRecord): GglOrderDto {
  return {
    id: row.id,
    gglReviewId: row.gglReviewId ?? null,
    campaignId: row.campaignId,
    campaign: row.campaign ?? null,
    donorSiteId: row.donorSiteId ?? null,
    donorDomain: row.donorDomain ?? "",
    donorDailyTraffic: row.donorDailyTraffic ?? null,
    donorTfCf: row.donorTfCf ?? null,
    donorTrust: row.donorTrust ?? null,
    placementFormat: row.placementFormat ?? "note",
    priceRub: decimalToNumber(row.priceRub),
    targetUrl: row.targetUrl ?? "",
    anchor: row.anchor ?? "",
    publishedUrl: row.publishedUrl ?? null,
    articleId: row.articleId ?? null,
    paidAt: toIso(row.paidAt),
    cancelledAt: toIso(row.cancelledAt),
    indexedStatus: row.indexedStatus ?? null,
    status: row.status,
    origin: row.origin ?? "external_ggl",
    initiatedByUserId: row.initiatedByUserId ?? null,
    initiatedByName: row.initiatedByName ?? null,
    approvedByUserId: row.approvedByUserId ?? null,
    approvedByName: row.approvedByName ?? null,
    approvedAt: toIso(row.approvedAt),
    plannedSlotId: row.plannedSlotId ?? null,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

/**
 * Lists webmaster message threads with optional unread / needs-reply / other-project filters.
 */
export async function listGglThreads(
  filters?: {
    onlyUnread?: boolean;
    needsReply?: boolean;
    includeOtherProjects?: boolean;
  },
  deps?: {
    prismaClient?: Pick<typeof db, "gglThread">;
  },
): Promise<GglThreadDto[]> {
  const client = deps?.prismaClient ?? db;
  const includeOtherProjects = Boolean(filters?.includeOtherProjects);
  const onlyUnread = Boolean(filters?.onlyUnread);
  const needsReply = Boolean(filters?.needsReply);

  const rows = await client.gglThread.findMany({
    where: {
      ...(includeOtherProjects ? {} : { campaign: { isWesetup: true } }),
      ...(onlyUnread ? { unreadCount: { gt: 0 } } : {}),
      ...(needsReply ? { needsReply: true } : {}),
    },
    include: {
      campaign: {
        select: {
          id: true,
          gglCampaignId: true,
          name: true,
          domain: true,
          isWesetup: true,
        },
      },
      order: {
        select: {
          id: true,
          gglReviewId: true,
          donorDomain: true,
          targetUrl: true,
          anchor: true,
          priceRub: true,
          status: true,
          publishedUrl: true,
        },
      },
    },
    orderBy: [{ needsReply: "desc" }, { unreadCount: "desc" }, { lastMessageAt: "desc" }],
  });

  return rows.map((row) => serializeGglThread(row));
}

function asRecordArray(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object");
}

/**
 * Loads a single GoGetLinks thread by ID, refreshes messages live from GoGetLinks (`getMessageThread`)
 * when available, reconciles pending outbound messages while preserving `sentByName`, and returns
 * the serialized thread (with linked `GglOrder`) + chronological messages.
 */
export async function getAndRefreshGglThread(
  threadId: string,
  opts?: {
    refresh?: boolean;
    prismaClient?: Pick<typeof db, "gglThread" | "gglMessage"> &
      Partial<Pick<typeof db, "gglAccount">>;
    readGgl?: <T = unknown>(opName: string, args?: Record<string, unknown>) => Promise<T>;
    now?: Date;
  },
): Promise<{
  thread: GglThreadDto;
  messages: GglMessageDto[];
  refreshError: string | null;
}> {
  const client = opts?.prismaClient ?? db;
  const syncNow = opts?.now ?? new Date();
  const shouldRefresh = opts?.refresh !== false;

  const threadRow = await client.gglThread.findUnique({
    where: { id: threadId },
    include: {
      campaign: {
        select: {
          id: true,
          gglCampaignId: true,
          name: true,
          domain: true,
          isWesetup: true,
        },
      },
      order: {
        select: {
          id: true,
          gglReviewId: true,
          donorDomain: true,
          targetUrl: true,
          anchor: true,
          priceRub: true,
          status: true,
          publishedUrl: true,
        },
      },
    },
  });

  if (!threadRow) {
    throw new GglChatError(404, "Диалог не найден");
  }

  let refreshError: string | null = null;
  let currentThread = threadRow;

  if (shouldRefresh) {
    const account = client.gglAccount
      ? await client.gglAccount.findFirst({ orderBy: { createdAt: "asc" } })
      : null;

    if (account || opts?.readGgl) {
      const readGgl =
        opts?.readGgl ??
        (<T = unknown>(opName: string, args?: Record<string, unknown>) =>
          callGglRead<T>(opName, args, { prismaClient: client }));

      try {
        const rawMessages = asRecordArray(
          await readGgl("getMessageThread", { threadKey: threadRow.gglThreadKey }),
        );

        const existingMsgs = await client.gglMessage.findMany({
          where: { threadId: threadRow.id },
        });
        const existingByGglMsgId = new Map<string, (typeof existingMsgs)[number]>();
        for (const m of existingMsgs) {
          if (m.gglMessageId) existingByGglMsgId.set(m.gglMessageId, m);
        }
        const matchedPendingIds = new Set<string>();

        const accountEmailLower = String(account?.email || "").trim().toLowerCase();
        const accountLocalPart = accountEmailLower.split("@")[0] || "";

        let latestSentAt: Date | null = threadRow.lastMessageAt ?? null;
        let latestPreview: string | null = threadRow.lastMessagePreview ?? threadRow.subject;
        let lastDirection: "inbound" | "outbound" | null = null;

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
              .update(`${threadRow.gglThreadKey}|${idx}|${authorLabel}|${rawDateStr}|${normBody}`)
              .digest("hex")
              .slice(0, 24)}`;

          const matchedPending = existingMsgs.find((m) => {
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
                  threadId: threadRow.id,
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

        const nextNeedsReply =
          lastDirection !== null ? lastDirection === "inbound" : threadRow.needsReply;
        await client.gglThread.update({
          where: { id: threadRow.id },
          data: {
            unreadCount: 0,
            needsReply: nextNeedsReply,
            ...(latestSentAt ? { lastMessageAt: latestSentAt } : {}),
            ...(latestPreview ? { lastMessagePreview: latestPreview } : {}),
          },
        });

        currentThread = {
          ...threadRow,
          unreadCount: 0,
          needsReply: nextNeedsReply,
          lastMessageAt: latestSentAt ?? threadRow.lastMessageAt,
          lastMessagePreview: latestPreview ?? threadRow.lastMessagePreview,
        };
      } catch (err) {
        refreshError = err instanceof Error ? err.message : String(err);
      }
    }
  }

  const finalMessages = await client.gglMessage.findMany({
    where: { threadId: threadRow.id },
    orderBy: [{ sentAt: "asc" }, { createdAt: "asc" }],
  });

  const sortedMessages = [...finalMessages].sort((a, b) => {
    const aTime = new Date(a.sentAt).getTime();
    const bTime = new Date(b.sentAt).getTime();
    if (aTime !== bTime) return aTime - bTime;
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });

  return {
    thread: serializeGglThread(currentThread),
    messages: sortedMessages.map((msg) => serializeGglMessage(msg)),
    refreshError,
  };
}

/**
 * Sends a two-way reply to a GoGetLinks webmaster dialogue with strict `wesetup.ru` campaign
 * isolation, atomic `idempotencyKey` claim (`deliveryStatus: "sending"`), safe reconciliation
 * on ambiguous network outcomes (`may_have_applied`), and `AuditLog` tracking (`ggl.message.reply`).
 */
export async function replyToGglThread(
  input: {
    threadId: string;
    body: string;
    idempotencyKey: string;
    user: { id: string; name: string };
  },
  deps?: ChatServiceDeps,
): Promise<GglMessageDto> {
  const cleanBody = input.body.trim();
  if (!cleanBody) {
    throw new GglChatError(400, "Введите текст сообщения");
  }
  const cleanKey = input.idempotencyKey.trim();
  if (!cleanKey) {
    throw new GglChatError(400, "Укажите ключ идемпотентности (idempotencyKey)");
  }

  const client = deps?.prismaClient ?? db;

  const findThread =
    deps?.findThread ??
    (async (tid: string): Promise<ThreadGuardRecord | null> => {
      const row = await client.gglThread.findUnique({
        where: { id: tid },
        include: {
          campaign: { select: { id: true, isWesetup: true } },
          order: {
            include: {
              campaign: { select: { id: true, isWesetup: true } },
            },
          },
        },
      });
      if (!row) return null;
      const campaignId = row.campaignId ?? row.order?.campaignId ?? null;
      const campaignIsWesetup = Boolean(
        row.campaign?.isWesetup ?? row.order?.campaign?.isWesetup ?? false,
      );
      return {
        id: row.id,
        gglThreadKey: row.gglThreadKey,
        campaignId,
        campaignIsWesetup,
      };
    });

  const thread = await findThread(input.threadId);
  if (!thread) {
    throw new GglChatError(404, "Диалог не найден");
  }

  if (thread.campaignIsWesetup !== true) {
    throw new GglIsolationError(
      `Отправка сообщения отклонена: диалог "${thread.id}" не принадлежит кампании wesetup.ru`,
    );
  }

  const claimOutboundMessage =
    deps?.claimOutboundMessage ??
    (async (
      key: string,
      user: { id: string; name: string },
      meta: { threadId: string; body: string },
    ): Promise<{ claimed: boolean; message: ClaimedMessageSnapshot }> => {
      const existing = await client.gglMessage.findUnique({
        where: { idempotencyKey: key },
      });
      if (existing) {
        return { claimed: false, message: existing };
      }

      try {
        const created = await client.gglMessage.create({
          data: {
            threadId: meta.threadId,
            direction: "outbound",
            authorLabel: user.name || "WeSetup",
            sentByUserId: user.id,
            sentByName: user.name,
            body: meta.body,
            deliveryStatus: "sending",
            idempotencyKey: key,
            sentAt: new Date(),
          },
        });
        return { claimed: true, message: created };
      } catch (err: unknown) {
        if (isPrismaUniqueViolation(err)) {
          const raced = await client.gglMessage.findUnique({
            where: { idempotencyKey: key },
          });
          if (raced) {
            return { claimed: false, message: raced };
          }
        }
        throw err;
      }
    });

  const markMessageStatus =
    deps?.markMessageStatus ??
    (async (key: string, status: "synced" | "sending" | "failed") => {
      const updated = await client.gglMessage.update({
        where: { idempotencyKey: key },
        data: { deliveryStatus: status },
      });
      if (status === "synced") {
        await client.gglThread
          .update({
            where: { id: thread.id },
            data: {
              unreadCount: 0,
              needsReply: false,
              lastMessageAt: updated.sentAt,
              lastMessagePreview: cleanBody.slice(0, 200),
            },
          })
          .catch(() => {});
      }
      return updated;
    });

  const sendRemote =
    deps?.sendRemote ??
    (async (args) =>
      callGglWrite({
        opName: "sendThreadMessage",
        args: {
          threadKey: args.threadKey,
          text: args.text,
        },
        idempotencyKey: args.idempotencyKey,
        campaignIdForGuard: args.campaignId ?? undefined,
        prismaClient: client,
      }));

  const writeAudit =
    deps?.writeAudit ??
    (async (entry) => {
      await audit({
        orgId: platformOrgId(),
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId,
        actor: entry.actor,
        details: entry.details,
      });
    });

  const claimResult = await claimOutboundMessage(cleanKey, input.user, {
    threadId: thread.id,
    body: cleanBody,
  });

  if (!claimResult.claimed) {
    return serializeGglMessage(claimResult.message, {
      threadId: thread.id,
      body: cleanBody,
      idempotencyKey: cleanKey,
      user: input.user,
    });
  }

  let finalStatus: "synced" | "sending" | "failed" = "sending";
  let updatedSnapshot: ClaimedMessageSnapshot = claimResult.message;

  try {
    const remoteRes = await sendRemote({
      threadKey: thread.gglThreadKey,
      text: cleanBody,
      idempotencyKey: cleanKey,
      campaignId: thread.campaignId,
    });

    if (remoteRes.status === "applied" || remoteRes.status === "accepted") {
      finalStatus = "synced";
      const marked = await markMessageStatus(cleanKey, "synced");
      if (marked) updatedSnapshot = marked;
    } else if (remoteRes.status === "not_sent" || remoteRes.status === "not_applied") {
      finalStatus = "failed";
      await markMessageStatus(cleanKey, "failed");
      throw new GglCallError(
        `GoGetLinks отклонил отправку сообщения (${remoteRes.status})`,
        remoteRes.status,
      );
    }
    // For "may_have_applied", finalStatus remains "sending" until the next cabinet sync confirms it.
  } catch (err: unknown) {
    if (finalStatus !== "failed" && isExplicitlyNotAppliedError(err)) {
      await markMessageStatus(cleanKey, "failed");
    }
    throw err;
  }

  await writeAudit({
    action: "ggl.message.reply",
    entity: "GglMessage",
    entityId: updatedSnapshot.id,
    actor: input.user,
    details: {
      threadId: thread.id,
      gglThreadKey: thread.gglThreadKey,
      deliveryStatus: finalStatus,
      idempotencyKey: cleanKey,
      preview: cleanBody.slice(0, 140),
    },
  });

  return serializeGglMessage(
    {
      ...updatedSnapshot,
      deliveryStatus: finalStatus,
    },
    {
      threadId: thread.id,
      body: cleanBody,
      idempotencyKey: cleanKey,
      user: input.user,
    },
  );
}

/**
 * Accepts a placed GoGetLinks review (`"paid"`) or requests a revision from the webmaster
 * (`"in_progress"`), strictly restricted to `wesetup.ru` campaigns.
 */
export async function reviewGglPlacement(
  input: {
    orderId: string;
    action: "accept" | "request_revision";
    comment?: string;
    idempotencyKey: string;
    user: { id: string; name: string };
  },
  deps?: ChatServiceDeps,
): Promise<GglOrderDto> {
  if (input.action !== "accept" && input.action !== "request_revision") {
    throw new GglChatError(400, "Недопустимое действие проверки размещения");
  }

  const cleanComment = input.comment?.trim() ?? "";
  if (input.action === "request_revision" && cleanComment.length < 5) {
    throw new GglChatError(
      400,
      "Укажите причину возврата на доработку (минимум 5 символов)",
    );
  }

  const cleanKey = input.idempotencyKey.trim();
  if (!cleanKey) {
    throw new GglChatError(400, "Укажите ключ идемпотентности (idempotencyKey)");
  }

  const client = deps?.prismaClient ?? db;

  const findOrder =
    deps?.findOrder ??
    (async (oid: string): Promise<OrderGuardRecord | null> => {
      if (!client.gglOrder) {
        throw new GglChatError(500, "Модель gglOrder недоступна");
      }
      const row = await client.gglOrder.findUnique({
        where: { id: oid },
        include: {
          campaign: {
            select: {
              id: true,
              gglCampaignId: true,
              name: true,
              domain: true,
              isWesetup: true,
              state: true,
            },
          },
        },
      });
      if (!row) return null;
      return {
        ...row,
        campaignIsWesetup: Boolean(row.campaign?.isWesetup),
      };
    });

  const order = await findOrder(input.orderId);
  if (!order) {
    throw new GglChatError(404, "Заявка не найдена");
  }

  if (order.campaignIsWesetup !== true) {
    throw new GglIsolationError(
      `Проверка размещения отклонена: заявка "${order.id}" не принадлежит кампании wesetup.ru`,
    );
  }

  if (!order.gglReviewId || order.gglReviewId <= 0) {
    throw new GglChatError(
      409,
      "У заявки отсутствует идентификатор обзора в GoGetLinks — выполните синхронизацию",
    );
  }

  if (order.status === "rejected" || order.status === "failed") {
    throw new GglChatError(
      409,
      `Нельзя выполнить проверку для заявки в статусе "${order.status}"`,
    );
  }

  // Idempotent short-circuit if already accepted
  if (input.action === "accept" && order.status === "paid") {
    return serializeGglOrder(order);
  }

  const reviewRemote =
    deps?.reviewRemote ??
    (async (args) =>
      callGglWrite({
        opName: "reviewPlacementAction",
        args: {
          reviewId: args.reviewId,
          action: args.action,
          ...(args.comment ? { comment: args.comment } : {}),
        },
        idempotencyKey: args.idempotencyKey,
        campaignIdForGuard: args.campaignId,
        prismaClient: client,
      }));

  const updateOrderStatus =
    deps?.updateOrderStatus ??
    (async (oid: string, status: string) => {
      if (!client.gglOrder) return;
      const updated = await client.gglOrder.update({
        where: { id: oid },
        data: {
          status,
          ...(status === "paid" && !order.paidAt ? { paidAt: new Date() } : {}),
        },
        include: {
          campaign: {
            select: {
              id: true,
              gglCampaignId: true,
              name: true,
              domain: true,
              isWesetup: true,
              state: true,
            },
          },
        },
      });
      return {
        ...updated,
        campaignIsWesetup: Boolean(updated.campaign?.isWesetup),
      };
    });

  const writeAudit =
    deps?.writeAudit ??
    (async (entry) => {
      await audit({
        orgId: platformOrgId(),
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId,
        actor: entry.actor,
        details: entry.details,
      });
    });

  const remoteRes = await reviewRemote({
    reviewId: String(order.gglReviewId),
    action: input.action,
    ...(cleanComment ? { comment: cleanComment } : {}),
    idempotencyKey: cleanKey,
    campaignId: order.campaignId,
  });

  if (remoteRes.status === "not_sent" || remoteRes.status === "not_applied") {
    throw new GglCallError(
      `GoGetLinks отклонил действие "${input.action}" по обзору #${order.gglReviewId}`,
      remoteRes.status,
    );
  }

  const auditAction =
    input.action === "accept" ? "ggl.order.accept" : "ggl.order.request_revision";

  if (remoteRes.status === "may_have_applied") {
    await writeAudit({
      action: auditAction,
      entity: "GglOrder",
      entityId: order.id,
      actor: input.user,
      details: {
        gglReviewId: order.gglReviewId,
        previousStatus: order.status,
        orderStatus: order.status,
        writeStatus: "may_have_applied",
        comment: cleanComment || null,
        idempotencyKey: cleanKey,
      },
    });
    return serializeGglOrder(order);
  }

  const nextStatus = input.action === "accept" ? "paid" : "in_progress";
  const maybeUpdated = await updateOrderStatus(order.id, nextStatus, {
    action: input.action,
    user: input.user,
  });

  const finalOrder: OrderGuardRecord = maybeUpdated ?? {
    ...order,
    status: nextStatus,
    ...(nextStatus === "paid" && !order.paidAt ? { paidAt: new Date() } : {}),
  };

  await writeAudit({
    action: auditAction,
    entity: "GglOrder",
    entityId: order.id,
    actor: input.user,
    details: {
      gglReviewId: order.gglReviewId,
      previousStatus: order.status,
      orderStatus: nextStatus,
      writeStatus: remoteRes.status,
      comment: cleanComment || null,
      idempotencyKey: cleanKey,
    },
  });

  return serializeGglOrder(finalOrder);
}
