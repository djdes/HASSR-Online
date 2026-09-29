import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";

import { MAILING_CHANNELS, overallRecipientStatus, type ChannelStatus, type MailingChannel } from "./labels";
import type { MailingQueueStore, QueueCampaign, QueueRecipient, RecipientPatch } from "./queue";

/**
 * Хранилище очереди рассылки на Prisma. Логика — в `queue.ts`; здесь
 * только запросы. Все условные переходы — `updateMany` с условием на
 * прежний статус: так отмена, повтор и проход очереди не затирают друг
 * друга.
 */

const STATUS_COLUMN = {
  email: "emailStatus",
  inApp: "inAppStatus",
  push: "pushStatus",
  telegram: "telegramStatus",
} as const satisfies Record<MailingChannel, string>;

const ERROR_COLUMN = {
  email: "emailError",
  inApp: "inAppError",
  push: "pushError",
  telegram: "telegramError",
} as const satisfies Record<MailingChannel, string>;

export const STALE_SENDING_ERROR =
  "Отправка прервалась (сервер перезапускался) — не повторяем, чтобы не отправить дважды";

/** `{ emailStatus: "queued" }` для канала — условие выборки. */
export function channelIs(channel: MailingChannel, status: ChannelStatus): Prisma.MailingRecipientWhereInput {
  return { [STATUS_COLUMN[channel]]: status } as Prisma.MailingRecipientWhereInput;
}

/** Статус и текст ошибки канала — для `updateMany`. */
export function channelSet(
  channel: MailingChannel,
  status: ChannelStatus,
  error: string | null
): Prisma.MailingRecipientUpdateManyMutationInput {
  return { [STATUS_COLUMN[channel]]: status, [ERROR_COLUMN[channel]]: error } as Prisma.MailingRecipientUpdateManyMutationInput;
}

const recipientSelect = {
  id: true,
  campaignId: true,
  token: true,
  userId: true,
  contactId: true,
  email: true,
  name: true,
  companyName: true,
  sphere: true,
  organizationId: true,
  isTest: true,
  emailStatus: true,
  inAppStatus: true,
  pushStatus: true,
  telegramStatus: true,
  attempts: true,
  nextAttemptAt: true,
  links: true,
  payload: true,
} satisfies Prisma.MailingRecipientSelect;

type RecipientRow = Prisma.MailingRecipientGetPayload<{ select: typeof recipientSelect }>;

export function toQueueRecipient(row: RecipientRow): QueueRecipient {
  return {
    ...row,
    emailStatus: row.emailStatus as ChannelStatus | null,
    inAppStatus: row.inAppStatus as ChannelStatus | null,
    pushStatus: row.pushStatus as ChannelStatus | null,
    telegramStatus: row.telegramStatus as ChannelStatus | null,
    links: Array.isArray(row.links) ? row.links.filter((l): l is string => typeof l === "string") : [],
    payload:
      row.payload && typeof row.payload === "object" && !Array.isArray(row.payload)
        ? (row.payload as Record<string, unknown>)
        : null,
  };
}

export async function loadQueueRecipient(id: string): Promise<QueueRecipient | null> {
  const row = await db.mailingRecipient.findUnique({ where: { id }, select: recipientSelect });
  return row ? toQueueRecipient(row) : null;
}

function patchToData(patch: RecipientPatch): Prisma.MailingRecipientUpdateManyMutationInput {
  const { links, ...rest } = patch;
  return {
    ...rest,
    ...(links ? { links: links as Prisma.InputJsonValue } : {}),
  };
}

/** Пересчитать итог получателя после массовых правок статусов каналов. */
async function recomputeStatuses(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const rows = await db.mailingRecipient.findMany({
    where: { id: { in: ids } },
    select: { id: true, emailStatus: true, inAppStatus: true, pushStatus: true, telegramStatus: true },
  });
  for (const row of rows) {
    const status = overallRecipientStatus([
      row.emailStatus as ChannelStatus | null,
      row.inAppStatus as ChannelStatus | null,
      row.pushStatus as ChannelStatus | null,
      row.telegramStatus as ChannelStatus | null,
    ]);
    await db.mailingRecipient.update({ where: { id: row.id }, data: { status } });
  }
}

export async function refreshCampaignCounters(campaignId: string): Promise<void> {
  const [groups, clicks] = await Promise.all([
    db.mailingRecipient.groupBy({
      by: ["status"],
      where: { campaignId, isTest: false },
      _count: { _all: true },
    }),
    db.mailingRecipient.count({ where: { campaignId, isTest: false, clickedAt: { not: null } } }),
  ]);
  const count = (status: string) => groups.find((g) => g.status === status)?._count._all ?? 0;
  const total = groups.reduce((sum, g) => sum + g._count._all, 0);
  await db.mailingCampaign.update({
    where: { id: campaignId },
    data: {
      totalCount: total,
      queuedCount: count("queued"),
      sentCount: count("sent"),
      failedCount: count("failed"),
      skippedCount: count("skipped"),
      cancelledCount: count("cancelled"),
      clickCount: clicks,
    },
  });
}

export function createPrismaQueueStore(): MailingQueueStore {
  return {
    async startDueScheduled(now) {
      const due = await db.mailingCampaign.findMany({
        where: { status: "scheduled", scheduledAt: { lte: now } },
        select: { id: true },
      });
      const started: string[] = [];
      for (const c of due) {
        const r = await db.mailingCampaign.updateMany({
          where: { id: c.id, status: "scheduled" },
          data: { status: "sending", startedAt: now },
        });
        if (r.count === 1) started.push(c.id);
      }
      return started;
    },

    async campaignsToPrepare() {
      const rows = await db.mailingCampaign.findMany({
        where: { status: "sending", preparedAt: null },
        select: { id: true, kind: true, payload: true, status: true },
      });
      return rows;
    },

    async prepareRecipients(campaignId) {
      return db.mailingRecipient.findMany({
        where: { campaignId, isTest: false },
        select: { id: true, email: true, organizationId: true, companyName: true, sphere: true },
        orderBy: { createdAt: "asc" },
      });
    },

    async savePrepared(campaignId, personal, now) {
      const entries = Object.entries(personal);
      for (const [id, data] of entries) {
        const row = await db.mailingRecipient.findUnique({ where: { id }, select: { campaignId: true, payload: true } });
        if (!row || row.campaignId !== campaignId) continue;
        const prev = row.payload && typeof row.payload === "object" && !Array.isArray(row.payload) ? row.payload : {};
        await db.mailingRecipient.update({
          where: { id },
          data: { payload: { ...(prev as Record<string, unknown>), ...data } as Prisma.InputJsonValue },
        });
      }
      await db.mailingCampaign.update({ where: { id: campaignId }, data: { preparedAt: now, lastError: null } });
    },

    async savePrepareError(campaignId, error) {
      await db.mailingCampaign.update({ where: { id: campaignId }, data: { lastError: `Подготовка: ${error}` } });
    },

    async failStaleSending() {
      const stale = await db.mailingRecipient.findMany({
        where: {
          isTest: false,
          OR: MAILING_CHANNELS.map((c) => channelIs(c, "sending")),
        },
        select: { id: true },
      });
      if (stale.length === 0) return 0;
      const ids = stale.map((s) => s.id);
      for (const c of MAILING_CHANNELS) {
        await db.mailingRecipient.updateMany({
          where: { AND: [{ id: { in: ids } }, channelIs(c, "sending")] },
          data: channelSet(c, "failed", STALE_SENDING_ERROR),
        });
      }
      await recomputeStatuses(ids);
      return ids.length;
    },

    async listDueRecipients(now, limit, emailAllowed) {
      const channels = MAILING_CHANNELS.filter((c) => emailAllowed || c !== "email");
      const rows = await db.mailingRecipient.findMany({
        where: {
          status: "queued",
          isTest: false,
          campaign: { status: "sending", preparedAt: { not: null } },
          AND: [
            { OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] },
            { OR: channels.map((c) => channelIs(c, "queued")) },
          ],
        },
        select: recipientSelect,
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: limit,
      });
      return rows.map(toQueueRecipient);
    },

    async getCampaign(id): Promise<QueueCampaign | null> {
      return db.mailingCampaign.findUnique({
        where: { id },
        select: { id: true, kind: true, payload: true, status: true },
      });
    },

    async countEmailsSentSince(since) {
      // Тест себе лимит рассылки не съедает — он для рассылок.
      return db.mailingRecipient.count({ where: { emailSentAt: { gte: since }, isTest: false } });
    },

    async suppressedEmails(emails) {
      if (emails.length === 0) return new Set();
      const rows = await db.emailSuppression.findMany({ where: { email: { in: emails } }, select: { email: true } });
      return new Set(rows.map((r) => r.email));
    },

    async optedOutUsers(userIds) {
      if (userIds.length === 0) return new Set();
      const rows = await db.user.findMany({
        where: { id: { in: userIds }, marketingOptOut: true },
        select: { id: true },
      });
      return new Set(rows.map((r) => r.id));
    },

    async contactStatuses(contactIds) {
      if (contactIds.length === 0) return new Map();
      const rows = await db.marketingContact.findMany({
        where: { id: { in: contactIds } },
        select: { id: true, status: true },
      });
      return new Map(rows.map((r) => [r.id, r.status]));
    },

    async claimChannels(recipientId, channels, links, options) {
      const and: Prisma.MailingRecipientWhereInput[] = [{ id: recipientId }, ...channels.map((c) => channelIs(c, "queued"))];
      if (options.requireSending) and.push({ campaign: { status: "sending" } });
      const data: Prisma.MailingRecipientUpdateManyMutationInput = { links: links as Prisma.InputJsonValue };
      for (const c of channels) Object.assign(data, { [STATUS_COLUMN[c]]: "sending" });
      const r = await db.mailingRecipient.updateMany({ where: { AND: and }, data });
      return r.count === 1;
    },

    async saveRecipient(recipientId, patch) {
      await db.mailingRecipient.updateMany({ where: { id: recipientId }, data: patchToData(patch) });
    },

    async markBounced(email, campaignId, error) {
      const address = email.toLowerCase();
      await db.emailSuppression.upsert({
        where: { email: address },
        create: { email: address, reason: "bounced", campaignId, note: error.slice(0, 300) },
        update: {},
      });
      await db.marketingContact.updateMany({ where: { email: address, status: "active" }, data: { status: "bounced" } });
      console.info(`[mailing] bounce → stop-list`, { email: address, campaign: campaignId });
    },

    async markContactSent(contactId, at) {
      await db.marketingContact.updateMany({ where: { id: contactId }, data: { lastSentAt: at } });
    },

    async finishCampaignIfDone(campaignId, now) {
      const queued = await db.mailingRecipient.count({ where: { campaignId, isTest: false, status: "queued" } });
      if (queued > 0) return false;
      const r = await db.mailingCampaign.updateMany({
        where: { id: campaignId, status: "sending" },
        data: { status: "done", finishedAt: now },
      });
      return r.count === 1;
    },

    refreshCounters: refreshCampaignCounters,
  };
}
